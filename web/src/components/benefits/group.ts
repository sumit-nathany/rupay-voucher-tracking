import type { InstanceListItem } from '@/domain/instance-queries';

export interface Group {
  key: string;
  title: string;
  items: InstanceListItem[];
}

// Section order: annual, then half-yearly, then shorter periods (period_end asc).
// Each section holds exactly one period, so its header carries the period and rows don't repeat it.
const rank = (i: InstanceListItem) => (i.frequency === 'Annual' ? 0 : i.frequency === '6 months' ? 1 : 2);
const prefix = ['Annual', 'Half-yearly', ''];

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
