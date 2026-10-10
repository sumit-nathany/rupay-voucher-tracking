import { describe, expect, it } from 'vitest';
import { inferOfferKind, isGolfBenefit, resolveOfferKind } from './benefit-offer-kind';

describe('inferOfferKind', () => {
  it('tags known discount providers', () => {
    expect(inferOfferKind('Entertainment', 'BookMyShow', 'Flat Rs. 250 Discount on Tickets')).toBe('discount');
    expect(inferOfferKind('Travel', 'MakeMyTrip', '10% Instant Discount - Yearly')).toBe('discount');
    expect(inferOfferKind('Tax Compliance', 'TaxSpanner', 'TaxSpanner - INR 2950')).toBe('discount');
  });

  it('tags golf benefits as discount', () => {
    expect(inferOfferKind('Golf Program', 'Golf', 'Golf Program')).toBe('discount');
    expect(inferOfferKind('Golf Program', null, 'Golf Program')).toBe('discount');
    expect(inferOfferKind('Sports', 'Golf Club', 'Green Fee')).toBe('discount');
    expect(inferOfferKind('Voucher', null, 'Complimentary Golf Round')).toBe('discount');
  });

  it('defaults to voucher for typical gift benefits', () => {
    expect(inferOfferKind('OTT', 'Hotstar', '1 Year Subscription')).toBe('voucher');
  });
});

describe('resolveOfferKind', () => {
  it('resolves golf benefits to discount even if stored as voucher', () => {
    expect(resolveOfferKind('voucher', 'Golf Program', 'Golf', 'Golf Program')).toBe('discount');
    expect(resolveOfferKind('voucher', 'Sports', null, 'Golf Program')).toBe('discount');
    expect(resolveOfferKind('voucher', 'Voucher', 'Golf Provider', 'Session')).toBe('discount');
  });

  it('preserves stored value for non-golf benefits', () => {
    expect(resolveOfferKind('voucher', 'Entertainment', 'BookMyShow', 'Tickets')).toBe('voucher');
    expect(resolveOfferKind('discount', 'OTT', 'Hotstar', '1 Year Subscription')).toBe('discount');
  });

  it('falls back to inferOfferKind when stored is null or undefined', () => {
    expect(resolveOfferKind(null, 'Golf Program', 'Golf', 'Golf Program')).toBe('discount');
    expect(resolveOfferKind(undefined, 'Entertainment', 'BookMyShow', 'Tickets')).toBe('discount');
    expect(resolveOfferKind(null, 'OTT', 'Hotstar', '1 Year Subscription')).toBe('voucher');
  });
});

describe('isGolfBenefit', () => {
  it('detects golf in benefitType, benefitProvider, or exactBenefit', () => {
    expect(isGolfBenefit('Golf Program', null, 'Program')).toBe(true);
    expect(isGolfBenefit('Sports', 'Golf', 'Round')).toBe(true);
    expect(isGolfBenefit('Sports', null, '18-hole Golf Session')).toBe(true);
    expect(isGolfBenefit('OTT', 'Hotstar', 'Subscription')).toBe(false);
  });
});

