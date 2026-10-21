/**
 * Applies one migration file to an environment, and records it in the
 * Drizzle migration ledger.
 *
 *   npx tsx scripts/db/apply-migration.ts <env> <tag> [owner-database-url]
 *
 * e.g.
 *   npx tsx scripts/db/apply-migration.ts prod 0026_first_mongu
 *   npx tsx scripts/db/apply-migration.ts prod 0026_first_mongu 'postgres://postgres:...@db.xxx.supabase.co:5432/postgres'
 *
 * **Why this exists.** The application connects to production as a
 * least-privilege role (`rupay_worker`) that has no DDL rights and cannot
 * create the `drizzle` schema, so `npm run db:migrate:prod` cannot work
 * there. This script takes the migration file and applies it with whatever
 * connection it is given — the owner's, when supplied — and records the
 * migration so the normal migrator stays in step from then on.
 *
 * With no owner URL it falls back to the environment's own connection, which
 * is enough for environments (such as pre-production) where the application
 * role does have DDL rights.
 *
 * The migration must be additive and backward compatible — see AGENTS.md.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { loadEnv, maskDatabaseUrl } from '../lib/env';

async function main() {
  const envArg = process.argv[2];
  const tag = process.argv[3];
  const ownerUrl = process.argv[4];
  if (!envArg || !tag) {
    console.error('usage: apply-migration.ts <env> <tag> [owner-database-url]');
    process.exit(2);
  }

  const { env, databaseUrl } = loadEnv(envArg);
  const url = ownerUrl ?? databaseUrl;
  console.log(`[apply] Target environment: ${env}`);
  console.log(`[apply] Database: ${maskDatabaseUrl(url)}`);
  if (ownerUrl) console.log('[apply] Using the owner connection supplied on the command line.');

  const folder = resolve(process.cwd(), 'drizzle');
  const file = resolve(folder, `${tag}.sql`);
  const sql = readFileSync(file, 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  const client = postgres(url, { max: 1, prepare: false });
  try {
    for (const [i, stmt] of statements.entries()) {
      try {
        await client.unsafe(stmt);
        console.log(`[apply]   ${i + 1}/${statements.length} ok`);
      } catch (err) {
        // A constraint or column that already exists is not a failure — the
        // change is already there.
        const message = err instanceof Error ? err.message : String(err);
        if (/already exists|duplicate key value/.test(message)) {
          console.log(`[apply]   ${i + 1}/${statements.length} skipped (already applied)`);
          continue;
        }
        throw err;
      }
    }

    // Record it so Drizzle's migrator does not try to apply it again.
    try {
      await client.unsafe('CREATE SCHEMA IF NOT EXISTS "drizzle"');
      await client.unsafe(
        'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (' +
          'id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
      );
      const journal = JSON.parse(
        readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8'),
      ) as { entries: { tag: string; when: number }[] };
      const entry = journal.entries.find((e) => e.tag === tag);
      if (entry) {
        const hash = createHash('sha256').update(sql).digest('hex');
        const existing = await client.unsafe<{ n: number }[]>(
          'SELECT count(*)::int AS n FROM "drizzle"."__drizzle_migrations" WHERE created_at = $1',
          [entry.when],
        );
        if (existing[0].n === 0) {
          await client.unsafe(
            'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
            [hash, entry.when],
          );
          console.log('[apply] Recorded in the migration ledger.');
        } else {
          console.log('[apply] Already recorded in the migration ledger.');
        }
      }
    } catch (err) {
      console.warn(
        '[apply] The migration was applied, but the ledger could not be updated:',
        err instanceof Error ? err.message : String(err),
      );
      console.warn('[apply] The ledger needs the database owner role; the change itself is in place.');
    }
  } finally {
    await client.end();
  }
  console.log('[apply] Done.');
}

main().catch((err) => {
  console.error('[apply] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
