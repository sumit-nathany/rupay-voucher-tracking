/**
 * Ingestion helper for RuPay portal API import.
 *
 * Portal import lists Ola and Uber as separate Cab/Travel offers for BOI Select Debit.
 * Product terms treat it as one quarterly redemption, chosen per period (pick-one).
 */

export interface CabOfferLike {
  benefitType: string;
  benefitProvider: string | null;
  exactBenefit: string;
  frequency: string;
  instanceCount: number;
  defaultCashValue: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  options: readonly {
    provider: string;
    offerName: string;
    cashValue: number | null;
    portalOfferId: number | null;
  }[];
}

const CAB_TYPES = /^(cab services|travel)$/i;
const CAB_PROVIDER = /^(ola|uber)$/i;

/** Loosely match BOI Select Debit catalog cards (display name omits "Debit" on some rows). */
export function isBoiSelectDebitCatalogCard(displayName: string): boolean {
  const n = displayName.toLowerCase();
  const isBoi = n.includes('bank of india') || /\bboi\b/.test(n);
  if (!isBoi || !n.includes('select')) return false;
  if (n.includes('credit')) return false;
  return n.includes('debit') || !n.includes('credit');
}

function isStandaloneOlaUberCab(b: CabOfferLike): boolean {
  return (
    CAB_TYPES.test(b.benefitType.trim()) &&
    b.benefitProvider != null &&
    CAB_PROVIDER.test(b.benefitProvider.trim()) &&
    b.options.length === 0
  );
}

/**
 * Portal import lists Ola and Uber as separate Cab/Travel offers for BOI Select Debit.
 * Ingestion rule: combine them into one quarterly pick-one benefit.
 */
export function mergeBoiSelectDebitOlaUberCab<T extends CabOfferLike>(benefits: T[]): T[] {
  const cabOffers = benefits.filter(isStandaloneOlaUberCab);
  if (cabOffers.length !== 2) return benefits;
  const providers = new Set(cabOffers.map((b) => b.benefitProvider!.trim().toLowerCase()));
  if (!providers.has('ola') || !providers.has('uber')) return benefits;

  const rest = benefits.filter((b) => !isStandaloneOlaUberCab(b));
  const ola = cabOffers.find((b) => b.benefitProvider!.trim().toLowerCase() === 'ola')!;
  const uber = cabOffers.find((b) => b.benefitProvider!.trim().toLowerCase() === 'uber')!;

  const merged = {
    benefitType: 'Cab Services',
    benefitProvider: null,
    exactBenefit: 'Any one of 2 offers',
    frequency: 'Quarterly',
    instanceCount: 1,
    defaultCashValue: ola.defaultCashValue ?? uber.defaultCashValue ?? 100,
    effectiveFrom: ola.effectiveFrom <= uber.effectiveFrom ? ola.effectiveFrom : uber.effectiveFrom,
    effectiveTo:
      ola.effectiveTo && uber.effectiveTo
        ? ola.effectiveTo >= uber.effectiveTo
          ? ola.effectiveTo
          : uber.effectiveTo
        : null,
    options: [
      {
        provider: ola.benefitProvider!.trim(),
        offerName: ola.exactBenefit,
        cashValue: ola.defaultCashValue,
        portalOfferId: null,
      },
      {
        provider: uber.benefitProvider!.trim(),
        offerName: uber.exactBenefit,
        cashValue: uber.defaultCashValue,
        portalOfferId: null,
      },
    ].sort((a, b) => a.provider.localeCompare(b.provider)),
  } as unknown as T;

  return [...rest, merged];
}
