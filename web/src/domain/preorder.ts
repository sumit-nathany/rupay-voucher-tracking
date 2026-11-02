import type { Database } from '../lib/context';
import * as schema from '../db/schema';
import { and, eq, gte, inArray, isNull, ne } from 'drizzle-orm';

export interface PreorderOption {
  id: string;
  provider: string;
  offerName: string;
  cashValue: string | null;
}

export interface PreorderBenefit {
  instanceId: string;
  benefitId: string | null;
  bankCardTypeId: string;
  benefitType: string;
  benefitProvider: string;
  exactBenefit: string;
  cashValue: string;
  options: PreorderOption[];
}

/**
 * Returns all unredeemed benefits for a card in the current period,
 * filtering out any benefits already locked/redeemed on this portal account
 * due to RuPay's (portal_account, bank_card_type, period) entitlement rule.
 */
export async function getAvailableBenefitsForPreorder(
  db: Database,
  params: {
    workspaceId: string;
    cardId: string;
    portalAccountId: string;
    bankCardTypeId: string;
    periodStart: string;
    today: string;
  },
): Promise<PreorderBenefit[]> {
  const { workspaceId, cardId, portalAccountId, bankCardTypeId, periodStart, today } = params;

  // 1. Fetch all unredeemed, active instances for this card in this period
  const instances = await db
    .select({
      id: schema.benefitInstances.id,
      bankCardTypeId: schema.benefitInstances.bankCardTypeId,
      benefitId: schema.benefitInstances.benefitId,
      generatedFromVersion: schema.benefitInstances.generatedFromVersion,
      orderDeadline: schema.benefitInstances.orderDeadline,
      cashValue: schema.benefitInstances.cashValue,
      portalRefusal: schema.benefitInstances.portalRefusal,
      orderStatus: schema.benefitInstances.orderStatus,
    })
    .from(schema.benefitInstances)
    .where(
      and(
        eq(schema.benefitInstances.workspaceId, workspaceId),
        eq(schema.benefitInstances.cardId, cardId),
        eq(schema.benefitInstances.periodStart, periodStart),
        eq(schema.benefitInstances.orderStatus, 'Not Ordered'),
        gte(schema.benefitInstances.orderDeadline, today),
        isNull(schema.benefitInstances.portalRefusal),
      ),
    );

  if (instances.length === 0) return [];

  // 2. RuPay Truztee multi-card conflict filter:
  // Truztee enforces entitlement at (portal_account, bank_card_type, period) level.
  // Check which benefits this portal account has already redeemed on this card type in this period:
  const redeemedRows = await db
    .select({
      benefitId: schema.benefitInstances.benefitId,
    })
    .from(schema.benefitInstances)
    .where(
      and(
        eq(schema.benefitInstances.portalAccountId, portalAccountId),
        eq(schema.benefitInstances.bankCardTypeId, bankCardTypeId),
        eq(schema.benefitInstances.periodStart, periodStart),
        ne(schema.benefitInstances.orderStatus, 'Not Ordered'),
        ne(schema.benefitInstances.orderStatus, 'Withdrawn'),
        ne(schema.benefitInstances.orderStatus, 'Skipped'),
      ),
    );

  const lockedBenefitIds = new Set(
    redeemedRows.map((r) => r.benefitId).filter((id): id is string => Boolean(id)),
  );

  const eligible = instances.filter(
    (inst) => !inst.benefitId || !lockedBenefitIds.has(inst.benefitId),
  );

  if (eligible.length === 0) return [];

  // 3. Enrich with catalog version and options
  const versionIds = Array.from(
    new Set(eligible.map((i) => i.generatedFromVersion).filter((id): id is string => Boolean(id))),
  );

  const versions =
    versionIds.length > 0
      ? await db
          .select({
            id: schema.benefitCatalogVersions.id,
            benefitType: schema.benefitCatalogVersions.benefitType,
            benefitProvider: schema.benefitCatalogVersions.benefitProvider,
            exactBenefit: schema.benefitCatalogVersions.exactBenefit,
            defaultCashValue: schema.benefitCatalogVersions.defaultCashValue,
          })
          .from(schema.benefitCatalogVersions)
          .where(inArray(schema.benefitCatalogVersions.id, versionIds))
      : [];
  const versionMap = new Map(versions.map((v) => [v.id, v]));

  const allOptions =
    versionIds.length > 0
      ? await db
          .select({
            id: schema.benefitOptions.id,
            versionId: schema.benefitOptions.versionId,
            provider: schema.benefitOptions.provider,
            offerName: schema.benefitOptions.offerName,
            cashValue: schema.benefitOptions.cashValue,
          })
          .from(schema.benefitOptions)
          .where(inArray(schema.benefitOptions.versionId, versionIds))
      : [];

  const optionsByVersion = new Map<string, PreorderOption[]>();
  for (const opt of allOptions) {
    const list = optionsByVersion.get(opt.versionId) || [];
    list.push({
      id: opt.id,
      provider: opt.provider,
      offerName: opt.offerName,
      cashValue: opt.cashValue,
    });
    optionsByVersion.set(opt.versionId, list);
  }

  const results: PreorderBenefit[] = [];
  for (const inst of eligible) {
    const version = inst.generatedFromVersion ? versionMap.get(inst.generatedFromVersion) : undefined;
    const opts = inst.generatedFromVersion ? optionsByVersion.get(inst.generatedFromVersion) ?? [] : [];
    results.push({
      instanceId: inst.id,
      benefitId: inst.benefitId,
      bankCardTypeId: inst.bankCardTypeId,
      benefitType: version?.benefitType || 'Benefit',
      benefitProvider: version?.benefitProvider || '',
      exactBenefit: version?.exactBenefit || 'RuPay Benefit',
      cashValue: inst.cashValue || version?.defaultCashValue || '0',
      options: opts,
    });
  }

  return results;
}
