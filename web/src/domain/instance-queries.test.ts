import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/test/db';
import {
  bankCardTypes, benefitCatalogVersions, benefitInstances, benefits,
  cardBenefitOverrides, cardHolders, cards, workspaces,
} from '@/db/schema';
import type { Ctx } from '@/lib/context';
import { ValidationError } from './workspace-data';
import { getDashboardSummary, listInstances } from './instance-queries';

let db: Ctx['db'];
let close: () => Promise<void>;
let A: Ctx;
let B: Ctx;
let typeId: string;
let alpha: { benefitId: string; versionId: string };
let beta: { benefitId: string; versionId: string };
let holderA1: string, holderA2: string, holderB: string;
let cardA1: string, cardA2: string, cardB: string;
let overrideId: string;
let n = 0;

const Q3 = { kind: 'quarter', year: 2026, quarter: 3 } as const;

async function mkVersion(name: string, value: string | null, frequency = 'Quarterly') {
  const [b] = await db.insert(benefits).values({ bankCardTypeId: typeId }).returning();
  const [v] = await db.insert(benefitCatalogVersions).values({
    benefitId: b.id, benefitType: 'Voucher', benefitProvider: `${name}-prov`, exactBenefit: name,
    frequency, defaultCashValue: value, effectiveFrom: '2026-01-01',
  }).returning();
  return { benefitId: b.id, versionId: v.id };
}

type Ins = {
  ws: Ctx; card: string; ben: { benefitId: string; versionId: string };
  start: string; end: string; label: string; status?: string;
  cash?: string | null; sold?: string | null; expiry?: string | null; code?: string | null;
  bookingId?: string | null;
};
async function mk(i: Ins) {
  n += 1;
  const [r] = await db.insert(benefitInstances).values({
    workspaceId: i.ws.workspaceId, cardId: i.card, bankCardTypeId: typeId,
    benefitId: i.ben.benefitId, generatedFromVersion: i.ben.versionId,
    periodStart: i.start, periodEnd: i.end, periodLabel: i.label, orderDeadline: i.end,
    orderStatus: i.status ?? 'Not Ordered', cashValue: i.cash ?? null, soldFor: i.sold ?? null,
    expiryDate: i.expiry ?? null, codeEncrypted: i.code ?? null, instanceNumber: n,
    rupayBookingId: i.bookingId ?? null,
  }).returning();
  return r.id;
}

const q3 = { start: '2026-07-01', end: '2026-09-30', label: '2026-Q3' };
const h2 = { start: '2026-07-01', end: '2026-12-31', label: '2026-H2' };
const yr = { start: '2026-01-01', end: '2026-12-31', label: '2026' };
const q2 = { start: '2026-04-01', end: '2026-06-30', label: '2026-Q2' };

