import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../web/src/db/schema';
import type { Database } from '../../web/src/lib/context';
import { FakePortalOrderClient } from '../../web/src/lib/portal-client';
import { runAutomationJob } from '../../web/src/domain/automation-worker';
import { getNextEligibleRunTime } from '../../web/src/domain/automation';

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

  while (true) {
    try {
      const nextRun = await getNextEligibleRunTime(db);

      if (nextRun.reason === 'automation_paused') {
        console.log('[daemon] Automation is paused. Checking again in 5 minutes...');
        await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
        continue;
      }

      if (nextRun.reason === 'no_accounts') {
        console.log('[daemon] No connected accounts. Checking again in 5 minutes...');
        await new Promise((r) => setTimeout(r, 5 * 60 * 1000));
        continue;
      }

      if (!nextRun.eligibleNow && nextRun.nextRunAt) {
        const delayMs = nextRun.nextRunAt.getTime() - Date.now();
        if (delayMs > 0) {
          const istTime = nextRun.nextRunAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
          console.log(`[daemon] Next eligible account (${nextRun.accountLabel}) unlocks at ${istTime} IST.`);
          console.log(`[daemon] Sleeping for ${Math.round(delayMs / 60000)} minutes until then...`);

          // Sleep until the exact unlock time (capped at 30 min per tick to stay responsive to UI toggles)
          const sleepMs = Math.min(delayMs + 1000, 30 * 60 * 1000);
          await new Promise((r) => setTimeout(r, sleepMs));
          continue;
        }
      }

      // At least one account is eligible now! Execute ordering run.
      console.log(`\n[daemon] >>> Account eligible! Triggering automation run at ${new Date().toISOString()} <<<`);
      const portalClient = new FakePortalOrderClient();
      const stats = await runAutomationJob({ db, client: portalClient });
      console.log(`[daemon] Run finished: ${stats.ordersConfirmed} confirmed, ${stats.ordersFailed} failed.`);
      console.log('[daemon] Re-evaluating schedule for remaining accounts...\n');

      // Small pause before checking the next account in queue
      await new Promise((r) => setTimeout(r, 5000));
    } catch (err) {
      console.error('[daemon] Error in loop:', err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
}

startDaemon().catch((err) => {
  console.error('Fatal daemon error:', err);
  process.exit(1);
});
