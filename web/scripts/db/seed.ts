import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as schema from '../../src/db/schema';
import type { Database } from '../../src/lib/context';
import { loadEnv, maskDatabaseUrl } from '../lib/env';
import { loadCatalog } from '../seed-catalog/load';
import { readRawRows, DEFAULT_WORKBOOK } from '../seed-catalog/reader';
import { transform } from '../seed-catalog/transform';

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  // Filter out flags to find environment and optional file path
  const positionalArgs = args.filter((a) => !a.startsWith('--'));
  const envArg = positionalArgs[0]; // e.g. 'preprod', 'prod', or undefined
  const customPath = positionalArgs[1];

  const { env, databaseUrl } = loadEnv(envArg);

  console.log(`[db:seed] Target environment: ${env}`);
  console.log(`[db:seed] Database: ${maskDatabaseUrl(databaseUrl)}`);
  if (dryRun) {
    console.log('[db:seed] DRY RUN enabled: no writes will be committed.');
  }

  // Find workbook
  let workbookPath: string | undefined = customPath;
  if (!workbookPath) {
    if (existsSync(DEFAULT_WORKBOOK)) {
      workbookPath = DEFAULT_WORKBOOK;
    } else {
      const localCandidates = [
        resolve(process.cwd(), 'Gift Voucher Tracker.xlsx'),
        resolve(process.cwd(), '../Gift Voucher Tracker.xlsx'),
      ];
      for (const cand of localCandidates) {
        if (existsSync(cand)) {
          workbookPath = cand;
          break;
        }
      }
    }
  }

  if (!workbookPath) {
    console.warn(
      '[db:seed] No workbook path provided and default "Gift Voucher Tracker.xlsx" not found.\n' +
        'To seed the shared reference catalog from Excel, run:\n' +
        `  npm run db:seed:${env === 'prod' ? 'prod' : 'preprod'} -- [path-to-xlsx] [--dry-run]\n` +
        'Note: Catalog variants are already seeded by migration 0002_card_variants.sql.'
    );
    return;
  }

  console.log(`[db:seed] Reading catalog data from: ${workbookPath}`);
  const rawRows = await readRawRows(workbookPath);
  const result = transform(rawRows);

  console.log('[db:seed] Transformed catalog summary:', {
    bankCardTypes: result.bankCardTypes.length,
    benefits: result.benefits.length,
    versions: result.versions.length,
    warnings: result.warnings.length,
  });

  // Supavisor transaction pooler requires prepare: false
  const client = postgres(databaseUrl, { prepare: false, max: 1 });
  try {
    const db = drizzle(client, { schema }) as unknown as Database;
    const counts = await loadCatalog(db, result, { dryRun });
    console.log(
      dryRun
        ? '[db:seed] DRY RUN (no writes), would apply:'
        : '[db:seed] Catalog successfully seeded:',
      counts
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('[db:seed] Seeding failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
