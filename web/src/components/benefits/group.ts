import type { InstanceListItem } from '@/domain/instance-queries';

export interface Group {
  key: string;
  title: string;
  items: InstanceListItem[];
}

// Section order: monthly, quarterly, half-yearly, annual; then period_end asc within each band.
const rank = (i: InstanceListItem) => {
  switch (i.frequency) {
    case 'Monthly':
      return 0;
    case 'Quarterly':
      return 1;
    case '6 months':
      return 2;
    case 'Annual':
      return 3;
    default:
      return 1;
  }
};
const prefix = ['', '', 'Half-yearly', 'Annual'];

export function groupItems(items: InstanceListItem[]): Group[] {
  const byKey = new Map<string, Group & { r: number; end: string; start: string }>();
  for (const i of items) {
    const r = rank(i);
    const k = `${r}|${i.periodStart}|${i.periodEnd}`;
    const g =
      byKey.get(k) ??
      { key: k, title: prefix[r] ? `${prefix[r]} · ${i.periodLabel}` : i.periodLabel, items: [], r, end: i.periodEnd, start: i.periodStart };
    g.items.push(i);
    byKey.set(k, g);
  }
  return [...byKey.values()]
    .sort((x, y) => x.r - y.r || x.end.localeCompare(y.end) || x.start.localeCompare(y.start))
    .map(({ key, title, items }) => ({ key, title, items }));
}

export type BenefitSort = 'default' | 'value-desc' | 'value-asc';

export function sortBenefitItems(items: InstanceListItem[], sort: BenefitSort): InstanceListItem[] {
  if (sort === 'default') return items;
  const dir = sort === 'value-desc' ? -1 : 1;
  return [...items].sort((a, b) => dir * (a.value - b.value) || a.id.localeCompare(b.id));
}
