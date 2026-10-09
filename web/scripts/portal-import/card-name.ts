// Run: DATABASE_URL=... npx tsx scripts/portal-import/card-name.ts <portal card id>
// Prints our catalog's name for a portal card id, or nothing if we don't have it. Read-only.
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema";

async function main() {
  const id = Number(process.argv[2]);
  const url = process.env.DATABASE_URL;
  if (!id) throw new Error("usage: card-name.ts <portal card id>");
  if (!url) throw new Error("DATABASE_URL is not set");

  // Supavisor transaction pooler: prepared statements unsupported.
  const client = postgres(url, { prepare: false });
  try {
    const db = drizzle(client, { schema });
    const [row] = await db
      .select({ name: schema.bankCardTypes.displayName })
      .from(schema.bankCardTypes)
      .where(eq(schema.bankCardTypes.portalCardId, id));
    if (row) console.log(row.name);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("card-name failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
