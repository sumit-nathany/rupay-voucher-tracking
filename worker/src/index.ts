import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../web/src/db/schema';
import type { Database } from '../../web/src/lib/context';
import { FakePortalOrderClient } from '../../web/src/lib/portal-client';
import { runAutomationJob } from '../../web/src/domain/automation-worker';
import { getNextEligibleRunTime } from '../../web/src/domain/automation';

async function main() {
  const dbUrl = process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('Fatal: DATABASE_URL or WORKER_DATABASE_URL is required');
    process.exit(1);
  }

  const client = postgres(dbUrl, { max: 1 });
  const db = drizzle(client, { schema }) as unknown as Database;

  console.log(`[worker] Starting automated RuPay ordering worker at ${new Date().toISOString()}`);

  try {
    const nextRun = await getNextEligibleRunTime(db);

    if (nextRun.reason === 'automation_paused') {
      console.log('[worker] Automation is paused in workspace settings. Exiting.');
      return;
    }

    if (nextRun.reason === 'no_accounts') {
      console.log('[worker] No connected portal accounts found. Exiting.');
      return;
    }

    if (!nextRun.eligibleNow && nextRun.nextRunAt) {
      const formattedIst = nextRun.nextRunAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const delayMs = nextRun.nextRunAt.getTime() - Date.now();
      console.log(`[worker] All connected accounts are in cooldown.`);
      console.log(`[worker] Next account (${nextRun.accountLabel}) unlocks at: ${formattedIst} IST (in ${Math.round(delayMs / 60000)} minutes).`);

      const shouldWait = process.argv.includes('--wait') || process.env.WORKER_WAIT_FOR_ELIGIBLE === 'true';
      if (shouldWait && delayMs > 0) {
        console.log(`[worker] Waiting ${Math.round(delayMs / 1000)}s until unlock time to execute...`);
        await new Promise((r) => setTimeout(r, delayMs + 1000));
        console.log(`[worker] Woke up at unlock time! Proceeding with run...`);
      } else {
        console.log(`[worker] Exiting. (Pass --wait to sleep until the next eligible time).`);
        return;
      }
    }

    // In current phase (before live discovery gate completion per requirements §2),
    // worker runs with deterministic safe client.
    const portalClient = new FakePortalOrderClient();

    const stats = await runAutomationJob({
      db,
      client: portalClient,
      scheduledFor: new Date(),
    });

    console.log(`[worker] Job run ${stats.jobRunId} finished:`, {
      status: stats.status,
      accountsProcessed: stats.accountsProcessed,
      ordersConfirmed: stats.ordersConfirmed,
      ordersFailed: stats.ordersFailed,
    });

    if (stats.status === 'failed') {
      process.exit(1);
    }
  } catch (err) {
    console.error(
      '[worker] Unhandled error during automated ordering run:',
      err instanceof Error ? err.message : 'Unknown error',
    );
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
