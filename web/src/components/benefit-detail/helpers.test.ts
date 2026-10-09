import { describe, expect, it } from 'vitest';
import {
  canRecordSale,
  canSkip,
  errorMessage,
  neighbours,
  parseMoney,
  statusKind,
  validateCode,
  validateDetails,
} from './helpers';

describe('stepper rules', () => {
  it('classifies statuses', () => {
    expect(statusKind('Withdrawn')).toBe('withdrawn');
    expect(statusKind('Skipped')).toBe('skipped');
    expect(statusKind('Coupon Received')).toBe('workflow');
  });
  it('finds neighbours at the ends and middle', () => {
    expect(neighbours('Not Ordered')).toEqual({ prev: null, next: 'Ordered but Coupon not received' });
    expect(neighbours('Coupon Received')).toEqual({ prev: 'Ordered but Coupon not received', next: 'Coupon Redeemed' });
    expect(neighbours('Coupon Redeemed').next).toBeNull();
    expect(neighbours('Skipped')).toEqual({ prev: null, next: null });
  });
  it('skip only from Not Ordered; sale only in workflow', () => {
    expect(canSkip('Not Ordered')).toBe(true);
    expect(canSkip('Coupon Received')).toBe(false);
    expect(canRecordSale('Skipped')).toBe(false);
    expect(canRecordSale('Withdrawn')).toBe(false);
    expect(canRecordSale('Coupon Redeemed')).toBe(true);
  });
});

describe('parseMoney', () => {
  it('handles blank, valid and invalid input', () => {
    expect(parseMoney('  ')).toEqual({ ok: true, value: null });
    expect(parseMoney('1200.50')).toEqual({ ok: true, value: 1200.5 });
    expect(parseMoney('-1').ok).toBe(false);
    expect(parseMoney('1.234').ok).toBe(false);
    expect(parseMoney('abc').ok).toBe(false);
    expect(parseMoney('100000000').ok).toBe(false);
  });
});

describe('validateDetails', () => {
  const base = { orderDate: '', expiryDate: '', cashValue: '', rupayBookingId: '', comments: '' };
  it('maps blanks to null', () => {
    expect(validateDetails(base)).toEqual({
      ok: true,
      value: { orderDate: null, expiryDate: null, cashValue: null, rupayBookingId: null, comments: null },
    });
  });
  it('rejects expiry before order and bad dates', () => {
    const r = validateDetails({ ...base, orderDate: '2026-05-10', expiryDate: '2026-05-01' });
    expect(r.ok).toBe(false);
    const r2 = validateDetails({ ...base, orderDate: '2026-02-30' });
    expect(r2.ok).toBe(false);
  });
});

describe('validateCode / errorMessage', () => {
  it('requires a code', () => {
    expect(validateCode('   ').ok).toBe(false);
    expect(validateCode(' 123 456 ')).toEqual({ ok: true, value: '123 456' });
  });
  it('collapses unsafe or long messages', () => {
    expect(errorMessage(new Error('A Withdrawn instance cannot be changed'))).toBe('A Withdrawn instance cannot be changed');
    expect(errorMessage(new Error('An error occurred in the Server Components render. digest: 1'))).toMatch(/Something went wrong/);
    expect(errorMessage(new Error('a\nstack'))).toMatch(/Something went wrong/);
    expect(errorMessage('x')).toMatch(/Something went wrong/);
  });
});
