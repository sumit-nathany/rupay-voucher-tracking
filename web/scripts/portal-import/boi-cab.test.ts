import { describe, expect, it } from 'vitest';
import {
  isBoiSelectDebitCatalogCard,
  mergeBoiSelectDebitOlaUberCab,
  type CabOfferLike,
} from './boi-cab';

const cab = (provider: string, exact: string): CabOfferLike => ({
  benefitType: 'Cab Services',
  benefitProvider: provider,
  exactBenefit: exact,
  frequency: 'Quarterly',
  instanceCount: 1,
  defaultCashValue: 100,
  effectiveFrom: '2022-09-02',
  effectiveTo: null,
  options: [],
});

describe('isBoiSelectDebitCatalogCard', () => {
  it('matches BOI select debit naming variants', () => {
    expect(isBoiSelectDebitCatalogCard('Bank of India RuPay Select Card')).toBe(true);
    expect(isBoiSelectDebitCatalogCard('BOI Rupay Select Debit Card')).toBe(true);
    expect(isBoiSelectDebitCatalogCard('Bank of India RuPay Select Credit Card')).toBe(false);
  });
});

describe('mergeBoiSelectDebitOlaUberCab', () => {
  it('leaves unrelated benefits unchanged', () => {
    const spa = { ...cab('Ola', 'x'), benefitType: 'Spa Services' };
    expect(mergeBoiSelectDebitOlaUberCab([spa])).toEqual([spa]);
  });

  it('merges Ola and Uber cab offers into one pick-one benefit', () => {
    const ola = cab('Ola', 'Instant Gift Card - INR 100');
    const uber = cab('Uber', 'Redeemable Coupon - INR 100');
    const gym = cab('Cult.fit', '1 month');
    gym.benefitType = 'Gym Access';
    const [merged] = mergeBoiSelectDebitOlaUberCab([ola, uber, gym]).filter((b) => b.benefitType === 'Cab Services');
    expect(merged).toMatchObject({
      benefitProvider: null,
      exactBenefit: 'Any one of 2 offers',
      frequency: 'Quarterly',
      instanceCount: 1,
      defaultCashValue: 100,
    });
    expect(merged.options.map((o) => o.provider)).toEqual(['Ola', 'Uber']);
  });

  it('also merges Travel category Ola/Uber pairs', () => {
    const ola = { ...cab('Ola', 'Ola voucher'), benefitType: 'Travel' };
    const uber = { ...cab('Uber', 'Uber voucher'), benefitType: 'Travel' };
    const out = mergeBoiSelectDebitOlaUberCab([ola, uber]);
    expect(out).toHaveLength(1);
    expect(out[0].benefitType).toBe('Cab Services');
    expect(out[0].options).toHaveLength(2);
  });
});
