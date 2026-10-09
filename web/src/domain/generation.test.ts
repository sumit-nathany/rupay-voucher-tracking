import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/test/db';
import {
  bankCardTypes,
  benefitCatalogVersions,
  benefitInstances,
  benefits,
  cardBenefitOverrides,
  cardHolders,
  cards,
  workspaces,
} from '@/db/schema';
import type { Ctx, Database } from '@/lib/context';
import { today as istToday, type ViewedPeriod } from '@/lib/periods';
import { ensureInstances } from './generation';

let db: Database;
let close: () => Promise<void>;
let seq = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

const ctxFor = (workspaceId: string, today: string): Ctx => ({
  userId: '00000000-0000-0000-0000-000000000001',
  workspaceId,
  role: 'admin',
  db,
  today,
});

const Q = (year: number, quarter: 1 | 2 | 3 | 4): ViewedPeriod => ({ kind: 'quarter', year, quarter });

interface VSpec {
  frequency?: string;
  count?: number;
  from?: string;
  to?: string | null;
}

async function mkWorkspace() {
  const [w] = await db.insert(workspaces).values({ name: `w${++seq}` }).returning();
  const [h] = await db.insert(cardHolders).values({ workspaceId: w.id, name: 'h' }).returning();
  return { wsId: w.id, holderId: h.id };
}

async function mkType(active = true) {
  const [t] = await db
    .insert(bankCardTypes)
    .values({ displayName: `bank${++seq} X`, active })
    .returning();
  return t.id;
}

async function mkBenefit(typeId: string, v: VSpec = {}) {
  const [b] = await db.insert(benefits).values({ bankCardTypeId: typeId }).returning();
  const [ver] = await db
    .insert(benefitCatalogVersions)
    .values({
      benefitId: b.id,
      benefitType: 't',
      exactBenefit: 'orig',
      frequency: v.frequency ?? 'Quarterly',
      instanceCount: v.count ?? 1,
      effectiveFrom: v.from ?? '2020-01-01',
      effectiveTo: v.to ?? null,
    })
    .returning();
  return { benefitId: b.id, versionId: ver.id };
}

async function mkCard(wsId: string, holderId: string, typeId: string, trackingFrom = '2026-01-01', active = true) {
  const [c] = await db
    .insert(cards)
    .values({ workspaceId: wsId, holderId, bankCardTypeId: typeId, displayName: `c${++seq}`, trackingFrom, active })
    .returning();
  return c.id;
}

async function suppress(wsId: string, cardId: string, typeId: string, benefitId: string) {
  const [o] = await db
    .insert(cardBenefitOverrides)
    .values({ workspaceId: wsId, cardId, bankCardTypeId: typeId, kind: 'suppress', benefitId })
    .returning();
  return o.id;
}

async function setSuppress(id: string, active: boolean) {
  await db.update(cardBenefitOverrides).set({ active }).where(eq(cardBenefitOverrides.id, id));
}

const rows = (cardId: string) =>
  db.select().from(benefitInstances).where(eq(benefitInstances.cardId, cardId));
const labelsOf = async (cardId: string, benefitId?: string) =>
  (await rows(cardId))
    .filter((r) => !benefitId || r.benefitId === benefitId)
    .map((r) => r.periodLabel)
    .sort();

// Fixture: one workspace, one type, one card tracked since the start of 2026.
async function basic(v: VSpec = {}, trackingFrom = '2026-01-01') {
  const { wsId, holderId } = await mkWorkspace();
  const typeId = await mkType();
  const ben = await mkBenefit(typeId, v);
  const cardId = await mkCard(wsId, holderId, typeId, trackingFrom);
  return { wsId, holderId, typeId, cardId, ...ben };
}

