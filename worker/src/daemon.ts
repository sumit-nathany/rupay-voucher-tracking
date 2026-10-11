import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, isNotNull } from 'drizzle-orm';
import * as schema from '../../web/src/db/schema';
import type { Database } from '../../web/src/lib/context';
import { FakePortalOrderClient } from '../../web/src/lib/portal-client';
import { runAutomationJob } from '../../web/src/domain/automation-worker';
import { getNextEligibleRunTime } from '../../web/src/domain/automation';
import { runBrowserTest } from './browser-runner';

async function checkPendingManualTrigger(db: Database): Promise<boolean> {
  const [triggerRow] = await db
    .select({
      workspaceId: schema.automationSettings.workspaceId,
      triggerRequestedAt: schema.automationSettings.triggerRequestedAt,
    })
    .from(schema.automationSettings)
    .where(isNotNull(schema.automationSettings.triggerRequestedAt))
    .limit(1);

  if (!triggerRow?.triggerRequestedAt) {
    return false;
  }

  console.log(`\n⚡ [daemon] Manual order run requested at ${triggerRow.triggerRequestedAt.toISOString()}!`);
  // Clear trigger request flag in DB so it doesn't re-run repeatedly
  await db
    .update(schema.automationSettings)
    .set({ triggerRequestedAt: null, updatedAt: new Date() })
    .where(eq(schema.automationSettings.workspaceId, triggerRow.workspaceId));

  try {
    console.log('[daemon] >>> Starting manual browser ordering run <<<');
    if (process.env.USE_BROWSER_RUNNER !== 'false') {
      await runBrowserTest({ headless: process.env.HEADLESS === 'true' });
    } else {
      const portalClient = new FakePortalOrderClient();
      const stats = await runAutomationJob({ db, client: portalClient });
      console.log(`[daemon] Simulated run finished: ${stats.ordersConfirmed} confirmed, ${stats.ordersFailed} failed.`);
    }
  } catch (err) {
    console.error('[daemon] Error running manual order:', err instanceof Error ? err.message : err);
  }

  return true;
}

async function responsiveWait(db: Database, maxDurationMs: number): Promise<void> {
  const deadline = Date.now() + maxDurationMs;
  while (Date.now() < deadline) {
    const triggered = await checkPendingManualTrigger(db);
    if (triggered) {
      return;
    }
    const remaining = deadline - Date.now();
    await new Promise((r) => setTimeout(r, Math.min(remaining, 5000)));
  }
}

async function startDaemon() {
  const dbUrl = process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('Fatal: DATABASE_URL or WORKER_DATABASE_URL is required');
    process.exit(1);
  }

  const client = postgres(dbUrl, { max: 2 });
  const db = drizzle(client, { schema }) as unknown as Database;

  console.log('🤖 RuPay Automation Daemon started.');
  console.log('Monitoring all portal accounts and scheduling chained wake-ups...\n');

  let lastScheduleLog = '';

  while (true) {
    try {
      // 1. First, check if a manual run was requested from the UI
      const manualRan = await checkPendingManualTrigger(db);
      if (manualRan) {
        lastScheduleLog = '';
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      // 2. Compute next scheduled run time
      const nextRun = await getNextEligibleRunTime(db);

      if (nextRun.reason === 'automation_paused') {
        if (lastScheduleLog !== 'paused') {
          console.log('[daemon] Automation is paused. Monitoring for UI trigger or unpause...');
          lastScheduleLog = 'paused';
        }
        await responsiveWait(db, 30 * 1000);
        continue;
      }

      if (nextRun.reason === 'no_accounts') {
        if (lastScheduleLog !== 'no_accounts') {
          console.log('[daemon] No connected accounts. Checking again in 30 seconds...');
          lastScheduleLog = 'no_accounts';
        }
        await responsiveWait(db, 30 * 1000);
        continue;
      }

      if (!nextRun.eligibleNow && nextRun.nextRunAt) {
        const delayMs = nextRun.nextRunAt.getTime() - Date.now();
        if (delayMs > 0) {
          const istTime = nextRun.nextRunAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
          const mins = Math.ceil(delayMs / 60000);
          const scheduleKey = `${nextRun.accountLabel}-${nextRun.nextRunAt.toISOString()}-${mins}`;
          if (lastScheduleLog !== scheduleKey) {
            console.log(`[daemon] Next eligible account (${nextRun.accountLabel}) unlocks at ${istTime} IST (~${mins} min).`);
            lastScheduleLog = scheduleKey;
          }

          // Sleep until unlock time (capped at 30 seconds per slice), checking for manual triggers every 5s
          const sleepMs = Math.min(delayMs + 1000, 30 * 1000);
          await responsiveWait(db, sleepMs);
          continue;
        }
      }

      lastScheduleLog = '';

      // 3. At least one account is eligible now! Execute ordering run.
      console.log(`\n[daemon] >>> Account eligible! Triggering automation run at ${new Date().toISOString()} <<<`);
      if (process.env.USE_BROWSER_RUNNER !== 'false') {
        await runBrowserTest({ headless: process.env.HEADLESS === 'true' });
      } else {
        const portalClient = new FakePortalOrderClient();
        const stats = await runAutomationJob({ db, client: portalClient });
        console.log(`[daemon] Run finished: ${stats.ordersConfirmed} confirmed, ${stats.ordersFailed} failed.`);
      }
      console.log('[daemon] Re-evaluating schedule for remaining accounts...\n');

      // Small pause before checking the next account in queue
      await responsiveWait(db, 5000);
    } catch (err) {
      console.error('[daemon] Error in loop:', err instanceof Error ? err.message : err);
      await responsiveWait(db, 30000);
    }
  }
}

startDaemon().catch((err) => {
  console.error('Fatal daemon error:', err);
  process.exit(1);
});
