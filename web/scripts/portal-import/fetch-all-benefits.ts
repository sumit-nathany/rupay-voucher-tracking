import fs from "node:fs";
import path from "node:path";
import { eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema";
import type { Database } from "../../src/lib/context";

const API = "https://apirupayselect.truztee.com/api";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function portal<T>(endpoint: string, body: object, jwt: string, sid: string): Promise<T[] | null> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    origin: "https://rupayselect.truztee.com",
    referer: "https://rupayselect.truztee.com/",
    "x-requested-with": "XMLHttpRequest",
    cookie: `jwt=${jwt}`,
    sessionid: sid,
  };
  try {
    const res = await fetch(`${API}/${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      console.error(`  ${endpoint}: HTTP ${res.status}`);
      return null;
    }
    const env = (await res.json()) as { payload: string };
    const p = JSON.parse(env.payload) as { code: number | string; message: string; response?: T[] };
    await sleep(1000);
    if (String(p.code) === "0") {
      return p.response ?? [];
    }
    console.error(`  ${endpoint}: code ${p.code}, message: ${p.message}`);
    return null;
  } catch (e) {
    console.error(`  ${endpoint}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function withDb<T>(fn: (db: Database) => Promise<T>): Promise<T> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { prepare: false, max: 1 });
  try {
    return await fn(drizzle(client, { schema }) as unknown as Database);
  } finally {
    await client.end();
  }
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const [, , dir] = process.argv;
  if (!dir) throw new Error("usage: fetch-all-benefits.ts <output-dir>");

  const jwtFile = process.env.PORTAL_JWT_FILE;
  const sidFile = process.env.PORTAL_SESSIONID_FILE;
  if (!jwtFile || !sidFile) throw new Error("PORTAL_JWT_FILE and PORTAL_SESSIONID_FILE must point at files holding the token and sessionid");

  const jwt = fs.readFileSync(jwtFile, "utf8").trim();
  const sid = fs.readFileSync(sidFile, "utf8").trim();
  if (!jwt || !sid) throw new Error("token/sessionid file is empty");

  // Extract loginId from JWT
  const payload = jwt.split(".")[1];
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { loginId: string };
  const userid = decoded.loginId;

  fs.mkdirSync(dir, { recursive: true });

  await withDb(async (db) => {
    // Get all cards with their portal IDs
    const cards = await db
      .select({ id: schema.bankCardTypes.id, displayName: schema.bankCardTypes.displayName, portalCardId: schema.bankCardTypes.portalCardId })
      .from(schema.bankCardTypes)
      .where(isNotNull(schema.bankCardTypes.portalCardId));

    console.log(`Found ${cards.length} cards with portal IDs\n`);

    for (const card of cards) {
      if (!card.portalCardId) continue;

      console.log(`\n📌 Card: ${card.displayName} (portal ID: ${card.portalCardId})`);
      const outputFile = path.join(dir, `benefits-${card.portalCardId}.json`);

      // Skip if already fetched
      if (fs.existsSync(outputFile)) {
        console.log("  ✓ Already fetched, skipping");
        continue;
      }

      // Try cardbinid starting from the card ID and incrementing
      let success = false;
      const maxAttempts = 50; // Try up to 50 cardbinid values

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const cardbinid = card.portalCardId + attempt;
        console.log(`  Trying cardbinid: ${cardbinid}...`);

        const services = await portal("Select/getCardServices", { userid, cardtypeid: card.portalCardId, cardbinid }, jwt, sid);

        if (services !== null && services.length > 0) {
          console.log(`  ✓ Found ${services.length} categories!`);

          // Fetch deals for each service
          const deals: Record<string, unknown[]> = {};
          for (const s of services) {
            const serviceDeals = await portal("Select/getUserDealsNew", { cardtypeid: String(card.portalCardId), userid, sid: String(s.id), cardbinid: String(cardbinid) }, jwt, sid);
            if (serviceDeals) {
              deals[String(s.id)] = serviceDeals;
              console.log(`    - ${s.servicename || `Category ${s.id}`}: ${serviceDeals.length} offers`);
            }
          }

          // Save results
          const out = {
            card: card.portalCardId,
            cardbinid,
            fetchedAt: new Date().toISOString(),
            services,
            deals,
          };
          fs.writeFileSync(outputFile, JSON.stringify(out, null, 1));
          console.log(`  Saved to ${path.basename(outputFile)}`);
          success = true;
          break;
        } else if (services === null) {
          // Network error, stop trying
          console.log(`  ✗ Network error, stopping attempts`);
          break;
        }
        // Otherwise services is empty, try next cardbinid
      }

      if (!success) {
        console.log(`  ✗ Could not find valid cardbinid after ${maxAttempts} attempts`);
      }
    }
  });
}

main().catch((e) => {
  console.error("fetch-all-benefits failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