describe('generation', () => {
  it('makes a mid-period benefit addition visible (no version at period start)', async () => {
    const f = await basic({ from: '2026-08-01' });
    await ensureInstances(ctxFor(f.wsId, '2026-08-15'), Q(2026, 3));
    expect(await labelsOf(f.cardId)).toEqual(['2026-Q3']);
  });

  it('future-dated version generates nothing and nothing is shown Withdrawn', async () => {
    const f = await basic({ from: '2026-09-01' });
    const res = await ensureInstances(ctxFor(f.wsId, '2026-08-15'), Q(2026, 3));
    expect(await rows(f.cardId)).toEqual([]);
    expect(res.withdrawn).toBe(0);
    // appears on the first view on/after its start date
    await ensureInstances(ctxFor(f.wsId, '2026-09-01'), Q(2026, 3));
    const r = await rows(f.cardId);
    expect(r.map((x) => x.orderStatus)).toEqual(['Not Ordered']);
  });

  it('in-place correction is visible immediately; a new version only affects later periods', async () => {
    const f = await basic();
    await ensureInstances(ctxFor(f.wsId, '2026-08-15'), Q(2026, 3));
    const [inst] = await rows(f.cardId);
    expect(inst.generatedFromVersion).toBe(f.versionId);

    // correction: same version row edited
    await db.update(benefitCatalogVersions).set({ exactBenefit: 'fixed' }).where(eq(benefitCatalogVersions.id, f.versionId));
    await ensureInstances(ctxFor(f.wsId, '2026-08-16'), Q(2026, 3));
    expect(await rows(f.cardId)).toHaveLength(1);
    const [joined] = await db
      .select({ text: benefitCatalogVersions.exactBenefit })
      .from(benefitInstances)
      .innerJoin(benefitCatalogVersions, eq(benefitCatalogVersions.id, benefitInstances.generatedFromVersion))
      .where(eq(benefitInstances.cardId, f.cardId));
    expect(joined.text).toBe('fixed');

    // genuine new version from 2026-09-01
    await db.update(benefitCatalogVersions).set({ effectiveTo: '2026-08-31' }).where(eq(benefitCatalogVersions.id, f.versionId));
    const [v2] = await db
      .insert(benefitCatalogVersions)
      .values({ benefitId: f.benefitId, benefitType: 't', exactBenefit: 'v2', frequency: 'Quarterly', effectiveFrom: '2026-09-01' })
      .returning();
    await ensureInstances(ctxFor(f.wsId, '2026-09-10'), Q(2026, 3));
    const q3 = (await rows(f.cardId)).filter((r) => r.periodLabel === '2026-Q3');
    expect(q3).toHaveLength(1);
    expect(q3[0].generatedFromVersion).toBe(f.versionId); // earliest overlapping, unchanged
    await ensureInstances(ctxFor(f.wsId, '2026-10-05'), Q(2026, 4));
    const q4 = (await rows(f.cardId)).filter((r) => r.periodLabel === '2026-Q4');
    expect(q4[0].generatedFromVersion).toBe(v2.id);
  });

  it('Quarterly->Monthly frequency fork produces no key collision', async () => {
    const { wsId, holderId } = await mkWorkspace();
    const typeId = await mkType();
    const old = await mkBenefit(typeId, { frequency: 'Quarterly', to: '2026-06-30' });
    const mon = await mkBenefit(typeId, { frequency: 'Monthly', from: '2026-07-01' });
    const cardId = await mkCard(wsId, holderId, typeId);
    await ensureInstances(ctxFor(wsId, '2026-07-10'), Q(2026, 3));
    expect(await labelsOf(cardId, mon.benefitId)).toEqual(['2026-07']);
    const july = (await rows(cardId)).find((r) => r.benefitId === mon.benefitId)!;
    expect(july.periodStart).toBe('2026-07-01');
    // old Quarterly benefit: Q3 does not overlap its closed window
    expect((await labelsOf(cardId, old.benefitId))).not.toContain('2026-Q3');
    expect(await labelsOf(cardId, old.benefitId)).toEqual([]); // Q3 view never touches Q2
    // and Q2 view creates the old quarterly Q2 row without clashing with anything
    await ensureInstances(ctxFor(wsId, '2026-07-10'), Q(2026, 2));
    expect(await labelsOf(cardId, old.benefitId)).toEqual(['2026-Q2']);
  });

  it('is idempotent and safe under concurrent double-call', async () => {
    const f = await basic({ count: 2 });
    const ctx = ctxFor(f.wsId, '2026-08-15');
    const [a, b] = await Promise.all([ensureInstances(ctx, Q(2026, 3)), ensureInstances(ctx, Q(2026, 3))]);
    expect(a.inserted + b.inserted).toBe(2);
    const again = await ensureInstances(ctx, Q(2026, 3));
    expect(again).toEqual({ inserted: 0, withdrawn: 0, restored: 0 });
    expect(await rows(f.cardId)).toHaveLength(2);
  });

  it('sets copied/derived columns', async () => {
    const f = await basic({ count: 3 });
    await ensureInstances(ctxFor(f.wsId, '2026-08-15'), Q(2026, 3));
    const r = (await rows(f.cardId)).sort((a, b) => a.instanceNumber - b.instanceNumber);
    expect(r.map((x) => x.instanceNumber)).toEqual([1, 2, 3]);
    expect(r[0]).toMatchObject({
      workspaceId: f.wsId,
      bankCardTypeId: f.typeId,
      generatedFromVersion: f.versionId,
      periodStart: '2026-07-01',
      periodEnd: '2026-09-30',
      orderDeadline: '2026-09-30',
      periodLabel: '2026-Q3',
      orderStatus: 'Not Ordered',
    });
  });

  it('card added mid-Feb still gets annual + Q1 (and Q2 once it started), no future periods', async () => {
    const { wsId, holderId } = await mkWorkspace();
    const typeId = await mkType();
    const ann = await mkBenefit(typeId, { frequency: 'Annual' });
    const qtr = await mkBenefit(typeId, { frequency: 'Quarterly' });
    const cardId = await mkCard(wsId, holderId, typeId, '2026-02-10');
    await ensureInstances(ctxFor(wsId, '2026-02-12'), { kind: 'year', year: 2026 });
    expect(await labelsOf(cardId, ann.benefitId)).toEqual(['2026']);
    expect(await labelsOf(cardId, qtr.benefitId)).toEqual(['2026-Q1']);
    await ensureInstances(ctxFor(wsId, '2026-05-10'), { kind: 'year', year: 2026 });
    expect(await labelsOf(cardId, qtr.benefitId)).toEqual(['2026-Q1', '2026-Q2']);
  });

  it('year view generates nested started quarters/months/halves', async () => {
    const { wsId, holderId } = await mkWorkspace();
    const typeId = await mkType();
    const ann = await mkBenefit(typeId, { frequency: 'Annual' });
    const half = await mkBenefit(typeId, { frequency: '6 months' });
    const qtr = await mkBenefit(typeId, { frequency: 'Quarterly' });
    const mon = await mkBenefit(typeId, { frequency: 'Monthly' });
    const cardId = await mkCard(wsId, holderId, typeId);
    await ensureInstances(ctxFor(wsId, '2026-05-10'), { kind: 'year', year: 2026 });
    expect(await labelsOf(cardId, ann.benefitId)).toEqual(['2026']);
    expect(await labelsOf(cardId, half.benefitId)).toEqual(['2026-H1']);
    expect(await labelsOf(cardId, qtr.benefitId)).toEqual(['2026-Q1', '2026-Q2']);
    expect(await labelsOf(cardId, mon.benefitId)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04', '2026-05']);
  });

  it('active add overrides generate with instance_count and are withdrawn/restored by on/off', async () => {
    const { wsId, holderId } = await mkWorkspace();
    const typeId = await mkType();
    const cardId = await mkCard(wsId, holderId, typeId);
    const [o] = await db
      .insert(cardBenefitOverrides)
      .values({ workspaceId: wsId, cardId, bankCardTypeId: typeId, kind: 'add', benefitType: 't', exactBenefit: 'mine', frequency: 'Quarterly', instanceCount: 2 })
      .returning();
    const [off] = await db
      .insert(cardBenefitOverrides)
      .values({ workspaceId: wsId, cardId, bankCardTypeId: typeId, kind: 'add', benefitType: 't', exactBenefit: 'off', frequency: 'Quarterly', instanceCount: 1, active: false })
      .returning();
    const ctx = ctxFor(wsId, '2026-08-15');
    await ensureInstances(ctx, Q(2026, 3));
    const r = await rows(cardId);
    expect(r).toHaveLength(2);
    expect(r.every((x) => x.overrideId === o.id && x.benefitId === null && x.generatedFromVersion === null)).toBe(true);
    expect(r.some((x) => x.overrideId === off.id)).toBe(false);
    await setSuppress(o.id, false);
    expect((await ensureInstances(ctx, Q(2026, 3))).withdrawn).toBe(2);
    expect((await rows(cardId)).every((x) => x.orderStatus === 'Withdrawn')).toBe(true);
    await setSuppress(o.id, true);
    expect((await ensureInstances(ctx, Q(2026, 3))).restored).toBe(2);
    expect((await rows(cardId)).every((x) => x.orderStatus === 'Not Ordered')).toBe(true);
  });
});

describe('withdrawal sweep', () => {
  const ctxOf = (f: { wsId: string }) => ctxFor(f.wsId, '2026-08-15');
  const status = async (cardId: string, label = '2026-Q3') =>
    (await rows(cardId)).find((r) => r.periodLabel === label)!.orderStatus;

  it('suppress then un-suppress', async () => {
    const f = await basic();
    await ensureInstances(ctxOf(f), Q(2026, 3));
    const o = await suppress(f.wsId, f.cardId, f.typeId, f.benefitId);
    await ensureInstances(ctxOf(f), Q(2026, 3));
    expect(await status(f.cardId)).toBe('Withdrawn');
    await setSuppress(o, false);
    await ensureInstances(ctxOf(f), Q(2026, 3));
    expect(await status(f.cardId)).toBe('Not Ordered');
  });

  it('suppressed before first generation: nothing generated', async () => {
    const f = await basic();
    await suppress(f.wsId, f.cardId, f.typeId, f.benefitId);
    await ensureInstances(ctxOf(f), Q(2026, 3));
    expect(await rows(f.cardId)).toEqual([]);
  });

  it('bank-dropped x user-suppressed: all four combinations, any order', async () => {
    const f = await basic();
    await ensureInstances(ctxOf(f), Q(2026, 3)); // neither
    expect(await status(f.cardId)).toBe('Not Ordered');
    const drop = () => db.update(benefitCatalogVersions).set({ effectiveTo: '2026-08-01' }).where(eq(benefitCatalogVersions.id, f.versionId));
    const reinstate = () => db.update(benefitCatalogVersions).set({ effectiveTo: null }).where(eq(benefitCatalogVersions.id, f.versionId));

    await drop(); // dropped only
    await ensureInstances(ctxOf(f), Q(2026, 3));
    expect(await status(f.cardId)).toBe('Withdrawn');

    const o = await suppress(f.wsId, f.cardId, f.typeId, f.benefitId); // both
    await ensureInstances(ctxOf(f), Q(2026, 3));
    expect(await status(f.cardId)).toBe('Withdrawn');

    await setSuppress(o, false); // dropped only (suppression removed): still ineligible
    await ensureInstances(ctxOf(f), Q(2026, 3));
    expect(await status(f.cardId)).toBe('Withdrawn');

    await setSuppress(o, true); // both again
    await reinstate(); // suppressed only: still ineligible
    await ensureInstances(ctxOf(f), Q(2026, 3));
    expect(await status(f.cardId)).toBe('Withdrawn');

    await setSuppress(o, false); // neither: restored
    await ensureInstances(ctxOf(f), Q(2026, 3));
    expect(await status(f.cardId)).toBe('Not Ordered');
  });

  it('past-period Not Ordered stays Not Ordered (Lapsed) while the current period is withdrawn', async () => {
    const f = await basic();
    const ctx = ctxOf(f);
    await ensureInstances(ctx, Q(2026, 2));
    await ensureInstances(ctx, Q(2026, 3));
    await suppress(f.wsId, f.cardId, f.typeId, f.benefitId);
    await ensureInstances(ctx, Q(2026, 3));
    expect(await status(f.cardId, '2026-Q2')).toBe('Not Ordered');
    expect(await status(f.cardId, '2026-Q3')).toBe('Withdrawn');
  });

  it('a past-period Withdrawn instance is also never touched (out of scope)', async () => {
    const f = await basic();
    await ensureInstances(ctxOf(f), Q(2026, 2));
    await db.update(benefitInstances).set({ orderStatus: 'Withdrawn' }).where(eq(benefitInstances.cardId, f.cardId));
    await ensureInstances(ctxOf(f), Q(2026, 2));
    expect(await status(f.cardId, '2026-Q2')).toBe('Withdrawn');
  });

  it('ordered/received/redeemed/skipped are never swept', async () => {
    const f = await basic({ count: 4 });
    await ensureInstances(ctxOf(f), Q(2026, 3));
    const sts = ['Ordered but Coupon not received', 'Coupon Received', 'Coupon Redeemed', 'Skipped'];
    const r = (await rows(f.cardId)).sort((a, b) => a.instanceNumber - b.instanceNumber);
    for (let i = 0; i < 4; i++) {
      await db.update(benefitInstances).set({ orderStatus: sts[i] }).where(eq(benefitInstances.id, r[i].id));
    }
    await suppress(f.wsId, f.cardId, f.typeId, f.benefitId);
    const res = await ensureInstances(ctxOf(f), Q(2026, 3));
    expect(res.withdrawn).toBe(0);
    const after = (await rows(f.cardId)).sort((a, b) => a.instanceNumber - b.instanceNumber);
    expect(after.map((x) => x.orderStatus)).toEqual(sts);
  });

  it('updates updated_at on rows it changes', async () => {
    const f = await basic();
    await ensureInstances(ctxOf(f), Q(2026, 3));
    await db.update(benefitInstances).set({ updatedAt: new Date('2000-01-01') }).where(eq(benefitInstances.cardId, f.cardId));
    await suppress(f.wsId, f.cardId, f.typeId, f.benefitId);
    await ensureInstances(ctxOf(f), Q(2026, 3));
    const [r] = await rows(f.cardId);
    expect(r.updatedAt!.getFullYear()).toBeGreaterThan(2000);
  });
});

describe('scoping and boundaries', () => {
  it('skips inactive cards and inactive card types', async () => {
    const { wsId, holderId } = await mkWorkspace();
    const typeId = await mkType();
    await mkBenefit(typeId);
    const inactiveCard = await mkCard(wsId, holderId, typeId, '2026-01-01', false);
    const deadType = await mkType(false);
    await mkBenefit(deadType);
    const cardOfDeadType = await mkCard(wsId, holderId, deadType);
    await ensureInstances(ctxFor(wsId, '2026-08-15'), Q(2026, 3));
    expect(await rows(inactiveCard)).toEqual([]);
    expect(await rows(cardOfDeadType)).toEqual([]);
  });

  it('IST midnight boundary via ctx.today decides whether the new quarter exists', async () => {
    const f = await basic();
    const before = istToday(new Date('2026-09-30T18:29:59Z')); // 2026-09-30 IST
    const after = istToday(new Date('2026-09-30T18:30:00Z')); // 2026-10-01 IST
    await ensureInstances(ctxFor(f.wsId, before), Q(2026, 4));
    expect(await labelsOf(f.cardId)).not.toContain('2026-Q4');
    await ensureInstances(ctxFor(f.wsId, after), Q(2026, 4));
    expect(await labelsOf(f.cardId)).toContain('2026-Q4');
  });

  it('workspace A generation/sweep never touches workspace B', async () => {
    const a = await basic();
    const typeId = a.typeId;
    const { wsId: bWs, holderId: bHolder } = await mkWorkspace();
    const bCard = await mkCard(bWs, bHolder, typeId);
    // B has an instance and a suppression that A's sweep must not act on
    await ensureInstances(ctxFor(bWs, '2026-08-15'), Q(2026, 3));
    await suppress(bWs, bCard, typeId, a.benefitId);
    const bBefore = await rows(bCard);
    expect(bBefore.length).toBeGreaterThan(0);

    await ensureInstances(ctxFor(a.wsId, '2026-08-15'), Q(2026, 3));
    const bAfter = await rows(bCard);
    expect(bAfter.map((r) => [r.id, r.orderStatus])).toEqual(bBefore.map((r) => [r.id, r.orderStatus]));
    expect(bAfter.every((r) => r.workspaceId === bWs)).toBe(true);
    expect((await rows(a.cardId)).every((r) => r.workspaceId === a.wsId)).toBe(true);

    // and B's own run applies B's suppression
    await ensureInstances(ctxFor(bWs, '2026-08-15'), Q(2026, 3));
    expect((await rows(bCard)).every((r) => r.orderStatus === 'Withdrawn')).toBe(true);
    // A unaffected
    expect((await rows(a.cardId)).every((r) => r.orderStatus === 'Not Ordered')).toBe(true);
  });
});
