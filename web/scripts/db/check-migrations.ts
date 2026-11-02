/**
 * Read-only check: compares the migrations recorded in an environment's
 * Drizzle ledger (`drizzle.__drizzle_migrations`) against the journal and
 * migration files in `web/drizzle/`, and reports any that are missing.
 * Never writes to the database.
 *
 *   npx tsx scripts/db/check-migrations.ts <prod|preprod|<env>>
 *
 * Hash matches exactly what the Drizzle migrator records: the journal has no
 * `hash` field, so both sides use sha256 over the migration file's contents.
 *
 * In production the least-privilege app role has no USAGE on the `drizzle`
 * schema, so set the owner credentials to read the ledger:
 *
 *   export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
 *   export SUPABASE_PROJECT_REF=<project-ref>
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
  const client = postgres(url, { max: 1, prepare: false, connect_timeout: 15 });
  return {
    async query(sql: string) {
      return client.unsafe(sql);
    },
    describe() {
      return maskDatabaseUrl(url);
    },
  };
}

interface JournalEntry {
  idx: number;
  tag: string;
  when: number;
}

interface LedgerRow {
  id: number;
  hash: string | null;
  created_at: string | number | null;
}

async function main() {
  const envArg = process.argv[2];
  const { env, databaseUrl } = loadEnv(envArg);
  const folder = resolve(process.cwd(), 'drizzle');
  const journal = JSON.parse(
    readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8'),
  ) as { entries: JournalEntry[] };

  console.log(`[check] Target environment: ${env}`);

  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  const client: Queryable =
    token && projectRef
      ? managementApiClient(token, projectRef)
      : directClient(databaseUrl);
  console.log(`[check] Connection:         ${client.describe()}`);

  const expected = journal.entries.map((e) => {
    const sql = readFileSync(resolve(folder, `${e.tag}.sql`), 'utf8');
    return { idx: e.idx, tag: e.tag, when: e.when, hash: createHash('sha256').update(sql).digest('hex') };
  });
  console.log(`[check] Local journal:      ${expected.length} migration(s).`);

  try {
    const rows = (await client.query(
      'SELECT id, hash, created_at FROM "drizzle"."__drizzle_migrations" ORDER BY id',
    )) as unknown as LedgerRow[];
    console.log(`[check] Ledger rows:        ${rows.length} migration(s).`);


    const appliedHashes = new Set(rows.map((r) => r.hash));
    const missing = expected.filter((e) => !appliedHashes.has(e.hash));

    // Match every journal entry to its ledger row (created_at holds the journal
    // `when` value for hand-recorded entries).
    console.log('');
    console.log('  #  journal tag                                             applied   ledger created_at (UTC)');
    for (const e of expected) {
      const row = rows.find((r) => r.hash === e.hash);
      const applied = row ? 'yes      ' : 'MISSING!!';
      let ts = '—';
      if (row?.created_at != null) {
        const n = Number(row.created_at);
        const ms = n >= 1e12; // journal `when` values are ms; seconds-epoch values are < 1e12
        const ds = new Date(ms ? n : n * 1000).toISOString();
        ts = `${ds.slice(0, 10)} ${ds.slice(11, 19)}${ms ? '' : ' (recorded in s)'}`;
      }
      console.log(
        `  ${String(e.idx).padStart(2, '0')}  ${e.tag.padEnd(50)} ${applied}  ${ts}`,
      );
    }

    const extras = rows.filter((r) => !r.hash || !expected.some((e) => e.hash === r.hash));
    if (extras.length) {
      console.log('');
      console.log(
        `[check] NOTE: ${extras.length} ledger row(s) no longer match any local migration file:`,
      );
      for (const r of extras) {
        console.log(`        id=${r.id} hash=${String(r.hash).slice(0, 12)}…`);
      }
    }

    console.log('');
    if (missing.length === 0 && rows.length === expected.length) {
      console.log('[check] RESULT: all local migrations are applied. ✔');
    } else if (missing.length === 0) {
      console.log(
        '[check] RESULT: all local migrations are applied, but the ledger has ' +
          `${rows.length} rows vs ${expected.length} in the journal.`,
      );
    } else {
      console.log(
        `[check] RESULT: ${missing.length} migration(s) NOT applied to ${env}:`,
      );
      for (const e of missing) console.log(`  - ${e.tag}.sql`);
      process.exit(1);
    }
  } catch (err) {
    console.error(
      '[check] Could not read the migration ledger. If this is production, retry as the owner:',
    );
    console.error(
      '[check]   export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w)',
    );
    console.error('[check]   export SUPABASE_PROJECT_REF=<project-ref>');
    throw err;
  }
}

main().catch((err) => {
  console.error('[check] Failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
