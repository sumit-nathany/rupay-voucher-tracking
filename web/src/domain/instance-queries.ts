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
import { calendarQuarterForDate, expandViewedPeriod, type ViewedPeriod } from '@/lib/periods';
import { benefitOptionLabel } from './benefit-label';
import { type OfferKind, resolveOfferKind } from './benefit-offer-kind';
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
  /** Catalog `benefit_id` or card-override id — matches either column on instances. */
  benefitId: uuid.optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  search: z.string().trim().max(100).optional(),
  /** `voucher` (default): gift vouchers only; `all`: include discounts; `discount`: discounts only. */
  offerFilter: z.enum(['voucher', 'all', 'discount']).optional(),
  /** With status Not Ordered: `1` = lapsed only, `0` = not lapsed only. */
  lapsed: z.enum(['0', '1']).optional(),
  /** All workspace periods — ignores `view` for the period filter. */
  scope: z.literal('lifetime').optional(),
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
  /** Gift voucher vs discount-style coupon (not a straight redeemable gift card). */
  offerKind: OfferKind;
  /** 'catalog' (shared catalog version) or 'override' (card-level add). */
  source: 'catalog' | 'override';
  cardId: string;
  cardName: string;
  cardLastDigits: string | null;
  cardTypeName: string;
  holderId: string;
  holderName: string;
  /** Catalog benefit id when `source === 'catalog'`. */
  benefitId: string | null;
  /** Card-level add override id when `source === 'override'`. */
  overrideId: string | null;
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

/** Rupee totals for the actionable voucher queues in the viewed period set (discount coupons excluded). */
export interface ActionQueueValues {
  /** Not Ordered, period not ended — benefits still to place. */
  needOrder: number;
  /** Instances counted in `needOrder`. */
  needOrderCount: number;
  /** Ordered but Coupon not received — waiting on the bank/portal. */
  awaitingCoupon: number;
  /** Instances counted in `awaitingCoupon`. */
  awaitingCouponCount: number;
  /** Coupon Received, not sold — coupon in hand, not yet redeemed. */
  couponToUse: number;
  /** Instances counted in `couponToUse`. */
  couponToUseCount: number;
}

export interface DashboardSummary {
  /** Every status present (zero-filled), over the viewed period set. */
  counts: StatusCounts;
  /** Cash value (instance or catalog default) for actionable status queues. */
  actionValues: ActionQueueValues;
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
  /** Sum of `value` for Coupon Redeemed in the calendar quarter of ctx.today (not the viewed period). */
  redeemedThisQuarter: number;
  /** Coupon Redeemed instances in that quarter (includes discounts). */
  redeemedThisQuarterCount: number;
  /** Sum of `value` for Coupon Redeemed in the calendar year of ctx.today. */
  redeemedThisYear: number;
  /** Coupon Redeemed instances in that year (includes discounts). */
  redeemedThisYearCount: number;
  /** Sum of `value` for every Coupon Redeemed instance in the workspace. */
  redeemedLifetime: number;
  /** Every Coupon Redeemed instance in the workspace (includes discounts). */
  redeemedLifetimeCount: number;
  /** Not Ordered, period ended, gift vouchers only — whole workspace, all periods. */
  missedOrderLifetime: number;
  missedOrderLifetimeCount: number;
}

// ── internals ───────────────────────────────────────────────────────────────

const num = (s: string | null): number | null => (s == null ? null : Number(s));
const round2 = (n: number) => Math.round(n * 100) / 100;

