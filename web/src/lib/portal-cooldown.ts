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
    lower.includes('transaction is already in process') ||
    lower.includes('transaction in progress') ||
    lower.includes('transaction is pending') ||
    lower.includes('wait 20 minutes') ||
    /wait\s+(?:for\s+)?\d+\s*(?:min|minute)/i.test(message) ||
    /try\s+again\s+after\s+\d+\s*(?:min|minute)/i.test(message)
  );
}

export interface PortalCooldownParsed {
  until: Date;
  reason: 'rate_limited_daily' | 'rate_limited_temporary';
  durationMinutes: number;
}

export function parsePortalCooldown(message: string): PortalCooldownParsed | null {
  // 1. Matches dynamic minutes: "wait 20 minutes", "wait for 15 mins", "try again after 20 minutes", etc.
  const minMatch = message.match(/(?:wait|after|try\s+again\s+after|in)\s+(?:for\s+)?(\d+)\s*(?:min|mins|minute|minutes)/i);
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    return {
      until: new Date(Date.now() + mins * 60 * 1000),
      reason: 'rate_limited_temporary',
      durationMinutes: mins,
    };
  }

  // 2. Matches dynamic hours: "wait 1 hour", "try again after 2 hours"
  const hrMatch = message.match(/(?:wait|after|try\s+again\s+after|in)\s+(?:for\s+)?(\d+)\s*(?:hr|hrs|hour|hours)/i);
  if (hrMatch) {
    const hrs = parseInt(hrMatch[1], 10);
    return {
      until: new Date(Date.now() + hrs * 60 * 60 * 1000),
      reason: hrs >= 24 ? 'rate_limited_daily' : 'rate_limited_temporary',
      durationMinutes: hrs * 60,
    };
  }

  // 3. Fallback for initiated transaction without explicit duration
  const lower = message.toLowerCase();
  if (
    lower.includes('already initiated a transaction') ||
    lower.includes('transaction is already in process') ||
    lower.includes('transaction in progress') ||
    lower.includes('transaction is pending')
  ) {
    return {
      until: new Date(Date.now() + 20 * 60 * 1000),
      reason: 'rate_limited_temporary',
      durationMinutes: 20,
    };
  }

  // 4. Matches exact timestamp: "11 Oct 2026 18:40" or "11 Oct 2026 18:40 hrs"
  const dateMatch = message.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})/i);
  if (dateMatch) {
    const [, dayStr, monthStr, yearStr, hourStr, minStr] = dateMatch;
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };

    const month = months[monthStr.toLowerCase()];
    if (month !== undefined) {
      const day = parseInt(dayStr, 10);
      const year = parseInt(yearStr, 10);
      const hour = parseInt(hourStr, 10);
      const min = parseInt(minStr, 10);

      // Time reported by portal is Asia/Kolkata (IST = UTC+5:30)
      const utcMs = Date.UTC(year, month, day, hour, min) - 5.5 * 60 * 60 * 1000;
      const date = new Date(utcMs);
      if (!isNaN(date.getTime())) {
        const diffMinutes = Math.max(1, Math.round((date.getTime() - Date.now()) / (60 * 1000)));
        return {
          until: date,
          reason: 'rate_limited_daily',
          durationMinutes: diffMinutes,
        };
      }
    }
  }

  return null;
}

export function parsePortalCooldownDate(message: string): Date | null {
  const parsed = parsePortalCooldown(message);
  return parsed?.until ?? null;
}
