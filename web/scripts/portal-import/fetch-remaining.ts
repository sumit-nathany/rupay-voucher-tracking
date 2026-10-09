import fs from "node:fs";
import path from "node:path";
import { eq, isNotNull, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema";
import type { Database } from "../../src/lib/context";
import type { PortalService } from "./transform";

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
    if (!res.ok) return null;
    const env = (await res.json()) as { payload: string };
    const p = JSON.parse(env.payload) as { code: number | string; message: string; response?: T[] };
    await sleep(1000);
    if (String(p.code) === "0") return p.response ?? [];
    return null;
  } catch (e) {
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

async function main() {
  const [, , dir, ...cardbinidArgs] = process.argv;
  if (!dir || cardbinidArgs.length === 0) {
    throw new Error("usage: fetch-remaining.ts <output-dir> <cardbinid1> [cardbinid2] ...");
  }

  const cardbinids = cardbinidArgs.map(Number);
  const jwtFile = process.env.PORTAL_JWT_FILE;
  const sidFile = process.env.PORTAL_SESSIONID_FILE;
  if (!jwtFile || !sidFile) throw new Error("PORTAL_JWT_FILE and PORTAL_SESSIONID_FILE must point at files");

  const jwt = fs.readFileSync(jwtFile, "utf8").trim();
  const sid = fs.readFileSync(sidFile, "utf8").trim();
  if (!jwt || !sid) throw new Error("token/sessionid file is empty");

  const payload = jwt.split(".")[1];
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { loginId: string };
  const userid = decoded.loginId;

  fs.mkdirSync(dir, { recursive: true });

  await withDb(async (db) => {
    // Get cards without fetched benefits
    const alreadyFetched = fs
      .readdirSync(dir)
      .filter((f) => /^benefits-\d+\.json$/.test(f))
      .map((f) => Number(f.match(/\d+/)![0]));

    const cards = await db
      .select({ id: schema.bankCardTypes.id, displayName: schema.bankCardTypes.displayName, portalCardId: schema.bankCardTypes.portalCardId })
      .from(schema.bankCardTypes)
      .where(isNotNull(schema.bankCardTypes.portalCardId));

    const remaining = cards.filter((c) => c.portalCardId && !alreadyFetched.includes(c.portalCardId));
    console.log(`Found ${remaining.length} cards without fetched benefits\n`);

    let successCount = 0;

    for (const card of remaining) {
      if (!card.portalCardId) continue;

      console.log(`\n📌 Card: ${card.displayName} (portal ID: ${card.portalCardId})`);
      const outputFile = path.join(dir, `benefits-${card.portalCardId}.json`);

      let success = false;

      // Try each provided cardbinid
      for (const cardbinid of cardbinids) {
        console.log(`  Trying cardbinid: ${cardbinid}...`);

        const services = await portal<PortalService>(
          "Select/getCardServices",
          { userid, cardtypeid: card.portalCardId, cardbinid },
          jwt,
          sid,
        );

        if (services !== null && services.length > 0) {
          console.log(`  ✓ Found ${services.length} categories!`);

          const deals: Record<string, unknown[]> = {};
          for (const s of services) {
            const serviceDeals = await portal("Select/getUserDealsNew", { cardtypeid: String(card.portalCardId), userid, sid: String(s.id), cardbinid: String(cardbinid) }, jwt, sid);
            if (serviceDeals) {
              deals[String(s.id)] = serviceDeals;
              console.log(`    - ${s.servicename || `Category ${s.id}`}: ${serviceDeals.length} offers`);
            }
          }

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
          successCount++;
          break;
        }
      }

      if (!success) {
        console.log(`  ✗ No valid cardbinid found`);
      }
    }

    console.log(`\n✓ Fetched ${successCount} additional cards`);
  });
}

main().catch((e) => {
  console.error("fetch-remaining failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