const selection = {
  id: benefitInstances.id,
  benefitId: benefitInstances.benefitId,
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
  vOfferKind: benefitCatalogVersions.offerKind,
  oType: cardBenefitOverrides.benefitType,
  oProvider: cardBenefitOverrides.benefitProvider,
  oName: cardBenefitOverrides.exactBenefit,
  oFreq: cardBenefitOverrides.frequency,
  oValue: cardBenefitOverrides.defaultCashValue,
  oOfferKind: cardBenefitOverrides.offerKind,
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
  const benefitName = (chosen ? r.cName : fromOverride ? r.oName : r.vName) ?? '';
  const benefitType = (fromOverride ? r.oType : r.vType) ?? '';
  const benefitProvider = (chosen ? r.cProvider : fromOverride ? r.oProvider : r.vProvider) ?? null;
  const storedKind = (fromOverride ? r.oOfferKind : r.vOfferKind) as OfferKind | null;
  const offerKind = resolveOfferKind(storedKind, benefitType, benefitProvider, benefitName);
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
    benefitName,
    benefitType,
    benefitProvider,
    frequency: ((fromOverride ? r.oFreq : r.vFreq) ?? 'Quarterly') as Frequency,
    offerKind,
    source: fromOverride ? 'override' : 'catalog',
    cardId: r.cardId,
    cardName: r.cardName,
    cardLastDigits: r.cardLastDigits,
    cardTypeName: r.cardTypeName,
    holderId: r.holderId,
    holderName: r.holderName,
    benefitId: fromOverride ? null : r.benefitId,
    overrideId: fromOverride ? r.overrideId : null,
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

function sumRedeemed(items: InstanceListItem[]): { value: number; count: number } {
  let value = 0;
  let count = 0;
  for (const it of items) {
    if (it.status === 'Coupon Redeemed') {
      value += it.value;
      count += 1;
    }
  }
  return { value: round2(value), count };
}

function sumMissedOrdering(items: InstanceListItem[]): { value: number; count: number } {
  let value = 0;
  let count = 0;
  for (const it of items) {
    if (it.offerKind === 'discount') continue;
    if (it.status === 'Not Ordered' && it.lapsed) {
      value += it.value;
      count += 1;
    }
  }
  return { value: round2(value), count };
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
    benefitId?: string;
    status?: OrderStatus;
    search?: string;
    offerFilter?: 'voucher' | 'all' | 'discount';
    lapsed?: '0' | '1';
    scope?: 'lifetime';
  },
): Promise<InstanceListItem[]> {
  const f = parse(filterSchema, input);
  const conds: SQL[] = [];
  if (f.scope !== 'lifetime') conds.push(periodClause(f.view, ctx.today));
  if (f.holderId) conds.push(eq(cards.holderId, f.holderId));
  if (f.cardId) conds.push(eq(benefitInstances.cardId, f.cardId));
  if (f.benefitId) {
    conds.push(
      or(eq(benefitInstances.benefitId, f.benefitId), eq(benefitInstances.overrideId, f.benefitId))!,
    );
  }
  if (f.status) conds.push(eq(benefitInstances.orderStatus, f.status));
  if (f.search) {
    const p = `%${likeEscape(f.search)}%`;
    conds.push(
      or(
        ilike(benefitCatalogVersions.exactBenefit, p),
        ilike(benefitCatalogVersions.benefitProvider, p),
        ilike(benefitCatalogVersions.benefitType, p),
        ilike(benefitOptions.provider, p),
        ilike(benefitOptions.offerName, p),
        ilike(cardBenefitOverrides.exactBenefit, p),
        ilike(cardBenefitOverrides.benefitProvider, p),
        ilike(cardBenefitOverrides.benefitType, p),
        ilike(cards.displayName, p),
        ilike(cards.lastDigits, p),
        ilike(cardHolders.name, p),
        ilike(bankCardTypes.displayName, p),
        ilike(benefitInstances.rupayBookingId, p),
        ilike(benefitInstances.comments, p),
      )!,
    );
  }
  let items = await query(ctx, conds.length ? and(...conds) : undefined);
  const offerFilter = f.offerFilter ?? 'voucher';
  if (offerFilter === 'voucher') items = items.filter((it) => it.offerKind !== 'discount');
  else if (offerFilter === 'discount') items = items.filter((it) => it.offerKind === 'discount');
  if (f.lapsed === '1') items = items.filter((it) => it.lapsed);
  else if (f.lapsed === '0') items = items.filter((it) => !it.lapsed);
  return items;
}

export interface BenefitFilterOption {
  id: string;
  label: string;
}

export { benefitOptionLabel } from './benefit-label';

/**
 * Distinct catalog benefits and card-level adds that appear on workspace instances.
 * Optional holder/card narrow which instances are considered (for filter dropdowns).
 */
const benefitOptsSchema = z.strictObject({ holderId: uuid.optional(), cardId: uuid.optional() });

