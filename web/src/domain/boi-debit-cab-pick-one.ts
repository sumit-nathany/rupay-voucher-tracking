/** Bank of India RuPay Select Debit — shared catalog ids (stable across envs). */
export const BOI_SELECT_DEBIT_BANK_CARD_TYPE_ID = '6ea891d3-25e3-4b77-974f-485423443ace';
export const BOI_SELECT_DEBIT_CAB_BENEFIT_ID = '54a0d991-3147-40b4-8bc7-15cac91e9089';
export const BOI_SELECT_DEBIT_CAB_VERSION_ID = '8e7921d8-f039-4f00-b069-976973aa1fe3';
export const BOI_SELECT_DEBIT_CAB_OLA_OPTION_ID = '7c4e6a10-b011-4cab-8001-010000000001';
export const BOI_SELECT_DEBIT_CAB_UBER_OPTION_ID = '7c4e6a10-b011-4cab-8001-010000000002';

/** Retired when cab pick-one shipped (see drizzle/0005_boi_debit_cab_pick_one.sql). */
export const BOI_SELECT_DEBIT_CAB_UBER_BENEFIT_ID = '899823cc-b1d4-43b3-aaf0-828611fe5fb6';

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
 * Product rule: one quarterly redemption, chosen per period (same as spa pick-one).
 */
export function mergeBoiSelectDebitOlaUberCab<T extends CabOfferLike>(benefits: T[]): T[] {
  const cabOffers = benefits.filter(isStandaloneOlaUberCab);
  if (cabOffers.length !== 2) return benefits;
  const providers = new Set(cabOffers.map((b) => b.benefitProvider!.trim().toLowerCase()));
  if (!providers.has('ola') || !providers.has('uber')) return benefits;

  const ola = cabOffers.find((b) => b.benefitProvider!.toLowerCase().startsWith('ola'))!;
  const uber = cabOffers.find((b) => b.benefitProvider!.toLowerCase().startsWith('uber'))!;
  const rest = benefits.filter((b) => !cabOffers.includes(b));
  const values = [ola.defaultCashValue, uber.defaultCashValue].filter((v): v is number => v != null);
  const merged = {
    benefitType: ola.benefitType,
    benefitProvider: null,
    exactBenefit: 'Any one of 2 offers',
    frequency: ola.frequency,
    instanceCount: Math.max(ola.instanceCount, uber.instanceCount, 1),
    defaultCashValue: values.length ? Math.max(...values) : null,
    effectiveFrom: [ola.effectiveFrom, uber.effectiveFrom].sort()[0],
    effectiveTo: null,
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
  } as T;

  return [...rest, merged];
}
