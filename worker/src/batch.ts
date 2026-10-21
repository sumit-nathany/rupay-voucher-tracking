/**
 * Batch entry point for the ordering worker.
 *
 * This is exactly what the Google Cloud Run Job executes, once per hour.
 * Each execution:
 *
 *   1. installs log redaction,
 *   2. opens the ordering job run record,
 *   3. walks every connected portal account, skipping any whose workspace has
 *      automation paused and any that has no eligible candidate,
 *   4. lets the browser runner place at most one order per eligible account,
 *   5. closes the job run record with aggregate counts and exits.
 *
 * It holds no state between executions: the 24-hour cooldown lives in the
 * database (`app.portal_accounts.cooldown_until`), so a sweep that finds an
 * account still cooling down simply does nothing for it. See
 * docs/automated-rupay-ordering-architecture.md §3 and
 * docs/review-history.md RH#15.
 *
 * Two modes:
 *
 *   - **live** (default): orders through the real browser.
 *   - **plan only** (`USE_BROWSER_RUNNER=false`): evaluates eligibility and
 *     reports what *would* be ordered, without reserving, launching a
 *     browser, or writing an attempt. This is how a deployment is validated
 *     before it is allowed near a live portal.
 *
 * Exit codes: 0 when the run completed (even if individual accounts
 * failed), 1 on a fatal error (database, configuration, or an unhandled
 * exception) so Cloud Run records the execution as failed.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '../../web/src/db/schema';
import type { Database } from '../../web/src/lib/context';
import { today as todayInIST } from '../../web/src/lib/periods';
import { installLogRedaction } from './lib/redact';
import { runBrowserTest } from './browser-runner';
import { selectCandidateForAccount } from './candidate-selection';

const HEADLESS = process.env.HEADLESS !== 'false';
const PLAN_ONLY = process.env.USE_BROWSER_RUNNER === 'false';

async function main() {
  installLogRedaction();

  const dbUrl = process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[worker] Fatal: WORKER_DATABASE_URL or DATABASE_URL is required');
    process.exit(1);
  }

  const client = postgres(dbUrl, { max: 2 });
  const db = drizzle(client, { schema }) as unknown as Database;

  console.log(`[worker] Batch run starting at ${new Date().toISOString()}`);
  console.log(
    `[worker] Mode: ${PLAN_ONLY ? 'plan only (no orders will be placed)' : 'live (real browser)'}`,
  );

  // 1. Open the job run record.
  const [jobRun] = await db
    .insert(schema.orderingJobRuns)
    .values({
      scheduledFor: new Date(),
      startedAt: new Date(),
      status: 'running',
    })
    .returning();

  let accountsProcessed = 0;
  let ordersConfirmed = 0;
  let ordersFailed = 0;
  let status: 'completed' | 'failed' = 'completed';

  try {
    // 2. Every connected portal account, across all workspaces.
    const accounts = await db
      .select({
        id: schema.portalAccounts.id,
        workspaceId: schema.portalAccounts.workspaceId,
        label: schema.portalAccounts.label,
      })
      .from(schema.portalAccounts)
      .where(eq(schema.portalAccounts.status, 'connected'));

    if (accounts.length === 0) {
      console.log('[worker] No connected portal accounts. Nothing to do.');
    }

    // 3. Workspaces that have automation switched off are skipped entirely.
    const workspaceIds = Array.from(new Set(accounts.map((a) => a.workspaceId)));
    const pausedWorkspaces = new Set<string>();
    if (workspaceIds.length > 0) {
      const settings = await db
        .select({
          workspaceId: schema.automationSettings.workspaceId,
          enabled: schema.automationSettings.enabled,
        })
        .from(schema.automationSettings)
        .where(inArray(schema.automationSettings.workspaceId, workspaceIds));
      for (const s of settings) {
        if (!s.enabled) pausedWorkspaces.add(s.workspaceId);
      }
    }

    const today = todayInIST();

    for (const account of accounts) {
      if (pausedWorkspaces.has(account.workspaceId)) {
        console.log(
          `[worker] Skipping account "${account.label}": automation is paused for its workspace.`,
        );
        continue;
      }

      try {
        // The candidate lookup honours the account's 24-hour cooldown and the
        // workspace's automation switch, so it is the eligibility check. It
        // uses the same selection the runner uses, so the plan-only preview
        // below is exactly what a live run would do.
        const candidate = await selectCandidateForAccount(db, account, today);

        if (!candidate) {
          console.log(`[worker] Account "${account.label}": nothing eligible right now.`);
          continue;
        }

        if (PLAN_ONLY) {
          const [detail] = await db
            .select({ lastDigits: schema.cards.lastDigits })
            .from(schema.cards)
            .where(eq(schema.cards.id, candidate.cardId));
          console.log(
            `[worker] PLAN: would order instance ${candidate.instanceId} on card ••${detail?.lastDigits ?? '????'} by ${account.label} (deadline ${candidate.orderDeadline}).`,
          );
          continue;
        }

        // 4. The runner places at most one order for this account.
        const result = await runBrowserTest({
          portalAccountId: account.id,
          headless: HEADLESS,
          jobRunId: jobRun.id,
        });

        if (result.attempted) {
          accountsProcessed++;
          if (result.reason && result.reason !== 'ordered') {
            console.log(
              `[worker] Account "${result.accountLabel ?? account.label}" did not complete an order (${result.reason}).`,
            );
          }
        }
      } catch (err) {
        // An account-level failure must not abort the whole sweep.
        ordersFailed++;
        console.error(
          `[worker] Account "${account.label}" failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    // 5. Aggregate counts from the attempts this run created.
    if (!PLAN_ONLY) {
      const attempts = await db
        .select({ state: schema.portalOrderAttempts.state })
        .from(schema.portalOrderAttempts)
        .where(eq(schema.portalOrderAttempts.jobRunId, jobRun.id));

      ordersConfirmed = attempts.filter((a) => a.state === 'confirmed').length;
      const failedByAttempt = attempts.filter((a) =>
        ['failed_pre_submit', 'uncertain', 'cancelled'].includes(a.state),
      ).length;
      ordersFailed = Math.max(ordersFailed, failedByAttempt);
    }

    console.log(`[worker] Batch run complete:`, {
      jobRunId: jobRun.id,
      mode: PLAN_ONLY ? 'plan-only' : 'live',
      accountsProcessed,
      ordersConfirmed,
      ordersFailed,
    });
  } catch (err) {
    status = 'failed';
    console.error(
      '[worker] Fatal error during batch run:',
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    await db
      .update(schema.orderingJobRuns)
      .set({
        status,
        finishedAt: new Date(),
        accountsProcessed,
        ordersConfirmed,
        ordersFailed,
      })
      .where(eq(schema.orderingJobRuns.id, jobRun.id));

    await client.end();
  }

  process.exit(status === 'failed' ? 1 : 0);
}

main().catch((err) => {
  installLogRedaction();
  console.error('[worker] Unhandled fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
