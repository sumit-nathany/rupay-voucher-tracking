import { describe, expect, it } from 'vitest';
import type { InstanceListItem } from '@/domain/instance-queries';
import {
  benefitGroupKey,
  groupBenefitItems,
  groupItems,
  groupItemsByBenefit,
  groupItemsByCategory,
  groupItemsByCard,
  groupItemsByHolder,
  sortBenefitItems,
} from './group';

const mk = (
  id: string,
  frequency: string,
  periodLabel: string,
  periodStart: string,
  periodEnd: string,
  value = 0,
) => ({ id, frequency, periodLabel, periodStart, periodEnd, value }) as unknown as InstanceListItem;

const mkCard = (
  id: string,
  cardId: string,
  holderId: string,
  holderName: string,
  cardName: string,
  cardLastDigits: string | null = null,
) =>
  ({
    ...mk(id, 'Monthly', '2026-11', '2026-11-01', '2026-11-30'),
    cardId,
    holderId,
    holderName,
    cardName,
    cardLastDigits,
  }) as unknown as InstanceListItem;

describe('groupItems', () => {
  it('monthly, then quarterly, half-yearly, annual; date order within band', () => {
    const g = groupItems([
      mk('m', 'Monthly', 'Nov 2026', '2026-11-01', '2026-11-30'),
      mk('q', 'Quarterly', 'Q4 2026', '2026-10-01', '2026-12-31'),
      mk('h', '6 months', 'H2 2026', '2026-07-01', '2026-12-31'),
      mk('a', 'Annual', '2026', '2026-01-01', '2026-12-31'),
      mk('m2', 'Monthly', 'Oct 2026', '2026-10-01', '2026-10-31'),
    ]);
    expect(g.map((x) => [x.title, x.items.map((i) => i.id)])).toEqual([
      ['Monthly · Oct 2026', ['m2']],
      ['Monthly · Nov 2026', ['m']],
      ['Quarterly · Q4 2026', ['q']],
      ['Half-yearly · H2 2026', ['h']],
      ['Annual · 2026', ['a']],
    ]);
  });

  it('normalizes generated period labels in headings', () => {
    const g = groupItems([
      mk('q', 'Quarterly', '2026-Q4', '2026-10-01', '2026-12-31'),
      mk('m', 'Monthly', '2026-11', '2026-11-01', '2026-11-30'),
    ]);
    expect(g.map((x) => x.title)).toEqual(['Monthly · Nov 2026', 'Quarterly · Q4 2026']);
  });
});

describe('groupItemsByHolder', () => {
  it('groups by holder with alphabetical section order', () => {
    const g = groupItemsByHolder([
      mkCard('b1', 'card-b', 'holder-b', 'Bina', 'HDFC Infinia'),
      mkCard('a2', 'card-a', 'holder-a', 'Asha', 'PNB Select'),
      mkCard('a1', 'card-a2', 'holder-a', 'Asha', 'Other'),
    ]);
    expect(g.map((x) => [x.title, x.key, x.items.map((i) => i.id)])).toEqual([
      ['Asha', 'holder-a', ['a2', 'a1']],
      ['Bina', 'holder-b', ['b1']],
    ]);
  });
});

describe('groupItemsByCard', () => {
  it('groups by card with holder · card title and stable section order', () => {
    const g = groupItemsByCard([
      mkCard('b2', 'card-b', 'holder-b', 'Bina', 'HDFC Infinia', '9999'),
      mkCard('a1', 'card-a', 'holder-a', 'Asha', 'PNB Select', '1234'),
      mkCard('a2', 'card-a', 'holder-a', 'Asha', 'PNB Select', '1234'),
      mkCard('b1', 'card-b', 'holder-b', 'Bina', 'HDFC Infinia', '9999'),
    ]);
    expect(g.map((x) => [x.title, x.key, x.items.map((i) => i.id)])).toEqual([
      ['Asha • PNB Select (xx1234)', 'card-a', ['a1', 'a2']],
      ['Bina • HDFC Infinia (xx9999)', 'card-b', ['b2', 'b1']],
    ]);
  });

  it('omits last digits in title when absent', () => {
    const g = groupItemsByCard([mkCard('x', 'card-x', 'holder-a', 'Asha', 'PNB Select', null)]);
    expect(g[0]?.title).toBe('Asha • PNB Select');
  });
});

