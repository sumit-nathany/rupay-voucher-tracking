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
 * **Why this exists, and why not `npm run db:migrate:prod`.**
 *
 * The application connects to production as a least-privilege role
 * (`rupay_worker`) that owns no table in the `app` schema. It cannot
 * `ALTER TABLE`, and it cannot `CREATE SCHEMA` — and Drizzle's migrator
 * begins every run with `CREATE SCHEMA IF NOT EXISTS "drizzle"`, so
 * `npm run db:migrate:prod` fails on that statement before it ever looks at
 * the ledger. The ledger was also missing from production, so the migrator
 * would have tried to re-apply every migration from the beginning.
 *
 * This script applies the migration with whatever connection it is given,
 * skipping statements that are already in place, and records the migration so
 * the ledger stays accurate.
 *
 * **Two ways to authenticate:**
 *
 * 1. *Management API* (recommended — no database password needed). Set
 *    `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`; the script runs the
 *    SQL through the Supabase Management API as the database owner. On macOS
 *    the token from the Supabase CLI is in the keychain:
 *
 *      export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
 *      export SUPABASE_PROJECT_REF=<project-ref>
 *
 * 2. *Direct connection* — pass the owner's URL as the third argument, or
 *    set `MIGRATION_DATABASE_URL`.
 *
 * The migration must be additive and backward compatible — see AGENTS.md.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { loadEnv, maskDatabaseUrl } from '../lib/env';

interface Queryable {
  query(sql: string): Promise<unknown>;
  describe(): string;
}

/** Runs SQL through the Supabase Management API, as the database owner. */
function managementApiClient(token: string, projectRef: string): Queryable {
  return {
    async query(sql: string) {
      const res = await fetch(
        `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql }),
        },
      );
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },
    describe() {
      return `the Supabase Management API (project ${projectRef})`;
    },
  };
}

/** Runs SQL over a direct connection. */
function directClient(url: string): Queryable {
  const client = postgres(url, { max: 1, prepare: false });
  return {
    async query(sql: string) {
      return client.unsafe(sql);
    },
    describe() {
      return maskDatabaseUrl(url);
    },
  };
}

async function main() {
  const envArg = process.argv[2];
  const tag = process.argv[3];
  const ownerUrl = process.argv[4] ?? process.env.MIGRATION_DATABASE_URL;
  if (!envArg || !tag) {
    console.error('usage: apply-migration.ts <env> <tag> [owner-database-url]');
    process.exit(2);
  }

  const { env, databaseUrl } = loadEnv(envArg);
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const useApi = Boolean(token && projectRef);

  console.log(`[apply] Target environment: ${env}`);
  const client: Queryable = useApi
    ? managementApiClient(token!, projectRef!)
    : directClient(ownerUrl ?? databaseUrl);
  console.log(`[apply] Connection: ${client.describe()}`);
  if (!useApi && !ownerUrl) {
    console.log(
      '[apply] Using the environment\'s own connection — that only works where the ' +
        'application role has DDL rights (pre-production). For production, set ' +
        'SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF, or pass the owner URL.',
    );
  }

  const folder = resolve(process.cwd(), 'drizzle');
  const sql = readFileSync(resolve(folder, `${tag}.sql`), 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  // 1. Apply the migration, statement by statement.
  for (const [i, stmt] of statements.entries()) {
    try {
      await client.query(stmt);
      console.log(`[apply]   ${i + 1}/${statements.length} applied`);
    } catch (err) {
      // A constraint or column that already exists is not a failure — the
      // change is already there.
      const message = err instanceof Error ? err.message : String(err);
      if (/already exists|duplicate key value/i.test(message)) {
        console.log(`[apply]   ${i + 1}/${statements.length} skipped (already applied)`);
        continue;
      }
      throw err;
    }
  }

  // 2. Record it so Drizzle's migrator does not try to apply it again.
  try {
    await client.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
    await client.query(
      'CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (' +
        'id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)',
    );
    const journal = JSON.parse(
      readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8'),
    ) as { entries: { tag: string; when: number }[] };
    const entry = journal.entries.find((e) => e.tag === tag);
    if (entry) {
      const hash = createHash('sha256').update(sql).digest('hex');
      const existing = (await client.query(
        'SELECT count(*)::int AS n FROM "drizzle"."__drizzle_migrations" WHERE created_at = ' +
          entry.when,
      )) as { n: number }[];
      if (existing[0].n === 0) {
        await client.query(
          'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES (' +
            `'${hash}', ${entry.when})`,
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
    console.warn('[apply] The ledger needs the database owner; the change itself is in place.');
  }

  console.log('[apply] Done.');
}

main().catch((err) => {
  console.error('[apply] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
