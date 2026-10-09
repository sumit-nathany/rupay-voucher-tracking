import fs from "node:fs";
import { eq, isNotNull } from "drizzle-orm";
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
    if (!res.ok) {
      return null;
    }
    const env = (await res.json()) as { payload: string };
    const p = JSON.parse(env.payload) as { code: number | string; message: string; response?: T[] };
    await sleep(300); // shorter delay for rapid testing
    if (String(p.code) === "0") {
      return p.response ?? [];
    }
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

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const cardIdStr = arg("--card");
  const maxBin = Number(arg("--max-bin")) || 5000;

  if (!cardIdStr) throw new Error("usage: find-cardbin.ts --card <portal-card-id> [--max-bin 5000]");

  const cardId = Number(cardIdStr);
  if (!cardId) throw new Error("--card must be a number");

  const jwtFile = process.env.PORTAL_JWT_FILE;
  const sidFile = process.env.PORTAL_SESSIONID_FILE;
  if (!jwtFile || !sidFile) throw new Error("PORTAL_JWT_FILE and PORTAL_SESSIONID_FILE must point at files");

  const jwt = fs.readFileSync(jwtFile, "utf8").trim();
  const sid = fs.readFileSync(sidFile, "utf8").trim();
  if (!jwt || !sid) throw new Error("token/sessionid file is empty");

  // Extract loginId from JWT
  const payload = jwt.split(".")[1];
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as { loginId: string };
  const userid = decoded.loginId;

  const card = await withDb(async (db) => {
    const [c] = await db
      .select({ displayName: schema.bankCardTypes.displayName })
      .from(schema.bankCardTypes)
      .where(eq(schema.bankCardTypes.portalCardId, cardId));
    return c;
  });

  if (!card) {
    console.log(`Card ${cardId} not found in catalog`);
    return;
  }

  console.log(`\nSearching for cardbinid for: ${card.displayName} (portal ID: ${cardId})`);
  console.log(`Trying cardbinids from ${cardId} to ${cardId + maxBin}...\n`);

  let found = false;
  const batchSize = 100;

  for (let batch = 0; batch < maxBin; batch += batchSize) {
    const start = cardId + batch;
    const end = cardId + Math.min(batch + batchSize, maxBin);
    process.stdout.write(`  Testing ${start}-${end}... `);

    for (let offset = 0; offset < batchSize && batch + offset < maxBin; offset++) {
      const cardbinid = cardId + batch + offset;

      const services = await portal<PortalService>(
        "Select/getCardServices",
        { userid, cardtypeid: cardId, cardbinid },
        jwt,
        sid,
      );

      if (services !== null && services.length > 0) {
        console.log(`\n✓ FOUND! cardbinid: ${cardbinid}`);
        console.log(`  Services: ${services.map((s) => s.servicename).join(", ")}`);
        found = true;
        break;
      }
    }

    if (found) break;
    console.log("no match");
  }

  if (!found) {
    console.log(`\n✗ No valid cardbinid found in range 1-${maxBin}`);
  }
}

main().catch((e) => {
  console.error("find-cardbin failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
