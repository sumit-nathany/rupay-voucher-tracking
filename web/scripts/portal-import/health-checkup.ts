/**
 * Ingestion helper for RuPay portal API import.
 *
 * Combines separate Thyrocare and SRL Diagnostics health checkup offers
 * into one pick-one benefit ("Any one of 2 offers") per entitlement period.
 */

import type { CabOfferLike } from './boi-cab';

export function mergeHealthCheckupOffers<T extends CabOfferLike>(benefits: T[]): T[] {
  const healthOffers = benefits.filter(
    (b) =>
      /health\s*check\s*up/i.test(b.benefitType.trim()) &&
      b.benefitProvider != null &&
      /^(thyrocare|srl|srl diagnostics)$/i.test(b.benefitProvider.trim()) &&
      b.options.length === 0
  );
  if (healthOffers.length < 2) return benefits;

  const thyrocare = healthOffers.find((b) => b.benefitProvider!.trim().toLowerCase() === 'thyrocare');
  const srl = healthOffers.find((b) => /^(srl|srl diagnostics)$/i.test(b.benefitProvider!.trim()));
  if (!thyrocare || !srl) return benefits;

  const rest = benefits.filter((b) => !healthOffers.includes(b));

  const merged = {
    benefitType: 'Health Check Up',
    benefitProvider: null,
    exactBenefit: 'Any one of 2 offers',
    frequency: thyrocare.frequency,
    instanceCount: Math.max(thyrocare.instanceCount, srl.instanceCount),
    defaultCashValue: Math.max(thyrocare.defaultCashValue ?? 0, srl.defaultCashValue ?? 0) || null,
    effectiveFrom: thyrocare.effectiveFrom <= srl.effectiveFrom ? thyrocare.effectiveFrom : srl.effectiveFrom,
    effectiveTo: null,
    options: [
      {
        provider: 'Thyrocare',
        offerName: thyrocare.exactBenefit,
        cashValue: thyrocare.defaultCashValue,
        portalOfferId: null,
      },
      {
        provider: 'SRL Diagnostics',
        offerName: srl.exactBenefit,
        cashValue: srl.defaultCashValue,
        portalOfferId: null,
      },
    ].sort((a, b) => a.provider.localeCompare(b.provider)),
  } as unknown as T;

  return [...rest, merged];
}
