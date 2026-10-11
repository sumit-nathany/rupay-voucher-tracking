/**
 * Helper to parse and format RuPay portal cooldown messages and dates.
 *
 * Observed portal message:
 * "Booking Limit Reached: An account is limited to one booking every 24 hours.
 * You already redeemed a benefit recently. Your account will unlock for new bookings
 * 24 hours after your last transaction. Try again after 11 Oct 2026 18:40 hrs."
 */

export function isPortalCooldownMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('booking limit reached') ||
    lower.includes('one booking every 24 hours') ||
    lower.includes('already initiated a transaction') ||
    lower.includes('wait 20 minutes')
  );
}

export function parsePortalCooldownDate(message: string): Date | null {
  // Check for "wait X minutes" or "already initiated a transaction"
  const minMatch = message.match(/wait\s+(\d+)\s+minutes/i);
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    return new Date(Date.now() + mins * 60 * 1000);
  }
  if (message.toLowerCase().includes('already initiated a transaction')) {
    return new Date(Date.now() + 20 * 60 * 1000);
  }

  // Matches "11 Oct 2026 18:40" or "11 Oct 2026 18:40 hrs"
  const match = message.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})/i);
  if (!match) return null;

  const [, dayStr, monthStr, yearStr, hourStr, minStr] = match;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  const month = months[monthStr.toLowerCase()];
  if (month === undefined) return null;

  const day = parseInt(dayStr, 10);
  const year = parseInt(yearStr, 10);
  const hour = parseInt(hourStr, 10);
  const min = parseInt(minStr, 10);

  // Time reported by portal is Asia/Kolkata (IST = UTC+5:30)
  // Convert IST to UTC timestamp
  const utcMs = Date.UTC(year, month, day, hour, min) - 5.5 * 60 * 60 * 1000;
  const date = new Date(utcMs);

  return isNaN(date.getTime()) ? null : date;
}
