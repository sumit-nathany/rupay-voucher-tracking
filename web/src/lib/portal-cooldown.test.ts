import { describe, it, expect } from 'vitest';
import { isPortalCooldownMessage, parsePortalCooldownDate } from './portal-cooldown';

describe('portal cooldown parsing', () => {
  it('identifies portal cooldown error messages', () => {
    expect(
      isPortalCooldownMessage(
        'Booking Limit Reached: An account is limited to one booking every 24 hours. Try again after 11 Oct 2026 18:40 hrs.',
      ),
    ).toBe(true);
    expect(
      isPortalCooldownMessage(
        'You have already initiated a transaction, please wait 20 minutes before initiating another one. Thank you.',
      ),
    ).toBe(true);
    expect(isPortalCooldownMessage('Invalid OTP')).toBe(false);
  });

  it('parses portal 20-minute initiated transaction lock into future date', () => {
    const before = Date.now();
    const msg =
      'You have already initiated a transaction, please wait 20 minutes before initiating another one. Thank you.';
    const date = parsePortalCooldownDate(msg);
    const after = Date.now();
    expect(date).not.toBeNull();
    expect(date!.getTime()).toBeGreaterThanOrEqual(before + 20 * 60 * 1000);
    expect(date!.getTime()).toBeLessThanOrEqual(after + 20 * 60 * 1000);
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
