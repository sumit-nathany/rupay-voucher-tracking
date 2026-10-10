import { benefitOptionLabel, type InstanceListItem } from '@/domain/instance-queries';
import { monthName } from '@/components/dashboard/view-params';

export type BenefitGroupMode = 'period' | 'card' | 'holder' | 'benefit';

const GROUP_MODES: BenefitGroupMode[] = ['period', 'card', 'holder', 'benefit'];

export function parseBenefitGroupMode(raw: string | null): BenefitGroupMode | null {
  if (raw && (GROUP_MODES as string[]).includes(raw)) return raw as BenefitGroupMode;
  return null;
}

export function defaultBenefitGroupMode(lifetime: boolean): BenefitGroupMode {
  return lifetime ? 'card' : 'period';
}

export function resolveBenefitGroupMode(raw: string | null, lifetime: boolean): BenefitGroupMode {
  return parseBenefitGroupMode(raw) ?? defaultBenefitGroupMode(lifetime);
}

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
function bandLabel(frequency: string): string {
  switch (frequency) {
    case 'Monthly':
      return 'Monthly';
    case 'Quarterly':
      return 'Quarterly';
    case '6 months':
      return 'Half-yearly';
    case 'Annual':
      return 'Annual';
    default:
      return frequency;
  }
}

/** One display shape for section headers (catalog uses `2026-Q4`, imports may use `Q4 2026`). */
export function formatPeriodHeading(item: Pick<InstanceListItem, 'frequency' | 'periodLabel'>): string {
  const { periodLabel, frequency } = item;
  const month = /^(\d{4})-(\d{2})$/.exec(periodLabel);
  if (month) return `${monthName(Number(month[2]))} ${month[1]}`;
  const quarter = /^(\d{4})-Q([1-4])$/.exec(periodLabel);
  if (quarter) return `Q${quarter[2]} ${quarter[1]}`;
  const half = /^(\d{4})-H([12])$/.exec(periodLabel);
  if (half) return `H${half[2]} ${half[1]}`;
  if (frequency === 'Annual' && /^\d{4}$/.test(periodLabel)) return periodLabel;
  return periodLabel;
}

export function sectionTitle(item: Pick<InstanceListItem, 'frequency' | 'periodLabel'>): string {
  return `${bandLabel(item.frequency)} · ${formatPeriodHeading(item)}`;
}

export function groupItems(items: InstanceListItem[]): Group[] {
  const byKey = new Map<string, Group & { r: number; end: string; start: string }>();
  for (const i of items) {
    const r = rank(i);
    const k = `${r}|${i.periodStart}|${i.periodEnd}`;
    const g =
      byKey.get(k) ??
      { key: k, title: sectionTitle(i), items: [], r, end: i.periodEnd, start: i.periodStart };
    g.items.push(i);
    byKey.set(k, g);
  }
  return [...byKey.values()]
    .sort((x, y) => x.r - y.r || x.end.localeCompare(y.end) || x.start.localeCompare(y.start))
    .map(({ key, title, items }) => ({ key, title, items }));
}

export function cardSectionTitle(
  item: Pick<InstanceListItem, 'holderName' | 'cardName' | 'cardLastDigits'>,
): string {
  const digits = item.cardLastDigits ? ` ••${item.cardLastDigits}` : '';
  return `${item.holderName} · ${item.cardName}${digits}`;
}

/** Lifetime benefits view: one section per physical card. */
export function groupItemsByCard(items: InstanceListItem[]): Group[] {
  const byKey = new Map<
    string,
    Group & { holderName: string; cardName: string; cardId: string }
  >();
  for (const i of items) {
    const k = i.cardId;
    const g =
      byKey.get(k) ??
      {
        key: k,
        title: cardSectionTitle(i),
        items: [],
        holderName: i.holderName,
        cardName: i.cardName,
        cardId: i.cardId,
      };
    g.items.push(i);
    byKey.set(k, g);
  }
  return [...byKey.values()]
    .sort(
      (x, y) =>
        x.holderName.localeCompare(y.holderName) ||
        x.cardName.localeCompare(y.cardName) ||
        x.cardId.localeCompare(y.cardId),
    )
    .map(({ key, title, items }) => ({ key, title, items }));
}

export function groupItemsByHolder(items: InstanceListItem[]): Group[] {
  const byKey = new Map<string, Group & { holderName: string }>();
  for (const i of items) {
    const k = i.holderId;
    const g =
      byKey.get(k) ??
      { key: k, title: i.holderName, items: [], holderName: i.holderName };
    g.items.push(i);
    byKey.set(k, g);
  }
  return [...byKey.values()]
    .sort((x, y) => x.holderName.localeCompare(y.holderName))
    .map(({ key, title, items }) => ({ key, title, items }));
}

export function benefitGroupKey(item: InstanceListItem): string {
  if (item.overrideId) return `override:${item.overrideId}`;
  if (item.benefitId) return `benefit:${item.benefitId}`;
  const type = item.benefitType.trim();
  const prov = (item.benefitProvider ?? '').trim();
  const name = item.benefitName.trim();
  return `anon:${type}\0${prov}\0${name}`;
}

export function benefitSectionTitle(
  item: Pick<InstanceListItem, 'benefitType' | 'benefitProvider' | 'benefitName'>,
): string {
  return benefitOptionLabel(item.benefitType, item.benefitProvider, item.benefitName);
}

/** One section per catalog benefit or card-level add. */
export function groupItemsByBenefit(items: InstanceListItem[]): Group[] {
  const byKey = new Map<string, Group & { sortTitle: string }>();
  for (const i of items) {
    const k = benefitGroupKey(i);
    const title = benefitSectionTitle(i);
    const g =
      byKey.get(k) ??
      { key: k, title, items: [], sortTitle: title };
    g.items.push(i);
    byKey.set(k, g);
  }
  return [...byKey.values()]
    .sort((x, y) => x.sortTitle.localeCompare(y.sortTitle, undefined, { sensitivity: 'base' }))
    .map(({ key, title, items }) => ({ key, title, items }));
}

export function groupBenefitItems(items: InstanceListItem[], mode: BenefitGroupMode): Group[] {
  switch (mode) {
    case 'period':
      return groupItems(items);
    case 'card':
      return groupItemsByCard(items);
    case 'holder':
      return groupItemsByHolder(items);
    case 'benefit':
      return groupItemsByBenefit(items);
  }
}

/** Missing URL `sort` means high → low. Discount coupons stay after gift vouchers. */
export type BenefitSort = 'value-desc' | 'value-asc';

function offerKindRank(kind: InstanceListItem['offerKind']) {
  return kind === 'discount' ? 1 : 0;
}

export function sortBenefitItems(items: InstanceListItem[], sort: BenefitSort): InstanceListItem[] {
  const dir = sort === 'value-asc' ? 1 : -1;
  return [...items].sort(
    (a, b) =>
      offerKindRank(a.offerKind) - offerKindRank(b.offerKind) ||
      dir * (a.value - b.value) ||
      a.id.localeCompare(b.id),
  );
}
