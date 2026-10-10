import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { resolve } from 'node:path';
import * as schema from '../../src/db/schema';
import { loadEnv, maskDatabaseUrl } from '../lib/env';

async function main() {
  const envArg = process.argv[2]; // e.g. 'preprod', 'prod', or undefined
  const { env, databaseUrl } = loadEnv(envArg);

  console.log(`[db:migrate] Target environment: ${env}`);
  console.log(`[db:migrate] Database: ${maskDatabaseUrl(databaseUrl)}`);

  // Supabase transaction pooler (port 6543) requires prepare: false
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const db = drizzle(client, { schema });

  try {
    console.log('[db:migrate] Applying migrations from drizzle/...');
    await migrate(db, { migrationsFolder: resolve(process.cwd(), 'drizzle') });
    console.log('[db:migrate] All migrations applied successfully!');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[db:migrate] Migration failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
