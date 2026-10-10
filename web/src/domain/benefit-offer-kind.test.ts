import { describe, expect, it } from 'vitest';
import { inferOfferKind } from './benefit-offer-kind';

describe('inferOfferKind', () => {
  it('tags known discount providers', () => {
    expect(inferOfferKind('Entertainment', 'BookMyShow', 'Flat Rs. 250 Discount on Tickets')).toBe('discount');
    expect(inferOfferKind('Travel', 'MakeMyTrip', '10% Instant Discount - Yearly')).toBe('discount');
    expect(inferOfferKind('Tax Compliance', 'TaxSpanner', 'TaxSpanner - INR 2950')).toBe('discount');
  });

  it('defaults to voucher for typical gift benefits', () => {
    expect(inferOfferKind('OTT', 'Hotstar', '1 Year Subscription')).toBe('voucher');
  });
});