let idQ3Alpha: string, idQ3Beta: string, idH2: string, idYear: string, idQ2: string;
let idSkipped: string, idWithdrawn: string, idOverride: string, idB: string;
let idExpiring: string, idSold: string, idRedeemed: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [wa] = await db.insert(workspaces).values({ name: 'A' }).returning();
  const [wb] = await db.insert(workspaces).values({ name: 'B' }).returning();
  const mkCtx = (w: string): Ctx => ({ userId: randomUUID(), workspaceId: w, role: 'admin', db, today: '2026-07-10' });
  A = mkCtx(wa.id); B = mkCtx(wb.id);
  const [t] = await db.insert(bankCardTypes).values({ displayName: 'PNB Select' }).returning();
  typeId = t.id;
  alpha = await mkVersion('Alpha Spa', '500.00');
  beta = await mkVersion('Beta Movie', '200.00');
  const annual = await mkVersion('Gaana Annual', null, 'Annual');
  const half = await mkVersion('Half Golf', '1000.00', '6 months');

  const mkHolder = async (w: string, name: string) =>
    (await db.insert(cardHolders).values({ workspaceId: w, name }).returning())[0].id;
  holderA1 = await mkHolder(wa.id, 'Asha');
  holderA2 = await mkHolder(wa.id, 'Bhavin');
  holderB = await mkHolder(wb.id, 'Zed');
  const mkCard = async (w: string, h: string, name: string, last: string) =>
    (await db.insert(cards).values({
      workspaceId: w, holderId: h, bankCardTypeId: typeId, displayName: name,
      lastDigits: last, trackingFrom: '2026-01-01',
    }).returning())[0].id;
  cardA1 = await mkCard(wa.id, holderA1, 'PNB 7825', '7825');
  cardA2 = await mkCard(wa.id, holderA2, 'PNB 1111', '1111');
  cardB = await mkCard(wb.id, holderB, 'PNB 9999', '9999');

  // Workspace A, viewed (Q3 2026) set. Inserted out of order on purpose.
  idYear = await mk({ ws: A, card: cardA1, ben: annual, ...yr });
  idH2 = await mk({ ws: A, card: cardA1, ben: half, ...h2 });
  idQ3Beta = await mk({ ws: A, card: cardA1, ben: beta, ...q3, bookingId: 'RUPAY-BOOK-1234' });
  idQ3Alpha = await mk({ ws: A, card: cardA1, ben: alpha, ...q3, code: 'ENCRYPTED-BLOB-XYZ' });
  idQ2 = await mk({ ws: A, card: cardA1, ben: alpha, ...q2 }); // outside the view, lapsed
  idSkipped = await mk({ ws: A, card: cardA2, ben: alpha, ...q3, status: 'Skipped' });
  idWithdrawn = await mk({ ws: A, card: cardA2, ben: beta, ...q3, status: 'Withdrawn' });
  idRedeemed = await mk({ ws: A, card: cardA2, ben: half, ...h2, status: 'Coupon Redeemed', cash: '450.00' });
  await mk({ ws: A, card: cardA2, ben: beta, ...h2, status: 'Ordered but Coupon not received' });
  idExpiring = await mk({ ws: A, card: cardA1, ben: beta, ...yr, status: 'Coupon Received', expiry: '2026-08-01' });
  idSold = await mk({ ws: A, card: cardA1, ben: alpha, ...yr, status: 'Coupon Received', expiry: '2026-07-20', sold: '300.00' });
  await mk({ ws: A, card: cardA1, ben: alpha, ...yr, status: 'Coupon Received', expiry: '2026-09-15' }); // beyond 30d
  await mk({ ws: A, card: cardA1, ben: alpha, ...yr, status: 'Coupon Received', expiry: '2026-07-01' }); // already expired

  // Override-sourced instance (card-level add).
  const [o] = await db.insert(cardBenefitOverrides).values({
    workspaceId: wa.id, cardId: cardA1, bankCardTypeId: typeId, kind: 'add', benefitType: 'Extra',
    benefitProvider: 'Zomato', exactBenefit: 'Aardvark Dinner', frequency: 'Quarterly',
    instanceCount: 1, defaultCashValue: '100.00',
  }).returning();
  overrideId = o.id;
  n += 1;
  idOverride = (await db.insert(benefitInstances).values({
    workspaceId: wa.id, cardId: cardA1, bankCardTypeId: typeId, overrideId,
    periodStart: q3.start, periodEnd: q3.end, periodLabel: q3.label, orderDeadline: q3.end,
    instanceNumber: n,
  }).returning())[0].id;

  // Workspace B has instances in the very same period.
  idB = await mk({ ws: B, card: cardB, ben: alpha, ...q3, code: 'B-SECRET-BLOB' });
  await mk({ ws: B, card: cardB, ben: beta, ...yr, status: 'Coupon Received', expiry: '2026-07-15' });
});
afterAll(() => close());

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('listInstances', () => {
  it('returns only the viewed period set and joins display fields', async () => {
    const rows = await listInstances(A, { view: Q3 });
    expect(ids(rows)).not.toContain(idQ2);
    expect(ids(rows)).toContain(idQ3Alpha);
    expect(ids(rows)).toContain(idH2);
    expect(ids(rows)).toContain(idYear);
    const r = rows.find((x) => x.id === idQ3Alpha)!;
    expect(r).toMatchObject({
      benefitName: 'Alpha Spa', benefitProvider: 'Alpha Spa-prov', benefitType: 'Voucher',
      frequency: 'Quarterly', source: 'catalog', periodLabel: '2026-Q3',
      periodStart: '2026-07-01', periodEnd: '2026-09-30',
      cardName: 'PNB 7825', cardLastDigits: '7825', cardTypeName: 'PNB Select',
      holderName: 'Asha', defaultCashValue: 500, cashValue: null, value: 500, status: 'Not Ordered',
    });
  });

  it('a different view excludes the Q3-only rows and includes Q2', async () => {
    const rows = await listInstances(A, { view: { kind: 'quarter', year: 2026, quarter: 2 } });
    expect(ids(rows)).toContain(idQ2);
    expect(ids(rows)).toContain(idYear);
    expect(ids(rows)).not.toContain(idQ3Alpha);
  });

  it('scope lifetime lists across all periods with status and lapsed filters', async () => {
    const later: Ctx = { ...A, today: '2026-10-05' };
    const q3Only = await listInstances(later, { view: Q3 });
    expect(ids(q3Only)).not.toContain(idQ2);
    const allRedeemed = await listInstances(later, { view: Q3, scope: 'lifetime', status: 'Coupon Redeemed' });
    expect(ids(allRedeemed)).toContain(idRedeemed);
    const missed = await listInstances(later, {
      view: Q3,
      scope: 'lifetime',
      status: 'Not Ordered',
      lapsed: '1',
    });
    expect(ids(missed)).toContain(idQ2);
    expect(ids(missed)).toContain(idQ3Alpha);
  });

  it('sorts by period_end asc, then benefit name; includes Skipped and Withdrawn', async () => {
    const rows = await listInstances(A, { view: Q3, cardId: cardA1 });
    const keys = rows.map((r) => [r.periodEnd, r.benefitName.toLowerCase()]);
    const sorted = [...keys].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    expect(keys).toEqual(sorted);
    const all = await listInstances(A, { view: Q3 });
    expect(all.find((r) => r.id === idSkipped)!.status).toBe('Skipped');
    expect(all.find((r) => r.id === idWithdrawn)!.status).toBe('Withdrawn');
    // Q3 end rows precede H2 end, which precede year end.
    expect(all[0].periodEnd).toBe('2026-09-30');
    expect(all[all.length - 1].periodEnd).toBe('2026-12-31');
  });

  it('override-sourced rows use override terms', async () => {
    const r = (await listInstances(A, { view: Q3 })).find((x) => x.id === idOverride)!;
    expect(r).toMatchObject({
      source: 'override', benefitName: 'Aardvark Dinner', benefitProvider: 'Zomato',
      frequency: 'Quarterly', defaultCashValue: 100, value: 100,
    });
  });

  it('instance cash_value overrides the default in value; null default counts as 0', async () => {
    const rows = await listInstances(A, { view: Q3 });
    expect(rows.find((x) => x.id === idRedeemed)).toMatchObject({ cashValue: 450, defaultCashValue: 1000, value: 450 });
    expect(rows.find((x) => x.id === idYear)).toMatchObject({ defaultCashValue: null, value: 0 });
  });

  it('filters by catalog benefit id and card override id', async () => {
    const alphaRows = await listInstances(A, { view: Q3, benefitId: alpha.benefitId });
    expect(alphaRows.length).toBeGreaterThan(0);
    expect(alphaRows.every((r) => r.benefitName === 'Alpha Spa' || r.benefitProvider === 'Alpha Spa-prov')).toBe(
      true,
    );
    expect(ids(alphaRows)).not.toContain(idQ3Beta);

    const ov = await listInstances(A, { view: Q3, benefitId: overrideId });
    expect(ids(ov)).toEqual([idOverride]);

    expect(await listInstances(A, { view: Q3, benefitId: randomUUID() })).toEqual([]);
  });

  it('filters by holder, card, status and search', async () => {
    const h = await listInstances(A, { view: Q3, holderId: holderA2 });
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((r) => r.holderId === holderA2)).toBe(true);

    const c = await listInstances(A, { view: Q3, cardId: cardA2 });
    expect(c.every((r) => r.cardId === cardA2)).toBe(true);

    const s = await listInstances(A, { view: Q3, status: 'Skipped' });
    expect(ids(s)).toEqual([idSkipped]);

    const srch = await listInstances(A, { view: Q3, search: 'aardvark' });
    expect(ids(srch)).toEqual([idOverride]);
    const byHolder = await listInstances(A, { view: Q3, search: 'bhav' });
    expect(byHolder.every((r) => r.holderName === 'Bhavin')).toBe(true);
    expect(byHolder.length).toBeGreaterThan(0);
    const byBooking = await listInstances(A, { view: Q3, search: 'BOOK-1234' });
    expect(ids(byBooking)).toEqual([idQ3Beta]);

    // LIKE wildcards are literal.
    expect(await listInstances(A, { view: Q3, search: '%' })).toEqual([]);
  });

  it('combined filters AND together', async () => {
    const r = await listInstances(A, { view: Q3, holderId: holderA1, status: 'Not Ordered', search: 'beta' });
    expect(ids(r)).toEqual([idQ3Beta]);
    const byBenefit = await listInstances(A, {
      view: Q3,
      holderId: holderA1,
      benefitId: beta.benefitId,
      status: 'Not Ordered',
    });
    expect(ids(byBenefit)).toEqual([idQ3Beta]);
  });

  it('searches with scope="all" across all periods and ignores active filter constraints', async () => {
    // Current period (Q3) search for "Alpha" only matches instances in Q3 (idQ3Alpha and idSkipped), not idQ2 (in Q2).
    const q3Search = await listInstances(A, { view: Q3, search: 'Alpha' });
    expect(ids(q3Search)).toContain(idQ3Alpha);
    expect(ids(q3Search)).toContain(idSkipped);
    expect(ids(q3Search)).not.toContain(idQ2);

    // Searching across everything (scope='all') returns matches from all periods (including Q2).
    const allSearch = await listInstances(A, { view: Q3, scope: 'all', search: 'Alpha' });
    expect(ids(allSearch)).toContain(idQ2);
    expect(ids(allSearch)).toContain(idQ3Alpha);
    expect(ids(allSearch)).toContain(idSkipped);

    // scope='all' also bypasses active holder and status filter constraints.
    const constrainedSearch = await listInstances(A, {
      view: Q3,
      scope: 'all',
      holderId: holderA1,
      status: 'Not Ordered',
      search: 'Alpha',
    });
    // Even though holderA1 and Not Ordered were specified, scope='all' ignores them:
    expect(ids(constrainedSearch)).toContain(idQ2);
    expect(ids(constrainedSearch)).toContain(idQ3Alpha);
    expect(ids(constrainedSearch)).toContain(idSkipped); // holderA2 and status Skipped

    // Also works with searchScope='all' parameter with a search term (searches across periods and filters)
    const searchScopeAll = await listInstances(A, {
      view: Q3,
      searchScope: 'all',
      holderId: holderA1,
      status: 'Not Ordered',
      search: 'Alpha',
    });
    expect(ids(searchScopeAll)).toContain(idQ2);
    expect(ids(searchScopeAll)).toContain(idQ3Alpha);
    expect(ids(searchScopeAll)).toContain(idSkipped);

    // searchScope='all' WITHOUT a search term does NOT bypass period and filters (has no effect)
    const searchScopeNoSearch = await listInstances(A, { view: Q3, searchScope: 'all' });
    const defaultQ3 = await listInstances(A, { view: Q3 });
    expect(ids(searchScopeNoSearch)).toEqual(ids(defaultQ3));
    expect(ids(searchScopeNoSearch)).not.toContain(idQ2);

    const searchScopeNoSearchFiltered = await listInstances(A, {
      view: Q3,
      searchScope: 'all',
      holderId: holderA1,
      status: 'Not Ordered',
    });
    const defaultQ3Filtered = await listInstances(A, {
      view: Q3,
      holderId: holderA1,
      status: 'Not Ordered',
    });
    expect(ids(searchScopeNoSearchFiltered)).toEqual(ids(defaultQ3Filtered));
    expect(ids(searchScopeNoSearchFiltered)).not.toContain(idSkipped);
    expect(ids(searchScopeNoSearchFiltered)).not.toContain(idQ2);

    // Searching with scope='all' without a search query cleanly returns all instances across periods
    const allNoSearch = await listInstances(A, { view: Q3, scope: 'all' });
    expect(allNoSearch.length).toBeGreaterThan(q3Search.length);
    expect(ids(allNoSearch)).toContain(idQ2);
    expect(ids(allNoSearch)).toContain(idYear);

    // Workspace isolation is still strictly preserved
    expect(ids(allSearch)).not.toContain(idB);
  });

  it('never leaks codeEncrypted; exposes hasCode only', async () => {
    const rows = await listInstances(A, { view: Q3 });
    expect(JSON.stringify(rows)).not.toContain('ENCRYPTED-BLOB-XYZ');
    expect(rows.every((r) => !('codeEncrypted' in r))).toBe(true);
    expect(rows.find((r) => r.id === idQ3Alpha)!.hasCode).toBe(true);
    expect(rows.find((r) => r.id === idQ3Beta)!.hasCode).toBe(false);
    const sum = await getDashboardSummary(A, Q3);
    expect(JSON.stringify(sum)).not.toContain('ENCRYPTED-BLOB-XYZ');
  });

  it('flags lapsed (Not Ordered, period ended) using ctx.today', async () => {
    const rows = await listInstances(A, { view: Q3 });
    expect(rows.every((r) => !r.lapsed)).toBe(true);
    const later: Ctx = { ...A, today: '2026-10-05' };
    const rows2 = await listInstances(later, { view: Q3 });
    expect(rows2.find((r) => r.id === idQ3Alpha)!.lapsed).toBe(true);
    expect(rows2.find((r) => r.id === idRedeemed)!.lapsed).toBe(false);
  });

  it('rejects bad input, including a caller-supplied workspaceId', async () => {
    await expect(listInstances(A, { view: Q3, workspaceId: B.workspaceId } as never)).rejects.toThrow(ValidationError);
    await expect(listInstances(A, { view: Q3, holderId: 'nope' })).rejects.toThrow(ValidationError);
    await expect(listInstances(A, { view: { kind: 'quarter', year: 2026, quarter: 5 } as never })).rejects.toThrow(ValidationError);
    await expect(listInstances(A, { view: Q3, status: 'Bogus' as never })).rejects.toThrow(ValidationError);
    await expect(listInstances(A, { view: Q3, benefitId: 'nope' })).rejects.toThrow(ValidationError);
  });
});

