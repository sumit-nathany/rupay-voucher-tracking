/** Gift vouchers vs discount-style coupons (BookMyShow, MMT, TaxSpanner, etc.). */
export const OFFER_KINDS = ['voucher', 'discount'] as const;
export type OfferKind = (typeof OFFER_KINDS)[number];

const DISCOUNT_PROVIDER_MARKERS = [
  'bookmyshow',
  'makemytrip',
  'mmt',
  'taxspanner',
  'tax spanner',
];

export function isGolfBenefit(
  benefitType: string | null | undefined,
  benefitProvider: string | null | undefined,
  exactBenefit: string | null | undefined,
): boolean {
  const hay = `${benefitProvider ?? ''} ${exactBenefit ?? ''} ${benefitType ?? ''}`.toLowerCase();
  return hay.includes('golf');
}

/**
 * Classify catalog / instance display fields. Used at seed time and as a fallback
 * when `offer_kind` was not set on older rows.
 */
export function inferOfferKind(
  benefitType: string,
  benefitProvider: string | null,
  exactBenefit: string,
): OfferKind {
  if (isGolfBenefit(benefitType, benefitProvider, exactBenefit)) return 'discount';
  const hay = `${benefitProvider ?? ''} ${exactBenefit} ${benefitType}`.toLowerCase();
  if (DISCOUNT_PROVIDER_MARKERS.some((m) => hay.includes(m))) return 'discount';
  if (/\b\d+%\s*instant\s*discount\b/.test(hay)) return 'discount';
  if (/\bflat\s+rs\.?\s*\d+[^a-z]{0,12}discount\b/.test(hay)) return 'discount';
  return 'voucher';
}

export function resolveOfferKind(
  stored: OfferKind | null | undefined,
  benefitType: string,
  benefitProvider: string | null,
  exactBenefit: string,
): OfferKind {
  if (isGolfBenefit(benefitType, benefitProvider, exactBenefit)) return 'discount';
  return stored ?? inferOfferKind(benefitType, benefitProvider, exactBenefit);
}

