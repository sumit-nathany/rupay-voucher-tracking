import { and, asc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  bankCardTypes,
  benefitCatalogVersions,
  benefitOptions,
  benefitInstances,
  cardBenefitOverrides,
  cardHolders,
  cards,
} from '@/db/schema';
import type { Ctx } from '@/lib/context';
import { expandViewedPeriod, type ViewedPeriod } from '@/lib/periods';
import { ORDER_STATUSES, type OrderStatus } from './instances';
import { ValidationError } from './workspace-data';

// Read queries for the Dashboard / Benefits list (PLAN.md Phase 4a). Every query
// is scoped by ctx.workspaceId on instances, cards and holders; no input carries
// a workspace id (strict schemas reject one). "Today" is always ctx.today.
// codeEncrypted is never selected: callers get hasCode only.

const uuid = z.string().uuid();
const year = z.number().int().min(2000).max(2100);

export const viewSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('year'), year }),
  z.strictObject({ kind: z.literal('half'), year, half: z.union([z.literal(1), z.literal(2)]) }),
  z.strictObject({
    kind: z.literal('quarter'),
    year,
    quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  }),
  z.strictObject({ kind: z.literal('month'), year, month: z.number().int().min(1).max(12) }),
]);

const filterSchema = z.strictObject({
  view: viewSchema,
  holderId: uuid.optional(),
  cardId: uuid.optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
});

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ValidationError(r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  }
  return r.data;
}

// ── types ───────────────────────────────────────────────────────────────────

export type Frequency = 'Annual' | '6 months' | 'Quarterly' | 'Monthly';

/** One benefit instance, flattened for display. No ciphertext; money as numbers. */
export interface InstanceListItem {
  id: string;
  status: OrderStatus;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  instanceNumber: number;
  orderDeadline: string;
  orderDate: string | null;
  expiryDate: string | null;
  /** True when period_end < ctx.today and status is Not Ordered (missed). */
  lapsed: boolean;
  /** Instance's own cash_value (may be null). */
  cashValue: number | null;
  /** Catalog version / override default_cash_value (may be null). */
  defaultCashValue: number | null;
  /** cashValue ?? defaultCashValue ?? 0 — the figure used in dashboard totals. */
  value: number;
  soldFor: number | null;
  rupayBookingId: string | null;
  comments: string | null;
  hasCode: boolean;
  benefitName: string;
  benefitType: string;
  benefitProvider: string | null;
  frequency: Frequency;
  /** 'catalog' (shared catalog version) or 'override' (card-level add). */
  source: 'catalog' | 'override';
  cardId: string;
  cardName: string;
  cardLastDigits: string | null;
  cardTypeName: string;
  holderId: string;
  holderName: string;
}

export type StatusCounts = Record<OrderStatus, number>;

export interface HolderProgress {
  holderId: string;
  holderName: string;
  /** Instances excluding Skipped and Withdrawn. */
  total: number;
  /** Coupon Redeemed (including sold). */
  redeemed: number;
}

export interface DashboardSummary {
  /** Every status present (zero-filled), over the viewed period set. */
  counts: StatusCounts;
  /** Instances excluding Skipped and Withdrawn. */
  totalCount: number;
  /** Sum of `value` over those instances. */
  totalValue: number;
  /** Ordered or beyond: Ordered-but-not-received + Coupon Received + Coupon Redeemed. */
  orderedValue: number;
  /** Coupon Redeemed. */
  redeemedValue: number;
  /** Not Ordered + Ordered-but-not-received + Coupon Received, excluding sold (sold_for set). */
  outstandingValue: number;
  /** Subset of outstanding: Not Ordered whose period has ended. */
  lapsedCount: number;
  lapsedValue: number;
  /** Sum of sold_for over instances with sold_for set (any non-Skipped/Withdrawn status). */
  soldValue: number;
  perHolder: HolderProgress[];
  /** Coupon Received, not sold, expiry_date in [today, today+30], workspace-wide (not limited to the view). */
  expiringSoon: InstanceListItem[];
  expiringWithinDays: number;
}

// ── internals ───────────────────────────────────────────────────────────────

const num = (s: string | null): number | null => (s == null ? null : Number(s));
const round2 = (n: number) => Math.round(n * 100) / 100;

