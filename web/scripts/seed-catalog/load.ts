// DB loader for the SHARED catalog only: bank_card_types, benefits, benefit_catalog_versions.
// Never touches cards, holders or benefit_instances, and never reads Code / Booking ID values.
// Takes a Database so it works with PGlite (tests) and postgres-js (run.ts). Do not import src/db/index.ts here.
import { and, eq, isNull } from "drizzle-orm";
import { bankCardTypes, benefitCatalogVersions, benefits } from "../../src/db/schema";
import type { Database } from "../../src/lib/context";
import type { TransformResult } from "./types";

export interface LoadCounts {
  bankCardTypesInserted: number;
  bankCardTypesUpdated: number; // curation_status upgraded
  benefitsInserted: number;
  versionsInserted: number;
}

const NETWORK = "RuPay";
// Never move a row to a lower rank.
const RANK: Record<string, number> = { uncurated: 0, no_benefits: 1, curated: 2 };

export async function loadCatalog(
  db: Database,
  result: Pick<TransformResult, "bankCardTypes" | "benefits" | "versions">,
  opts: { dryRun?: boolean } = {},
): Promise<LoadCounts> {
  const dryRun = opts.dryRun ?? false;
  const counts: LoadCounts = {
    bankCardTypesInserted: 0,
    bankCardTypesUpdated: 0,
    benefitsInserted: 0,
    versionsInserted: 0,
  };
  const versionsByBenefit = new Map<string, typeof result.versions>();
  for (const v of result.versions) {
    const l = versionsByBenefit.get(v.benefitKey) ?? [];
    l.push(v);
    versionsByBenefit.set(v.benefitKey, l);
  }

  await db.transaction(async (tx) => {
    // ---- bank card types ----
    const typeIds = new Map<string, string | null>(); // null = would-be-new (dry run)
    for (const t of result.bankCardTypes) {
      const [existing] = await tx
        .select({ id: bankCardTypes.id, curationStatus: bankCardTypes.curationStatus })
        .from(bankCardTypes)
        .where(
          and(
            eq(bankCardTypes.bankName, t.bankName),
            eq(bankCardTypes.cardType, t.cardType),
            eq(bankCardTypes.network, NETWORK),
          ),
        );
      if (!existing) {
        counts.bankCardTypesInserted++;
        if (dryRun) {
          typeIds.set(t.key, null);
        } else {
          const [row] = await tx
            .insert(bankCardTypes)
            .values({
              displayName: t.key,
              bankName: t.bankName,
              cardType: t.cardType,
              network: NETWORK,
              curationStatus: t.curationStatus,
            })
            .returning({ id: bankCardTypes.id });
          typeIds.set(t.key, row.id);
        }
      } else {
        typeIds.set(t.key, existing.id);
        if ((RANK[t.curationStatus] ?? 0) > (RANK[existing.curationStatus] ?? 0)) {
          counts.bankCardTypesUpdated++;
          if (!dryRun)
            await tx
              .update(bankCardTypes)
              .set({ curationStatus: t.curationStatus })
              .where(eq(bankCardTypes.id, existing.id));
        }
      }
    }

    // ---- benefits + versions (identity = card type + type/provider/exact/frequency) ----
    for (const b of result.benefits) {
      const typeId = typeIds.get(b.bankCardTypeKey);
      if (typeId === undefined) throw new Error(`benefit references unknown card type "${b.bankCardTypeKey}"`);
      const versions = versionsByBenefit.get(b.key) ?? [];
      if (versions.length === 0) throw new Error("benefit has no version in transform output");

      let found = false;
      if (typeId !== null) {
        const [hit] = await tx
          .select({ id: benefits.id })
          .from(benefits)
          .innerJoin(benefitCatalogVersions, eq(benefitCatalogVersions.benefitId, benefits.id))
          .where(
            and(
              eq(benefits.bankCardTypeId, typeId),
              eq(benefitCatalogVersions.benefitType, b.benefitType),
              b.benefitProvider === null
                ? isNull(benefitCatalogVersions.benefitProvider)
                : eq(benefitCatalogVersions.benefitProvider, b.benefitProvider),
              eq(benefitCatalogVersions.exactBenefit, b.exactBenefit),
              eq(benefitCatalogVersions.frequency, b.frequency),
            ),
          )
          .limit(1);
        found = !!hit;
      }
      if (found) continue;

      counts.benefitsInserted++;
      counts.versionsInserted += versions.length;
      if (dryRun) continue;
      const [ben] = await tx
        .insert(benefits)
        .values({ bankCardTypeId: typeId! })
        .returning({ id: benefits.id });
      for (const v of versions) {
        await tx.insert(benefitCatalogVersions).values({
          benefitId: ben.id,
          benefitType: v.benefitType,
          benefitProvider: v.benefitProvider,
          exactBenefit: v.exactBenefit,
          frequency: v.frequency,
          instanceCount: v.instanceCount,
          effectiveFrom: v.effectiveFrom,
          effectiveTo: v.effectiveTo,
        });
      }
    }
  });
  return counts;
}
