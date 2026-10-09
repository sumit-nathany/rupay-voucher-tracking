// Run: DATABASE_URL=... npx tsx scripts/seed-catalog/run.ts [--dry-run] [path-to-xlsx]
// Seeds ONLY the shared catalog. Prints aggregate counts only; never Code / Booking ID values.
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema";
import type { Database } from "../../src/lib/context";
import { loadCatalog } from "./load";
import { readRawRows } from "./reader";
import { transform } from "./transform";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const path = args.find((a) => !a.startsWith("--"));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const result = transform(await readRawRows(path));
  console.log("transform:", {
    bankCardTypes: result.bankCardTypes.length,
    benefits: result.benefits.length,
    versions: result.versions.length,
    warnings: result.warnings.length,
  });

  // Supavisor transaction pooler: prepared statements unsupported.
  const client = postgres(url, { prepare: false });
  try {
    const db = drizzle(client, { schema }) as unknown as Database;
    const counts = await loadCatalog(db, result, { dryRun });
    console.log(dryRun ? "DRY RUN (no writes), would apply:" : "applied:", counts);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("seed failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