const selection = {
  id: benefitInstances.id,
  status: benefitInstances.orderStatus,
  periodStart: benefitInstances.periodStart,
  periodEnd: benefitInstances.periodEnd,
  periodLabel: benefitInstances.periodLabel,
  instanceNumber: benefitInstances.instanceNumber,
  orderDeadline: benefitInstances.orderDeadline,
  orderDate: benefitInstances.orderDate,
  expiryDate: benefitInstances.expiryDate,
  cashValue: benefitInstances.cashValue,
  soldFor: benefitInstances.soldFor,
  rupayBookingId: benefitInstances.rupayBookingId,
  comments: benefitInstances.comments,
  hasCode: sql<boolean>`${benefitInstances.codeEncrypted} IS NOT NULL`,
  overrideId: benefitInstances.overrideId,
  vType: benefitCatalogVersions.benefitType,
  vProvider: benefitCatalogVersions.benefitProvider,
  vName: benefitCatalogVersions.exactBenefit,
  vFreq: benefitCatalogVersions.frequency,
  vValue: benefitCatalogVersions.defaultCashValue,
  oType: cardBenefitOverrides.benefitType,
  oProvider: cardBenefitOverrides.benefitProvider,
  oName: cardBenefitOverrides.exactBenefit,
  oFreq: cardBenefitOverrides.frequency,
  oValue: cardBenefitOverrides.defaultCashValue,
  cProvider: benefitOptions.provider,
  cName: benefitOptions.offerName,
  cValue: benefitOptions.cashValue,
  cardId: cards.id,
  cardName: cards.displayName,
  cardLastDigits: cards.lastDigits,
  cardTypeName: bankCardTypes.displayName,
  holderId: cardHolders.id,
  holderName: cardHolders.name,
};

type SelRow = {
  [K in keyof typeof selection]: (typeof selection)[K] extends { _: { data: infer D } } ? D : never;
};

function toItem(r: SelRow, todayStr: string): InstanceListItem {
  const fromOverride = r.overrideId != null;
  // A chosen offer ("redeem any one" benefit) replaces the category-level name, provider and value.
  const chosen = !fromOverride && r.cName != null;
  const defaultCashValue = chosen ? (num(r.cValue) ?? num(r.vValue)) : num(fromOverride ? r.oValue : r.vValue);
  const cashValue = num(r.cashValue);
  const status = r.status as OrderStatus;
  return {
    id: r.id,
    status,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    periodLabel: r.periodLabel,
    instanceNumber: r.instanceNumber,
    orderDeadline: r.orderDeadline,
    orderDate: r.orderDate,
    expiryDate: r.expiryDate,
    lapsed: status === 'Not Ordered' && r.periodEnd < todayStr,
    cashValue,
    defaultCashValue,
    value: cashValue ?? defaultCashValue ?? 0,
    soldFor: num(r.soldFor),
    rupayBookingId: r.rupayBookingId,
    comments: r.comments,
    hasCode: Boolean(r.hasCode),
    benefitName: (chosen ? r.cName : fromOverride ? r.oName : r.vName) ?? '',
    benefitType: (fromOverride ? r.oType : r.vType) ?? '',
    benefitProvider: (chosen ? r.cProvider : fromOverride ? r.oProvider : r.vProvider) ?? null,
    frequency: ((fromOverride ? r.oFreq : r.vFreq) ?? 'Quarterly') as Frequency,
    source: fromOverride ? 'override' : 'catalog',
    cardId: r.cardId,
    cardName: r.cardName,
    cardLastDigits: r.cardLastDigits,
    cardTypeName: r.cardTypeName,
    holderId: r.holderId,
    holderName: r.holderName,
  };
}

/** Escape LIKE wildcards so user search text is matched literally. */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function query(ctx: Ctx, where: SQL | undefined): Promise<InstanceListItem[]> {
  const rows = await ctx.db
    .select(selection)
    .from(benefitInstances)
    .innerJoin(
      cards,
      and(eq(cards.id, benefitInstances.cardId), eq(cards.workspaceId, ctx.workspaceId)),
    )
    .innerJoin(
      cardHolders,
      and(eq(cardHolders.id, cards.holderId), eq(cardHolders.workspaceId, ctx.workspaceId)),
    )
    .innerJoin(bankCardTypes, eq(bankCardTypes.id, benefitInstances.bankCardTypeId))
    .leftJoin(
      benefitCatalogVersions,
      eq(benefitCatalogVersions.id, benefitInstances.generatedFromVersion),
    )
    .leftJoin(benefitOptions, eq(benefitOptions.id, benefitInstances.chosenOptionId))
    .leftJoin(
      cardBenefitOverrides,
      and(
        eq(cardBenefitOverrides.id, benefitInstances.overrideId),
        eq(cardBenefitOverrides.workspaceId, ctx.workspaceId),
      ),
    )
    .where(and(eq(benefitInstances.workspaceId, ctx.workspaceId), where))
    .orderBy(
      asc(benefitInstances.periodEnd),
      sql`lower(coalesce(${benefitCatalogVersions.exactBenefit}, ${cardBenefitOverrides.exactBenefit}))`,
      asc(cardHolders.name),
      asc(cards.displayName),
      asc(benefitInstances.instanceNumber),
      asc(benefitInstances.id),
    );
  return (rows as unknown as SelRow[]).map((r) => toItem(r, ctx.today));
}