describe('workspace isolation', () => {
  it("B's instances never appear in A's reads, and vice versa", async () => {
    const a = await listInstances(A, { view: Q3 });
    expect(ids(a)).not.toContain(idB);
    expect(a.every((r) => r.holderName !== 'Zed')).toBe(true);
    const b = await listInstances(B, { view: Q3 });
    expect(ids(b)).toContain(idB);
    expect(ids(b)).not.toContain(idQ3Alpha);
    expect(JSON.stringify(b)).not.toContain('B-SECRET-BLOB');
  });

  it('forged holderId / cardId from the other workspace returns nothing', async () => {
    expect(await listInstances(A, { view: Q3, holderId: holderB })).toEqual([]);
    expect(await listInstances(A, { view: Q3, cardId: cardB })).toEqual([]);
    expect(await listInstances(A, { view: Q3, holderId: holderB, cardId: cardB })).toEqual([]);
    expect(await listInstances(B, { view: Q3, holderId: holderA1 })).toEqual([]);
    expect(await listInstances(B, { view: Q3, cardId: cardA1 })).toEqual([]);
  });

  it('a forged holder id mixed with an own card id does not widen the result', async () => {
    expect(await listInstances(A, { view: Q3, holderId: holderB, cardId: cardA1 })).toEqual([]);
  });

  it('dashboard summary and expiring list are isolated', async () => {
    const sa = await getDashboardSummary(A, Q3);
    expect(sa.perHolder.map((h) => h.holderName)).toEqual(['Asha', 'Bhavin']);
    expect(sa.expiringSoon.every((r) => r.holderName !== 'Zed')).toBe(true);
    const sb = await getDashboardSummary(B, Q3);
    expect(sb.perHolder.map((h) => h.holderName)).toEqual(['Zed']);
    expect(sb.counts['Not Ordered']).toBe(1);
    expect(ids(sb.expiringSoon)).not.toContain(idExpiring);
    expect(sb.expiringSoon).toHaveLength(1);
  });
});

