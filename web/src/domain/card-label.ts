/**
 * Canonical card display label across the app:
 * `Mummy • <Card Nick Name or Name> (xx<last 4 digits>)`
 */
export function formatCardLabel({
  holderName,
  cardName,
  lastDigits,
}: {
  holderName?: string | null;
  cardName: string;
  lastDigits?: string | null;
}): string {
  const digits = lastDigits ? ` (xx${lastDigits.trim()})` : '';
  const card = cardName.trim();
  const holder = holderName?.trim();
  return holder ? `${holder} • ${card}${digits}` : `${card}${digits}`;
}
