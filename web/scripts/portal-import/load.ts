import { and, eq, inArray } from "drizzle-orm";
import {
  bankCardTypes,
  benefitCatalogVersions,
  benefitInstances,
  benefitOptions,
  benefits,
  cardBenefitOverrides,
  cardVariants,
} from "../../src/db/schema";
import type { Database } from "../../src/lib/context";
import { parseCardList } from "../../src/lib/card-list";
import type { BenefitOut } from "./transform";

const money = (n: number | null) => (n == null ? null : n.toFixed(2));

/**
 * Replace a catalog card's benefits with freshly imported ones, in one transaction.
 * Refuses if anyone tracks or overrides those benefits: replacing would orphan
 * their history. (Re-importing a card in use needs versioning, not replacement.)
 */
export async function replaceCardBenefits(
  db: Database,
  bankCardTypeId: string,
  incoming: BenefitOut[],
  { dryRun }: { dryRun: boolean },
): Promise<{ removed: number; added: number; options: number }> {
  return db.transaction(async (tx) => {
    const old = await tx.select({ id: benefits.id }).from(benefits).where(eq(benefits.bankCardTypeId, bankCardTypeId));
    const oldIds = old.map((b) => b.id);
    if (oldIds.length) {
      const [inUse] = await tx.select({ id: benefitInstances.id }).from(benefitInstances).where(inArray(benefitInstances.benefitId, oldIds)).limit(1);
      const [overridden] = await tx.select({ id: cardBenefitOverrides.id }).from(cardBenefitOverrides).where(inArray(cardBenefitOverrides.benefitId, oldIds)).limit(1);
      if (inUse || overridden) throw new Error("Card's benefits are already tracked or overridden; refusing to replace them");
    }
    const counts = { removed: oldIds.length, added: incoming.length, options: incoming.reduce((n, b) => n + b.options.length, 0) };
    if (dryRun) return counts;

    if (oldIds.length) {
      await tx.delete(benefitCatalogVersions).where(inArray(benefitCatalogVersions.benefitId, oldIds)); // options cascade
      await tx.delete(benefits).where(inArray(benefits.id, oldIds));
    }
    for (const b of incoming) {
      const [row] = await tx.insert(benefits).values({ bankCardTypeId }).returning({ id: benefits.id });
      const [ver] = await tx
        .insert(benefitCatalogVersions)
        .values({
          benefitId: row.id,
          benefitType: b.benefitType,
          benefitProvider: b.benefitProvider,
          exactBenefit: b.exactBenefit,
          frequency: b.frequency,
          instanceCount: b.instanceCount,
          defaultCashValue: money(b.defaultCashValue),
          effectiveFrom: b.effectiveFrom,
          effectiveTo: b.effectiveTo,
        })
        .returning({ id: benefitCatalogVersions.id });
      if (b.options.length) {
        await tx.insert(benefitOptions).values(
          b.options.map((o, i) => ({
            versionId: ver.id,
            provider: o.provider,
            offerName: o.offerName,
            cashValue: money(o.cashValue),
            portalOfferId: o.portalOfferId,
            sortOrder: i,
          })),
        );
      }
    }
    await tx.update(bankCardTypes).set({ curationStatus: incoming.length ? "curated" : "no_benefits" }).where(eq(bankCardTypes.id, bankCardTypeId));
    return counts;
  });
}

/** Store the portal's card id on each catalog card, matched by cleaned name within the variant. */
export async function linkPortalIds(
  db: Database,
  portalCardType: number,
  cards: { id: number; cardname: string }[],
  { dryRun }: { dryRun: boolean },
): Promise<{ linked: number; unmatched: string[] }> {
  const [variant] = await db.select({ id: cardVariants.id }).from(cardVariants).where(eq(cardVariants.portalCardType, portalCardType));
  if (!variant) throw new Error(`No variant has portal_card_type ${portalCardType}`);
  const ours = await db
    .select({ id: bankCardTypes.id, displayName: bankCardTypes.displayName })
    .from(bankCardTypes)
    .where(eq(bankCardTypes.variantId, variant.id));
  const byName = new Map(ours.map((t) => [t.displayName.toLowerCase(), t.id]));
  let linked = 0;
  const unmatched: string[] = [];
  for (const c of cards) {
    const name = parseCardList(c.cardname)[0] ?? "";
    const id = byName.get(name.toLowerCase());
    if (!id) {
      unmatched.push(name);
      continue;
    }
    linked++;
    if (!dryRun) await db.update(bankCardTypes).set({ portalCardId: c.id }).where(and(eq(bankCardTypes.id, id)));
  }
  return { linked, unmatched };
}