describe('groupItemsByBenefit', () => {
  const mkBenefit = (
    id: string,
    opts: {
      benefitId?: string | null;
      overrideId?: string | null;
      benefitType?: string;
      benefitProvider?: string | null;
      benefitName?: string;
    } = {},
  ) =>
    ({
      ...mk(id, 'Monthly', '2026-11', '2026-11-01', '2026-11-30'),
      cardId: 'card-1',
      holderId: 'holder-1',
      holderName: 'Asha',
      cardName: 'PNB',
      benefitId: 'benefitId' in opts ? opts.benefitId ?? null : 'ben-spa',
      overrideId: 'overrideId' in opts ? opts.overrideId ?? null : null,
      benefitType: opts.benefitType ?? 'Spa Services',
      benefitProvider: opts.benefitProvider ?? 'Four Seasons',
      benefitName: opts.benefitName ?? 'Any one of 2 offers',
    }) as unknown as InstanceListItem;

  it('groups catalog benefits by benefitId with filter-style titles', () => {
    const g = groupItemsByBenefit([
      mkBenefit('b2', { benefitId: 'ben-ott', benefitType: 'OTT', benefitProvider: 'Netflix' }),
      mkBenefit('a1', { benefitId: 'ben-spa' }),
      mkBenefit('a2', { benefitId: 'ben-spa' }),
    ]);
    expect(g.map((x) => [x.title, x.key, x.items.map((i) => i.id)])).toEqual([
      ['OTT · Netflix', 'benefit:ben-ott', ['b2']],
      ['Spa Services · Four Seasons', 'benefit:ben-spa', ['a1', 'a2']],
    ]);
  });

  it('groups overrides by overrideId', () => {
    const g = groupItemsByBenefit([
      mkBenefit('o1', { benefitId: null, overrideId: 'ov-1', benefitType: 'Voucher', benefitProvider: 'Custom' }),
      mkBenefit('o2', { benefitId: null, overrideId: 'ov-1', benefitType: 'Voucher', benefitProvider: 'Custom' }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]?.key).toBe('override:ov-1');
    expect(g[0]?.items.map((i) => i.id)).toEqual(['o1', 'o2']);
  });

  it('falls back to stable anon key when ids are missing', () => {
    const item = mkBenefit('x', { benefitId: null, overrideId: null });
    expect(benefitGroupKey(item)).toBe('anon:Spa Services\0Four Seasons\0Any one of 2 offers');
  });
});

describe('groupItemsByCategory', () => {
  const mkCat = (id: string, benefitType: string) =>
    ({
      ...mk(id, 'Monthly', '2026-11', '2026-11-01', '2026-11-30'),
      benefitType,
    }) as unknown as InstanceListItem;

  it('groups by benefitType alphabetically', () => {
    const g = groupItemsByCategory([
      mkCat('1', 'Spa Services'),
      mkCat('2', 'Dining'),
      mkCat('3', 'Spa Services'),
      mkCat('4', 'OTT'),
    ]);
    expect(g.map((x) => [x.title, x.key, x.items.map((i) => i.id)])).toEqual([
      ['Dining', 'category:Dining', ['2']],
      ['OTT', 'category:OTT', ['4']],
      ['Spa Services', 'category:Spa Services', ['1', '3']],
    ]);
  });

  it('falls back to Other if benefitType is empty', () => {
    const g = groupItemsByCategory([mkCat('1', '')]);
    expect(g[0]?.title).toBe('Other');
    expect(g[0]?.key).toBe('category:Other');
  });

  it('is reachable via groupBenefitItems with mode category', () => {
    const g = groupBenefitItems([mkCat('1', 'Dining')], 'category');
    expect(g).toHaveLength(1);
    expect(g[0]?.title).toBe('Dining');
  });
});

describe('sortBenefitItems', () => {
  it('sorts by value descending with stable id tie-break', () => {
    const items = [mk('b', 'Monthly', 'Oct', '2026-10-01', '2026-10-31', 100), mk('a', 'Monthly', 'Oct', '2026-10-01', '2026-10-31', 500)];
    expect(sortBenefitItems(items, 'value-desc').map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('lists discount coupons after gift vouchers', () => {
    const voucher = { ...mk('v', 'Monthly', 'Oct', '2026-10-01', '2026-10-31', 100), offerKind: 'voucher' as const };
    const discount = { ...mk('d', 'Monthly', 'Oct', '2026-10-01', '2026-10-31', 500), offerKind: 'discount' as const };
    expect(sortBenefitItems([discount, voucher], 'value-desc').map((i) => i.id)).toEqual(['v', 'd']);
    expect(sortBenefitItems([discount, voucher], 'value-asc').map((i) => i.id)).toEqual(['v', 'd']);
  });

  it('sorts by category alphabetically, then benefit name, then value descending', () => {
    const it1 = { ...mk('1', 'Monthly', 'Oct', '2026-10-01', '2026-10-31', 100), benefitType: 'Travel', benefitName: 'Flight' };
    const it2 = { ...mk('2', 'Monthly', 'Oct', '2026-10-01', '2026-10-31', 200), benefitType: 'Dining', benefitName: 'Restaurant B' };
    const it3 = { ...mk('3', 'Monthly', 'Oct', '2026-10-01', '2026-10-31', 500), benefitType: 'Dining', benefitName: 'Restaurant A' };
    const discount = { ...mk('4', 'Monthly', 'Oct', '2026-10-01', '2026-10-31', 1000), benefitType: 'Apparel', benefitName: 'Shop', offerKind: 'discount' as const };

    const sorted = sortBenefitItems([it1, it2, it3, discount], 'category');
    expect(sorted.map((i) => i.id)).toEqual(['3', '2', '1', '4']);
  });
});
