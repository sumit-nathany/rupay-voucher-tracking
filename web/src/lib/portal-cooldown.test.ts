import { describe, it, expect } from 'vitest';
import { isPortalCooldownMessage, parsePortalCooldownDate } from './portal-cooldown';

describe('portal cooldown parsing', () => {
  it('identifies portal cooldown error messages', () => {
    expect(
      isPortalCooldownMessage(
        'Booking Limit Reached: An account is limited to one booking every 24 hours. Try again after 11 Oct 2026 18:40 hrs.',
      ),
    ).toBe(true);
    expect(isPortalCooldownMessage('Invalid OTP')).toBe(false);
  });

  it('parses portal IST date into correct UTC date', () => {
    const msg =
      'Booking Limit Reached: An account is limited to one booking every 24 hours. You already redeemed a benefit recently. Your account will unlock for new bookings 24 hours after your last transaction. Try again after 11 Oct 2026 18:40 hrs.';
    const date = parsePortalCooldownDate(msg);
    expect(date).not.toBeNull();
    expect(date?.toISOString()).toBe('2026-10-11T13:10:00.000Z');
  });

  it('handles messages without date gracefully', () => {
    expect(parsePortalCooldownDate('An account is limited to one booking every 24 hours.')).toBeNull();
  });
});
