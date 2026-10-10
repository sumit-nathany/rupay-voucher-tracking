import { describe, expect, it } from 'vitest';
import type { InstanceListItem } from '@/domain/instance-queries';
import { groupItems, sortBenefitItems } from './group';

const mk = (
  id: string,
  frequency: string,
  periodLabel: string,
  periodStart: string,
  periodEnd: string,
  value = 0,
) => ({ id, frequency, periodLabel, periodStart, periodEnd, value }) as unknown as InstanceListItem;

describe('groupItems', () => {
  it('annual, then half-yearly, then each shorter period in date order', () => {
    const g = groupItems([
      mk('m', 'Monthly', 'Nov 2026', '2026-11-01', '2026-11-30'),
      mk('q', 'Quarterly', 'Q4 2026', '2026-10-01', '2026-12-31'),
      mk('h', '6 months', 'H2 2026', '2026-07-01', '2026-12-31'),
      mk('a', 'Annual', '2026', '2026-01-01', '2026-12-31'),
      mk('m2', 'Monthly', 'Oct 2026', '2026-10-01', '2026-10-31'),
    ]);
    expect(g.map((x) => [x.title, x.items.map((i) => i.id)])).toEqual([
      ['Annual · 2026', ['a']],
      ['Half-yearly · H2 2026', ['h']],
      ['Oct 2026', ['m2']],
      ['Nov 2026', ['m']],
      ['Q4 2026', ['q']],
    ]);
  });
});

describe('sortBenefitItems', () => {
  it('sorts by value descending with stable id tie-break', () => {
    const items = [mk('b', 'Monthly', 'Oct', '2026-10-01', '2026-10-31', 100), mk('a', 'Monthly', 'Oct', '2026-10-01', '2026-10-31', 500)];
    expect(sortBenefitItems(items, 'value-desc').map((i) => i.id)).toEqual(['a', 'b']);
  });
});
