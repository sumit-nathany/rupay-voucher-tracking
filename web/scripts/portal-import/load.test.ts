import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../src/test/db";
import {
  bankCardTypes, benefitCatalogVersions, benefitInstances, benefitOptions, benefits, cardHolders, cards, cardVariants, workspaces,
} from "../../src/db/schema";
import type { Database } from "../../src/lib/context";
import { linkPortalIds, replaceCardBenefits } from "./load";
import type { BenefitOut } from "./transform";

let db: Database;
let close: () => Promise<void>;
let typeId: string;

const spa: BenefitOut = {
  benefitType: "Spa Services", benefitProvider: null, exactBenefit: "Any one of 2 offers", frequency: "Quarterly",
  instanceCount: 1, defaultCashValue: 2700, effectiveFrom: "2025-01-01", effectiveTo: "2026-12-31",
  options: [
    { provider: "Spa A", offerName: "Swedish", cashValue: 1850, portalOfferId: 1 },
    { provider: "Spa B", offerName: "Thai", cashValue: 2700, portalOfferId: 2 },
  ],
};
const myntra: BenefitOut = { ...spa, benefitType: "Online Shopping", benefitProvider: "Myntra", exactBenefit: "Rs 500 off", defaultCashValue: 500, options: [] };

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [v] = await db.select().from(cardVariants).where(eq(cardVariants.portalCardType, 41));
  const [t] = await db.insert(bankCardTypes).values({ displayName: "PNB Salary Imperial RuPay Select Card", variantId: v.id }).returning();
  typeId = t.id;
  const [b] = await db.insert(benefits).values({ bankCardTypeId: typeId }).returning();
  await db.insert(benefitCatalogVersions).values({ benefitId: b.id, benefitType: "Old", exactBenefit: "old", frequency: "Annual", effectiveFrom: "2025-01-01" });
});
afterAll(() => close());

describe("portal import loader", () => {
  it("migration set portal variant numbers", async () => {
    const rows = await db.select().from(cardVariants);
    expect(Object.fromEntries(rows.map((r) => [r.name, r.portalCardType]))).toEqual({ "RuPay Select Debit Card": 41, "RuPay Select Credit Card": 42 });
  });

  it("dry run counts and writes nothing", async () => {
    expect(await replaceCardBenefits(db, typeId, [spa, myntra], { dryRun: true })).toEqual({ removed: 1, added: 2, options: 2 });
    expect(await db.select().from(benefitOptions)).toHaveLength(0);
  });

  it("replaces benefits, stores options, marks the card curated", async () => {
    await replaceCardBenefits(db, typeId, [spa, myntra], { dryRun: false });
    const vs = await db.select().from(benefitCatalogVersions);
    expect(vs.map((v) => v.benefitType).sort()).toEqual(["Online Shopping", "Spa Services"]);
    const opts = await db.select().from(benefitOptions);
    expect(opts.map((o) => [o.provider, o.cashValue, o.sortOrder])).toEqual([["Spa A", "1850.00", 0], ["Spa B", "2700.00", 1]]);
    const [t] = await db.select().from(bankCardTypes).where(eq(bankCardTypes.id, typeId));
    expect(t.curationStatus).toBe("curated");
  });

  it("refuses once a benefit is tracked", async () => {
    const [w] = await db.insert(workspaces).values({ name: "W" }).returning();
    const [h] = await db.insert(cardHolders).values({ workspaceId: w.id, name: "H" }).returning();
    const [c] = await db.insert(cards).values({ workspaceId: w.id, holderId: h.id, bankCardTypeId: typeId, displayName: "x" }).returning();
    const [b] = await db.select().from(benefits).where(eq(benefits.bankCardTypeId, typeId));
    await db.insert(benefitInstances).values({
      workspaceId: w.id, cardId: c.id, bankCardTypeId: typeId, benefitId: b.id,
      periodStart: "2026-10-01", periodEnd: "2026-12-31", periodLabel: "Q4", orderDeadline: "2026-12-31",
    });
    await expect(replaceCardBenefits(db, typeId, [spa], { dryRun: false })).rejects.toThrow(/refusing/);
  });

  it("links portal ids by cleaned name within the variant", async () => {
    const r = await linkPortalIds(db, 41, [{ id: 151, cardname: " PNB Salary Imperial RuPay Select Card" }, { id: 9, cardname: "Nope" }], { dryRun: false });
    expect(r).toEqual({ linked: 1, unmatched: ["Nope"] });
    const [t] = await db.select().from(bankCardTypes).where(eq(bankCardTypes.id, typeId));
    expect(t.portalCardId).toBe(151);
  });
});
