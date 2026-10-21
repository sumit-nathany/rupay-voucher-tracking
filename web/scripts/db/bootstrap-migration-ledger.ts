/**
 * Records migrations that were applied by hand, so Drizzle's migrator stops
 * trying to re-apply them.
 *
 * **Why this exists.** Some migrations in the pre-production and production
 * databases were applied by running the SQL directly, without going through
 * `npm run db:migrate:*`. Those changes are in the database but missing from
 * the `drizzle.__drizzle_migrations` ledger, and Drizzle decides what to
 * apply by reading the *last* recorded migration — so it re-applies the
 * hand-run migration and fails on the first existing column.
 *
 * This script only ever *records* history; it never changes a table. The
 * operator states which migrations are already applied, and the script fills
 * in the missing ledger rows.
 *
 *   npx tsx scripts/db/bootstrap-migration-ledger.ts <env> <up-to-tag>
 *
 * e.g.
 *   npx tsx scripts/db/bootstrap-migration-ledger.ts prod 0025_tired_cobalt_man
 *
 * Safe to re-run: it only inserts ledger rows that are missing.
 *
 * **Requires a role that can create schemas.** The least-privilege
 * application role cannot create the `drizzle` schema, so this needs the
 * database owner's credentials.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { loadEnv, maskDatabaseUrl } from '../lib/env';

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
  breakpoints: boolean;
}

async function main() {
  const envArg = process.argv[2];
  const lastAppliedTag = process.argv[3];
  if (!envArg || !lastAppliedTag) {
    console.error('usage: bootstrap-migration-ledger.ts <env> <last-applied-tag>');
    process.exit(2);
  }

  const { env, databaseUrl } = loadEnv(envArg);
  const folder = resolve(process.cwd(), 'drizzle');
  const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: JournalEntry[];
  };

  const lastIndex = journal.entries.findIndex((e) => e.tag === lastAppliedTag);
  if (lastIndex === -1) {
    console.error(`error: tag "${lastAppliedTag}" is not in the journal.`);
    process.exit(2);
  }
  const applied = journal.entries.slice(0, lastIndex + 1);

  console.log(`[bootstrap] Target environment: ${env}`);
  console.log(`[bootstrap] Database: ${maskDatabaseUrl(databaseUrl)}`);
  console.log(`[bootstrap] Recording ${applied.length} migrations as applied (up to ${lastAppliedTag}).`);

  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await client.unsafe('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await client.unsafe(
      'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (' +
        'id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
    );

    const existing = await client.unsafe<{ created_at: string }[]>(
      'SELECT created_at FROM "drizzle"."__drizzle_migrations" ORDER BY created_at DESC',
    );
    const recorded = new Set(existing.map((r) => Number(r.created_at)));

    let inserted = 0;
    for (const entry of applied) {
      if (recorded.has(entry.when)) continue; // already recorded
      const sql = readFileSync(resolve(folder, `${entry.tag}.sql`), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');
      await client.unsafe(
        'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
        [hash, entry.when],
      );
      inserted += 1;
    }
    if (inserted === 0) {
      console.log('[bootstrap] The ledger was already up to date — nothing to do.');
      return;
    }
    console.log(`[bootstrap] Recorded ${inserted} migration(s).`);

    const after = await client.unsafe<{ n: number }[]>(
      'SELECT count(*)::int AS n FROM "drizzle"."__drizzle_migrations"',
    );
    console.log(`[bootstrap] Ledger now holds ${after[0].n} migrations.`);
    console.log('[bootstrap] The normal migrator can be used from now on.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[bootstrap] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
