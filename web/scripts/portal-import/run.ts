// RuPay portal -> catalog. See docs/rupay-portal-api.md. Writes only with --write.
//
//   fetch-cards <dir>                      Public card lists for every variant with a portal_card_type.
//   link-ids <dir> [--write]               Store each card's portal id (from fetch-cards output).
//   fetch-benefits <dir> --card <id> --bin <cardbinid>
//                                          Reads the session from the files named by PORTAL_JWT_FILE and
//                                          PORTAL_SESSIONID_FILE, plus PORTAL_USER_ID. The token is never on a command line.
//   import <dir> --card <id> [--write]     Replace that card's catalog benefits from fetch-benefits output.
//
// DATABASE_URL must point at the target database. Never commits the session values anywhere.
import fs from "node:fs";
import path from "node:path";
import { eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema";
import type { Database } from "../../src/lib/context";
import { linkPortalIds, replaceCardBenefits } from "./load";
import { transformCard, type PortalDeal, type PortalService } from "./transform";

const API = "https://apirupayselect.truztee.com/api";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function portal<T>(endpoint: string, body: object, auth = false): Promise<T[]> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    origin: "https://rupayselect.truztee.com",
    referer: "https://rupayselect.truztee.com/",
    "x-requested-with": "XMLHttpRequest",
  };
  if (auth) {
    // Read the session from files, never from argv/env, so the token never appears in a command line.
    const jwtFile = process.env.PORTAL_JWT_FILE;
    const sidFile = process.env.PORTAL_SESSIONID_FILE;
    if (!jwtFile || !sidFile) throw new Error("PORTAL_JWT_FILE and PORTAL_SESSIONID_FILE must point at files holding the token and sessionid");
    const jwt = fs.readFileSync(jwtFile, "utf8").trim();
    const sid = fs.readFileSync(sidFile, "utf8").trim();
    if (!jwt || !sid) throw new Error("token/sessionid file is empty");
    headers.cookie = `jwt=${jwt}`;
    headers.sessionid = sid;
  }
  const res = await fetch(`${API}/${endpoint}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
  const env = (await res.json()) as { payload: string };
  const p = JSON.parse(env.payload) as { code: number | string; message: string; response?: T[] };
  await sleep(1000); // be gentle with the portal
  return String(p.code) === "0" ? (p.response ?? []) : [];
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const write = process.argv.includes("--write");
const readJson = <T>(f: string): T => JSON.parse(fs.readFileSync(f, "utf8")) as T;

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
  const [cmd, dir] = process.argv.slice(2);
  if (!cmd || !dir) throw new Error("usage: run.ts <fetch-cards|link-ids|fetch-benefits|import> <dir> ...");
  fs.mkdirSync(dir, { recursive: true });

  if (cmd === "fetch-cards") {
    const variants = await withDb((db) => db.select().from(schema.cardVariants).where(isNotNull(schema.cardVariants.portalCardType)));
    for (const v of variants) {
      const cards = await portal<{ id: number; cardname: string }>("Public/getCardNames", { cardtype: v.portalCardType });
      fs.writeFileSync(path.join(dir, `cards-${v.portalCardType}.json`), JSON.stringify(cards, null, 1));
      console.log(`${v.name} (${v.portalCardType}): ${cards.length} cards`);
    }
    return;
  }

  if (cmd === "link-ids") {
    await withDb(async (db) => {
      for (const f of fs.readdirSync(dir).filter((f) => /^cards-\d+\.json$/.test(f))) {
        const type = Number(f.match(/\d+/)![0]);
        const r = await linkPortalIds(db, type, readJson(path.join(dir, f)), { dryRun: !write });
        console.log(`${write ? "linked" : "would link"} ${r.linked} for cardtype ${type}; unmatched:`, r.unmatched);
      }
    });
    return;
  }

  const card = Number(arg("--card"));
  if (!card) throw new Error("--card <portal card id> is required");

  if (cmd === "fetch-benefits") {
    const bin = arg("--bin");
    const userid = Number(process.env.PORTAL_USER_ID);
    if (!bin || !userid) throw new Error("--bin and PORTAL_USER_ID (your login id) are required");
    const services = await portal<PortalService>("Select/getCardServices", { userid, cardtypeid: card, cardbinid: Number(bin) }, true);
    const deals: Record<string, PortalDeal[]> = {};
    for (const s of services) {
      deals[String(s.id)] = await portal<PortalDeal>("Select/getUserDealsNew", { cardtypeid: String(card), userid, sid: String(s.id), cardbinid: bin }, true);
    }
    // Keep only fields we use: the raw deals also carry provider staff contact details.
    const keep = (d: PortalDeal) => ({ servicename: d.servicename, spname: d.spname, productname: d.productname, cvalidity: d.cvalidity, complimentaryCount: d.complimentaryCount, netrate: d.netrate, startdate: d.startdate, enddate: d.enddate, productid: d.productid });
    const out = { card, fetchedAt: new Date().toISOString(), services: services.map(({ id, servicename, description, ddescription }) => ({ id, servicename, description, ddescription })), deals: Object.fromEntries(Object.entries(deals).map(([k, v]) => [k, v.map(keep)])) };
    fs.writeFileSync(path.join(dir, `benefits-${card}.json`), JSON.stringify(out, null, 1));
    console.log(`card ${card}: ${services.length} categories, ${Object.values(deals).flat().length} offers`);
    if (services.length === 0) console.log("No categories: wrong --bin, expired session, or the card has none.");
    return;
  }

  if (cmd === "import") {
    const data = readJson<{ services: PortalService[]; deals: Record<string, PortalDeal[]> }>(path.join(dir, `benefits-${card}.json`));
    const { benefits, warnings } = transformCard(data.services, new Map(Object.entries(data.deals)));
    for (const b of benefits) {
      console.log(`  ${b.benefitType} | ${b.benefitProvider ?? "(choose one)"} | ${b.exactBenefit} | ${b.frequency} x${b.instanceCount} | ${b.defaultCashValue ?? "-"} | ${b.effectiveFrom}..${b.effectiveTo ?? ""}`);
      for (const o of b.options) console.log(`      - ${o.provider}: ${o.offerName} (${o.cashValue ?? "-"})`);
    }
    for (const w of warnings) console.log("  warning:", w);
    await withDb(async (db) => {
      const [t] = await db.select({ id: schema.bankCardTypes.id, name: schema.bankCardTypes.displayName }).from(schema.bankCardTypes).where(eq(schema.bankCardTypes.portalCardId, card));
      if (!t) throw new Error(`No catalog card has portal_card_id ${card}; run link-ids first`);
      const r = await replaceCardBenefits(db, t.id, benefits, { dryRun: !write });
      console.log(`${t.name}: ${write ? "replaced" : "DRY RUN, would replace"}`, r);
    });
    return;
  }
  throw new Error(`unknown command ${cmd}`);
}

main().catch((e) => {
  console.error("portal-import failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
