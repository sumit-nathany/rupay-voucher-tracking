import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../src/test/db";
import { bankCardTypes, benefitCatalogVersions, benefits } from "../../src/db/schema";
import type { Database } from "../../src/lib/context";
import { loadCatalog } from "./load";
import type { BenefitOut, TransformResult, VersionOut } from "./types";

// Synthetic data only.
const mkBenefit = (o: Partial<BenefitOut> & { key: string }): BenefitOut => ({
  bankCardTypeKey: "TestBank Select",
  benefitType: "Entertainment",
  benefitProvider: "BookMyShow",
  exactBenefit: "Movie",
  frequency: "Quarterly",
  ...o,
});
const mkVersion = (b: BenefitOut, o: Partial<VersionOut> = {}): VersionOut => ({
  benefitKey: b.key,
  benefitType: b.benefitType,
  benefitProvider: b.benefitProvider,
  exactBenefit: b.exactBenefit,
  frequency: b.frequency,
  instanceCount: 1,
  effectiveFrom: "2025-01-01",
  effectiveTo: null,
  ...o,
});

const bmsOld = mkBenefit({ key: "bms-old", frequency: "Quarterly" });
const bmsNew = mkBenefit({ key: "bms-new", frequency: "Monthly" });
const noProv = mkBenefit({ key: "np", benefitProvider: null, exactBenefit: "Lounge", frequency: "Annual" });
const other = mkBenefit({ key: "o", bankCardTypeKey: "Other Gold", benefitType: "Dining", benefitProvider: "X", exactBenefit: "Meal" });
const data: Pick<TransformResult, "bankCardTypes" | "benefits" | "versions"> = {
  bankCardTypes: [
    { key: "TestBank Select", bankName: "TestBank", cardType: "Select", curationStatus: "curated" },
    { key: "Other Gold", bankName: "Other", cardType: "Gold", curationStatus: "curated" },
  ],
  benefits: [bmsOld, bmsNew, noProv, other],
  versions: [
    mkVersion(bmsOld, { effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" }),
    mkVersion(bmsNew, { effectiveFrom: "2026-01-01" }),
    mkVersion(noProv, { effectiveFrom: "2025-01-01" }),
    mkVersion(other, { effectiveFrom: "2025-04-01" }),
  ],
};

describe("loadCatalog", () => {
  let db: Database;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => close());

  const tally = async () => ({
    types: (await db.select().from(bankCardTypes)).length,
    ben: (await db.select().from(benefits)).length,
    ver: (await db.select().from(benefitCatalogVersions)).length,
  });

  it("dry run writes nothing but reports counts", async () => {
    const c = await loadCatalog(db, data, { dryRun: true });
    expect(c).toMatchObject({ bankCardTypesInserted: 2, benefitsInserted: 4, versionsInserted: 4 });
    expect(await tally()).toEqual({ types: 0, ben: 0, ver: 0 });
  });

  it("first load inserts expected counts as curated", async () => {
    const c = await loadCatalog(db, data);
    expect(c).toEqual({ bankCardTypesInserted: 2, bankCardTypesUpdated: 0, benefitsInserted: 4, versionsInserted: 4 });
    expect(await tally()).toEqual({ types: 2, ben: 4, ver: 4 });
    const types = await db.select().from(bankCardTypes);
    expect(types.every((t) => t.curationStatus === "curated" && t.network === "RuPay")).toBe(true);
  });

  it("BookMyShow-style fork yields two benefits with right effective dates", async () => {
    const rows = await db
      .select({ f: benefitCatalogVersions.frequency, from: benefitCatalogVersions.effectiveFrom, to: benefitCatalogVersions.effectiveTo, id: benefits.id })
      .from(benefitCatalogVersions)
      .innerJoin(benefits, eq(benefits.id, benefitCatalogVersions.benefitId))
      .where(eq(benefitCatalogVersions.benefitProvider, "BookMyShow"));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    const q = rows.find((r) => r.f === "Quarterly")!;
    const m = rows.find((r) => r.f === "Monthly")!;
    expect([q.from, q.to]).toEqual(["2025-01-01", "2025-12-31"]);
    expect([m.from, m.to]).toEqual(["2026-01-01", null]);
  });

  it("allows NULL provider", async () => {
    const rows = await db.select().from(benefitCatalogVersions).where(eq(benefitCatalogVersions.exactBenefit, "Lounge"));
    expect(rows).toHaveLength(1);
    expect(rows[0].benefitProvider).toBeNull();
  });

  it("second load inserts nothing", async () => {
    const c = await loadCatalog(db, data);
    expect(c).toEqual({ bankCardTypesInserted: 0, bankCardTypesUpdated: 0, benefitsInserted: 0, versionsInserted: 0 });
    expect(await tally()).toEqual({ types: 2, ben: 4, ver: 4 });
  });

  it("never downgrades curation_status, upgrades uncurated", async () => {
    await db.update(bankCardTypes).set({ curationStatus: "uncurated" }).where(eq(bankCardTypes.bankName, "Other"));
    const downgrade = {
      ...data,
      bankCardTypes: data.bankCardTypes.map((t) => ({ ...t, curationStatus: "no_benefits" as const })),
    };
    await loadCatalog(db, downgrade);
    const by = Object.fromEntries((await db.select().from(bankCardTypes)).map((t) => [t.bankName, t.curationStatus]));
    expect(by).toEqual({ TestBank: "curated", Other: "no_benefits" });
    await loadCatalog(db, data);
    const again = Object.fromEntries((await db.select().from(bankCardTypes)).map((t) => [t.bankName, t.curationStatus]));
    expect(again.Other).toBe("curated");
  });
});
