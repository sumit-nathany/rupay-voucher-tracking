import { describe, expect, it } from 'vitest';
import type { CabOfferLike } from './boi-cab';
import { mergeHealthCheckupOffers } from './health-checkup';

function offer(provider: string, exactBenefit: string, defaultCashValue = 899): CabOfferLike {
  return {
    benefitType: 'Health Check Up',
    benefitProvider: provider,
    exactBenefit,
    frequency: 'Quarterly',
    instanceCount: 1,
    defaultCashValue,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    options: [],
  };
}

describe('mergeHealthCheckupOffers', () => {
  it('leaves benefits unchanged when no health checkup offers exist', () => {
    const spa: CabOfferLike = {
      benefitType: 'Spa Services',
      benefitProvider: null,
      exactBenefit: 'Any one of 2 offers',
      frequency: 'Quarterly',
      instanceCount: 1,
      defaultCashValue: 1000,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      options: [],
    };
    expect(mergeHealthCheckupOffers([spa])).toEqual([spa]);
  });

  it('merges Thyrocare and SRL Diagnostics into one pick-one benefit', () => {
    const thy = offer('Thyrocare', 'Aarogyam Basic 2 Package', 899);
    const srl = offer('SRL Diagnostics', 'Healthcare Test Package', 999);
    const spa: CabOfferLike = {
      benefitType: 'Spa Services',
      benefitProvider: null,
      exactBenefit: 'Any one of 2 offers',
      frequency: 'Quarterly',
      instanceCount: 1,
      defaultCashValue: 1000,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      options: [],
    };

    const merged = mergeHealthCheckupOffers([thy, srl, spa]);
    expect(merged).toHaveLength(2);
    const health = merged.find((b) => b.benefitType === 'Health Check Up');
    expect(health).toMatchObject({
      benefitType: 'Health Check Up',
      benefitProvider: null,
      exactBenefit: 'Any one of 2 offers',
      frequency: 'Quarterly',
      instanceCount: 1,
      defaultCashValue: 999,
    });
    expect(health?.options.map((o) => o.provider)).toEqual(['SRL Diagnostics', 'Thyrocare']);
  });
});