describe('getDashboardSummary', () => {
  it('counts every status over the viewed set, zero-filled', async () => {
    const s = await getDashboardSummary(A, Q3);
    expect(s.counts).toEqual({
      'Not Ordered': 5, // Alpha Q3, Beta Q3, Aardvark, Half Golf H2, Gaana year
      'Ordered but Coupon not received': 1,
      'Coupon Received': 4,
      'Coupon Redeemed': 1,
      Skipped: 1,
      Withdrawn: 1,
    });
  });

  it('computes value totals per the documented definitions', async () => {
    const s = await getDashboardSummary(A, Q3);
    // Active (non Skipped/Withdrawn): NotOrdered 500+200+100+1000+0; Ordered 200;
    // Received: 200 (beta, expiring) + 500 (sold) + 500 + 500 (alpha x2); Redeemed 450 (cash_value).
    expect(s.totalCount).toBe(11);
    expect(s.totalValue).toBe(1800 + 200 + 1700 + 450);
    expect(s.redeemedValue).toBe(450);
    expect(s.orderedValue).toBe(200 + 1700 + 450);
    // outstanding: not-ordered 800 + ordered 200 + received excluding sold (200+500+500)
    expect(s.outstandingValue).toBe(1800 + 200 + 1200);
    expect(s.actionValues).toEqual({
      needOrder: 1800,
      needOrderCount: 5,
      awaitingCoupon: 200,
      awaitingCouponCount: 1,
      couponToUse: 1200,
      couponToUseCount: 3,
    });
    // Q2 Alpha lapsed but outside the Q3 viewed set — counts in lifetime only.
    expect(s.missedOrderLifetime).toBe(500);
    expect(s.missedOrderLifetimeCount).toBe(1);
    expect(s.soldValue).toBe(300);
    expect(s.lapsedCount).toBe(0);
    expect(s.perHolder).toEqual([
      { holderId: holderA1, holderName: 'Asha', total: 9, redeemed: 0 },
      { holderId: holderA2, holderName: 'Bhavin', total: 2, redeemed: 1 },
    ]);
  });

  it('lapsed items are reported separately and stay in outstanding', async () => {
    const s = await getDashboardSummary({ ...A, today: '2026-10-05' }, Q3);
    expect(s.lapsedCount).toBe(3);
    expect(s.lapsedValue).toBe(800);
    // Q3 Not Ordered lapsed (500+200+100); H2/year Not Ordered still in period (1000+0).
    expect(s.actionValues.needOrder).toBe(1000);
    expect(s.actionValues.needOrderCount).toBe(2);
    expect(s.missedOrderLifetime).toBe(1300);
    expect(s.missedOrderLifetimeCount).toBe(4);
  });

  it('expiringSoon: Coupon Received, unsold, within 30 days of ctx.today, soonest first', async () => {
    const s = await getDashboardSummary(A, Q3);
    // 2026-07-10 + 30 = 2026-08-09: includes 08-01; excludes sold 07-20, 09-15, and already-expired 07-01.
    expect(ids(s.expiringSoon)).toEqual([idExpiring]);
    expect(s.expiringWithinDays).toBe(30);
    expect(ids(s.expiringSoon)).not.toContain(idSold);
    // Boundary: today+30 inclusive; a later today shifts the window.
    const later = await getDashboardSummary({ ...A, today: '2026-08-16' }, Q3);
    expect(later.expiringSoon.map((r) => r.expiryDate)).toEqual(['2026-09-15']);
  });

  it('is not limited to the viewed period for expiring items', async () => {
    const s = await getDashboardSummary(A, { kind: 'quarter', year: 2025, quarter: 1 });
    expect(ids(s.expiringSoon)).toEqual([idExpiring]);
    expect(s.totalCount).toBe(0);
  });

  it('validates the view', async () => {
    await expect(getDashboardSummary(A, { kind: 'year', year: 1 } as never)).rejects.toThrow(ValidationError);
  });

  it('reports redeemed totals anchored to ctx.today and lifetime, independent of the viewed period', async () => {
    const inQ3 = await getDashboardSummary(A, Q3);
    expect(inQ3.redeemedThisQuarter).toBe(450);
    expect(inQ3.redeemedThisQuarterCount).toBe(1);
    expect(inQ3.redeemedThisYear).toBe(450);
    expect(inQ3.redeemedThisYearCount).toBe(1);
    expect(inQ3.redeemedLifetime).toBe(450);
    expect(inQ3.redeemedLifetimeCount).toBe(1);

    const otherPeriod = await getDashboardSummary(A, { kind: 'quarter', year: 2025, quarter: 1 });
    expect(otherPeriod.redeemedValue).toBe(0);
    expect(otherPeriod.redeemedThisQuarter).toBe(450);
    expect(otherPeriod.redeemedThisQuarterCount).toBe(1);
    expect(otherPeriod.redeemedThisYear).toBe(450);
    expect(otherPeriod.redeemedThisYearCount).toBe(1);
    expect(otherPeriod.redeemedLifetime).toBe(450);
    expect(otherPeriod.redeemedLifetimeCount).toBe(1);
  });
});