function periodClause(view: ViewedPeriod, todayStr: string): SQL {
  // Same set ensureInstances generates for this view: the viewed period plus
  // nested/containing periods. Period ranges are unique per grain, so
  // (start,end) pairs identify them.
  const pairs = expandViewedPeriod(view, todayStr).map((p) =>
    and(eq(benefitInstances.periodStart, p.start), eq(benefitInstances.periodEnd, p.end)),
  );
  return or(...pairs)!;
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * Instances for the viewed period set (quarter view => the quarter, its months,
 * its half and its year, matching ensureInstances), joined with benefit, card
 * and holder display data. Sorted by period_end asc, then benefit name. All
 * statuses are returned, including Skipped and Withdrawn, unless `status` filters.
 * A holderId/cardId from another workspace simply matches nothing.
 */
export async function listInstances(
  ctx: Ctx,
  input: {
    view: ViewedPeriod;
    holderId?: string;
    cardId?: string;
    status?: OrderStatus;
    search?: string;
  },
): Promise<InstanceListItem[]> {
  const f = parse(filterSchema, input);
  const conds: SQL[] = [periodClause(f.view, ctx.today)];
  if (f.holderId) conds.push(eq(cards.holderId, f.holderId));
  if (f.cardId) conds.push(eq(benefitInstances.cardId, f.cardId));
  if (f.status) conds.push(eq(benefitInstances.orderStatus, f.status));
  if (f.search) {
    const p = `%${likeEscape(f.search)}%`;
    conds.push(
      or(
        ilike(benefitCatalogVersions.exactBenefit, p),
        ilike(benefitCatalogVersions.benefitProvider, p),
        ilike(benefitOptions.provider, p),
        ilike(benefitOptions.offerName, p),
        ilike(cardBenefitOverrides.exactBenefit, p),
        ilike(cardBenefitOverrides.benefitProvider, p),
        ilike(cards.displayName, p),
        ilike(cardHolders.name, p),
        ilike(bankCardTypes.displayName, p),
      )!,
    );
  }
  return query(ctx, and(...conds));
}

const EXPIRING_DAYS = 30;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Dashboard totals for the viewed period set. Definitions (PLAN.md leaves them
 * open, so chosen here and documented on DashboardSummary):
 *  - value = instance cash_value, else version/override default_cash_value, else 0.
 *  - Skipped and Withdrawn are excluded from every value total and from perHolder.
 *  - outstanding = Not Ordered + Ordered-but-not-received + Coupon Received,
 *    minus sold instances (sold_for set => handed off, REQUIREMENTS.md §6).
 *  - expiringSoon: Coupon Received, sold_for NULL, expiry_date within
 *    [today, today+30], across the whole workspace (a coupon from an earlier
 *    quarter still needs using), soonest first.
 */
export async function getDashboardSummary(
  ctx: Ctx,
  view: ViewedPeriod,
): Promise<DashboardSummary> {
  const v = parse(viewSchema, view);
  const items = await query(ctx, periodClause(v, ctx.today));

  const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as StatusCounts;
  const holders = new Map<string, HolderProgress>();
  let totalCount = 0, totalValue = 0, orderedValue = 0, redeemedValue = 0;
  let outstandingValue = 0, lapsedCount = 0, lapsedValue = 0, soldValue = 0;

  for (const it of items) {
    counts[it.status] += 1;
    if (it.status === 'Skipped' || it.status === 'Withdrawn') continue;
    totalCount += 1;
    totalValue += it.value;
    const sold = it.soldFor != null;
    if (sold) soldValue += it.soldFor!;
    if (it.status !== 'Not Ordered') orderedValue += it.value;
    if (it.status === 'Coupon Redeemed') redeemedValue += it.value;
    else if (!sold) outstandingValue += it.value;
    if (it.lapsed) {
      lapsedCount += 1;
      lapsedValue += it.value;
    }
    const h =
      holders.get(it.holderId) ??
      { holderId: it.holderId, holderName: it.holderName, total: 0, redeemed: 0 };
    h.total += 1;
    if (it.status === 'Coupon Redeemed') h.redeemed += 1;
    holders.set(it.holderId, h);
  }

  const expiring = await query(
    ctx,
    and(
      eq(benefitInstances.orderStatus, 'Coupon Received'),
      sql`${benefitInstances.soldFor} IS NULL`,
      sql`${benefitInstances.expiryDate} >= ${ctx.today}`,
      sql`${benefitInstances.expiryDate} <= ${addDays(ctx.today, EXPIRING_DAYS)}`,
    ),
  );
  expiring.sort(
    (a, b) =>
      (a.expiryDate ?? '').localeCompare(b.expiryDate ?? '') ||
      a.benefitName.localeCompare(b.benefitName),
  );

  return {
    counts,
    totalCount,
    totalValue: round2(totalValue),
    orderedValue: round2(orderedValue),
    redeemedValue: round2(redeemedValue),
    outstandingValue: round2(outstandingValue),
    lapsedCount,
    lapsedValue: round2(lapsedValue),
    soldValue: round2(soldValue),
    perHolder: [...holders.values()].sort((a, b) => a.holderName.localeCompare(b.holderName)),
    expiringSoon: expiring,
    expiringWithinDays: EXPIRING_DAYS,
  };
}