export async function listBenefitFilterOptions(
  ctx: Ctx,
  input?: { holderId?: string; cardId?: string },
): Promise<BenefitFilterOption[]> {
  const f = parse(benefitOptsSchema, input ?? {});

  const conds: SQL[] = [eq(benefitInstances.workspaceId, ctx.workspaceId)];
  if (f.holderId) conds.push(eq(cards.holderId, f.holderId));
  if (f.cardId) conds.push(eq(benefitInstances.cardId, f.cardId));

  const rows = await ctx.db
    .select({
      benefitId: benefitInstances.benefitId,
      overrideId: benefitInstances.overrideId,
      vType: benefitCatalogVersions.benefitType,
      vProvider: benefitCatalogVersions.benefitProvider,
      vName: benefitCatalogVersions.exactBenefit,
      oType: cardBenefitOverrides.benefitType,
      oProvider: cardBenefitOverrides.benefitProvider,
      oName: cardBenefitOverrides.exactBenefit,
    })
    .from(benefitInstances)
    .innerJoin(
      cards,
      and(eq(cards.id, benefitInstances.cardId), eq(cards.workspaceId, ctx.workspaceId)),
    )
    .leftJoin(
      benefitCatalogVersions,
      eq(benefitCatalogVersions.id, benefitInstances.generatedFromVersion),
    )
    .leftJoin(
      cardBenefitOverrides,
      and(
        eq(cardBenefitOverrides.id, benefitInstances.overrideId),
        eq(cardBenefitOverrides.workspaceId, ctx.workspaceId),
      ),
    )
    .where(and(...conds));

  const byId = new Map<string, BenefitFilterOption>();
  for (const r of rows) {
    const fromOverride = r.overrideId != null;
    const id = (fromOverride ? r.overrideId : r.benefitId) as string | null;
    if (!id || byId.has(id)) continue;
    byId.set(
      id,
      {
        id,
        label: benefitOptionLabel(
          fromOverride ? r.oType : r.vType,
          fromOverride ? r.oProvider : r.vProvider,
          fromOverride ? r.oName : r.vName,
        ),
      },
    );
  }
  return [...byId.values()].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
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
  let needOrder = 0,
    needOrderCount = 0,
    awaitingCoupon = 0,
    awaitingCouponCount = 0,
    couponToUse = 0,
    couponToUseCount = 0;

  for (const it of items) {
    counts[it.status] += 1;
    if (it.status === 'Skipped' || it.status === 'Withdrawn') continue;
    totalCount += 1;
    totalValue += it.value;
    const voucherQueue = it.offerKind !== 'discount';
    if (voucherQueue && it.status === 'Not Ordered' && !it.lapsed) {
      needOrder += it.value;
      needOrderCount += 1;
    }
    if (voucherQueue && it.status === 'Ordered but Coupon not received') {
      awaitingCoupon += it.value;
      awaitingCouponCount += 1;
    }
    if (voucherQueue && it.status === 'Coupon Received' && it.soldFor == null) {
      couponToUse += it.value;
      couponToUseCount += 1;
    }
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
  const expiringVouchers = expiring.filter((it) => it.offerKind !== 'discount');
  expiringVouchers.sort(
    (a, b) =>
      (a.expiryDate ?? '').localeCompare(b.expiryDate ?? '') ||
      a.benefitName.localeCompare(b.benefitName),
  );

  const todayYear = Number(ctx.today.slice(0, 4));
  const [quarterRedeemedItems, yearRedeemedItems, lifetimeRedeemedItems, lifetimeMissedItems] =
    await Promise.all([
      query(ctx, periodClause(calendarQuarterForDate(ctx.today), ctx.today)),
      query(ctx, periodClause({ kind: 'year', year: todayYear }, ctx.today)),
      query(ctx, eq(benefitInstances.orderStatus, 'Coupon Redeemed')),
      query(
        ctx,
        and(
          eq(benefitInstances.orderStatus, 'Not Ordered'),
          sql`${benefitInstances.periodEnd} < ${ctx.today}`,
        ),
      ),
    ]);
  const missedLifetime = sumMissedOrdering(lifetimeMissedItems);
  const redeemedQuarter = sumRedeemed(quarterRedeemedItems);
  const redeemedYear = sumRedeemed(yearRedeemedItems);
  const redeemedLifetime = sumRedeemed(lifetimeRedeemedItems);

  return {
    counts,
    actionValues: {
      needOrder: round2(needOrder),
      needOrderCount,
      awaitingCoupon: round2(awaitingCoupon),
      awaitingCouponCount,
      couponToUse: round2(couponToUse),
      couponToUseCount,
    },
    totalCount,
    totalValue: round2(totalValue),
    orderedValue: round2(orderedValue),
    redeemedValue: round2(redeemedValue),
    outstandingValue: round2(outstandingValue),
    lapsedCount,
    lapsedValue: round2(lapsedValue),
    soldValue: round2(soldValue),
    perHolder: [...holders.values()].sort((a, b) => a.holderName.localeCompare(b.holderName)),
    expiringSoon: expiringVouchers,
    expiringWithinDays: EXPIRING_DAYS,
    redeemedThisQuarter: redeemedQuarter.value,
    redeemedThisQuarterCount: redeemedQuarter.count,
    redeemedThisYear: redeemedYear.value,
    redeemedThisYearCount: redeemedYear.count,
    redeemedLifetime: redeemedLifetime.value,
    redeemedLifetimeCount: redeemedLifetime.count,
    missedOrderLifetime: missedLifetime.value,
    missedOrderLifetimeCount: missedLifetime.count,
  };
}
