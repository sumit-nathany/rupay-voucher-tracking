import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../web/src/db/schema';
import type { Database } from '../../web/src/lib/context';
import { FakePortalOrderClient } from '../../web/src/lib/portal-client';
import { runAutomationJob } from '../../web/src/domain/automation-worker';

async function main() {
  const dbUrl = process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('Fatal: DATABASE_URL or WORKER_DATABASE_URL is required');
    process.exit(1);
  }

  const client = postgres(dbUrl, { max: 1 });
  const db = drizzle(client, { schema }) as unknown as Database;

  console.log(`[worker] Starting automated RuPay ordering run at ${new Date().toISOString()}`);

  try {
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