describe('discount coupons', () => {
  it('hides discount coupons by default; offerFilter all or discount controls visibility', async () => {
    const discount = await mkVersion('Flat Rs. 250 Discount on Tickets', '250.00');
    await db
      .update(benefitCatalogVersions)
      .set({ benefitProvider: 'BookMyShow', offerKind: 'discount' })
      .where(eq(benefitCatalogVersions.id, discount.versionId));
    const discId = await mk({
      ws: A, card: cardA1, ben: discount, ...q3, status: 'Not Ordered',
    });
    const voucherId = (await listInstances(A, { view: Q3 }))[0]?.id;
    expect(ids(await listInstances(A, { view: Q3 }))).not.toContain(discId);
    const all = await listInstances(A, { view: Q3, offerFilter: 'all' });
    expect(ids(all)).toContain(discId);
    expect(all.find((x) => x.id === discId)!.offerKind).toBe('discount');
    const discOnly = await listInstances(A, { view: Q3, offerFilter: 'discount' });
    expect(ids(discOnly)).toContain(discId);
    expect(discOnly.every((x) => x.offerKind === 'discount')).toBe(true);
    if (voucherId) expect(ids(discOnly)).not.toContain(voucherId);
  });

  it('excludes discount coupons from dashboard action queue totals', async () => {
    const discount = await mkVersion('10% Instant Discount - Yearly', '1500.00', 'Annual');
    await db
      .update(benefitCatalogVersions)
      .set({ benefitProvider: 'MakeMyTrip', offerKind: 'discount' })
      .where(eq(benefitCatalogVersions.id, discount.versionId));
    await mk({
      ws: A, card: cardA1, ben: discount, ...yr, status: 'Not Ordered',
    });
    const s = await getDashboardSummary(A, Q3);
    expect(s.actionValues.needOrder).toBe(1800);
  });

  it('excludes lapsed discount coupons from missedOrderLifetime totals', async () => {
    const ctx = { ...A, today: '2026-10-05' as const };
    const before = await getDashboardSummary(ctx, Q3);
    const discount = await mkVersion('Flat Rs. 250 Discount on Tickets', '250.00');
    await db
      .update(benefitCatalogVersions)
      .set({ benefitProvider: 'BookMyShow', offerKind: 'discount' })
      .where(eq(benefitCatalogVersions.id, discount.versionId));
    await mk({
      ws: A, card: cardA1, ben: discount, ...q3, status: 'Not Ordered',
    });
    const after = await getDashboardSummary(ctx, Q3);
    expect(after.lapsedCount).toBe(before.lapsedCount + 1);
    expect(after.lapsedValue).toBe(before.lapsedValue + 250);
    expect(after.missedOrderLifetime).toBe(before.missedOrderLifetime);
    expect(after.missedOrderLifetimeCount).toBe(before.missedOrderLifetimeCount);
    expect(before.missedOrderLifetime).toBe(1300);
    expect(before.missedOrderLifetimeCount).toBe(4);
  });

  it('includes discount coupons when searching across everything with scope="all"', async () => {
    const discount = await mkVersion('20% Discount on Flights', '500.00');
    await db
      .update(benefitCatalogVersions)
      .set({ benefitProvider: 'FlightBooking', offerKind: 'discount' })
      .where(eq(benefitCatalogVersions.id, discount.versionId));
    const discId = await mk({
      ws: A, card: cardA1, ben: discount, ...q3, status: 'Not Ordered',
    });

    // Default search excludes discount coupons
    const defaultSearch = await listInstances(A, { view: Q3, search: 'FlightBooking' });
    expect(ids(defaultSearch)).not.toContain(discId);

    // Searching across everything includes discount coupons
    const allSearch = await listInstances(A, { view: Q3, scope: 'all', search: 'FlightBooking' });
    expect(ids(allSearch)).toContain(discId);
  });
});
