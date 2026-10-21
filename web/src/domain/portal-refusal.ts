/**
 * Portal refusal vocabulary.
 *
 * A portal refusal is when the RuPay portal or the bank refuses an order
 * outright: the benefit is not available for this card, the card's limit for
 * this benefit is already used up, or the portal says the benefit was already
 * ordered on that card.
 *
 * It is recorded in its own columns on the benefit instance rather than as an
 * `order_status` value, because it is a fact about the *portal's* view of the
 * entitlement, not a stage of the order. See REQUIREMENTS.md §6 and RH#16.
 *
 * This module is deliberately free of imports so it can be used from the
 * client (labels), the worker (classification) and the server (persistence)
 * without dragging `node:crypto` or the schema into a client bundle.
 */

/** What the portal said, in controlled terms. */
export const PORTAL_REFUSAL_CODES = [
  /** The benefit is not available for this card. */
  'benefit_unavailable',
  /** The card's redemption limit for this benefit is already used up. */
  'card_limit_reached',
  /** The portal says the benefit was already ordered on this card. */
  'already_ordered',
] as const;
export type PortalRefusalCode = (typeof PORTAL_REFUSAL_CODES)[number];

/** Who said it. */
export const PORTAL_REFUSAL_SOURCES = ['rupay_portal', 'bank'] as const;
export type PortalRefusalSource = (typeof PORTAL_REFUSAL_SOURCES)[number];

/** Short label for the status, shown wherever the refusal is surfaced. */
export const PORTAL_REFUSAL_LABELS: Record<PortalRefusalCode, string> = {
  benefit_unavailable: 'Not available for this card',
  card_limit_reached: 'Card limit reached',
  already_ordered: 'Already ordered on this card',
};

/** Label for the source, e.g. "RuPay portal" / "Bank". */
export const PORTAL_REFUSAL_SOURCE_LABELS: Record<PortalRefusalSource, string> = {
  rupay_portal: 'RuPay portal',
  bank: 'Bank',
};

/**
 * Phrases the portal and the bank actually use, mapped to a code.
 *
 * Order matters: the "already" phrases are checked first, because a message
 * like "offer already availed" also reads like a limit message.
 */
const PHRASES: ReadonlyArray<{ code: PortalRefusalCode; phrases: readonly string[] }> = [
  {
    code: 'already_ordered',
    phrases: [
      'offer already availed',
      'already availed',
      'already redeemed',
      'already ordered',
      'already used',
    ],
  },
  {
    code: 'card_limit_reached',
    phrases: [
      'maximum uses exhausted',
      'uses exhausted on this card',
      'exhausted on this card',
      'limit exceeded on this card',
      'redemption limit',
      'limit reached',
      'uses exhausted',
    ],
  },
  {
    code: 'benefit_unavailable',
    phrases: [
      'offer not available',
      'benefit not available',
      'not available for this card',
      'not available for this benefit',
      'card not eligible',
      'not eligible for this card',
      'not eligible for this benefit',
      'not applicable for this card',
    ],
  },
];

/**
 * Classifies a portal or bank message.
 *
 * Returns null when the text does not describe a refusal. A declined payment
 * or a failed transaction is deliberately *not* a refusal: those are transient
 * payment failures that stay on the attempt, because the benefit is still
 * available and worth retrying.
 */
export function classifyPortalRefusal(text: string | null | undefined): PortalRefusalCode | null {
  if (!text) return null;
  const t = text.toLowerCase();
  for (const { code, phrases } of PHRASES) {
    if (phrases.some((p) => t.includes(p))) return code;
  }
  return null;
}

/**
 * Builds the sentence shown to the user. Kept here so the worker, the drawer
 * and any future surface phrase it identically.
 */
export function portalRefusalSentence(
  code: PortalRefusalCode,
  source: PortalRefusalSource,
  detail?: string | null,
): string {
  const who = PORTAL_REFUSAL_SOURCE_LABELS[source];
  const what = PORTAL_REFUSAL_LABELS[code];
  const extra = detail ? ` The portal said: "${detail.trim()}"` : '';
  return `${who}: ${what}.${extra}`;
}
