import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@/test/db';
import {
  bankCardTypes, benefitCatalogVersions, benefitInstances, benefitOptions, benefits, cardHolders, cards, workspaces,
} from '@/db/schema';
import type { Ctx } from '@/lib/context';
import { NotFoundError } from '@/lib/context';
import { chooseOption, getInstanceOptions, InstanceStateError } from './instances';
import { listInstances } from './instance-queries';

let db: Ctx['db'];
let close: () => Promise<void>;
let ctx: Ctx;
let other: Ctx;
let instId: string;
let optA: string;
let foreignOpt: string;
const Q4 = { kind: 'quarter', year: 2026, quarter: 4 } as const;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [w, w2] = await db.insert(workspaces).values([{ name: 'A' }, { name: 'B' }]).returning();
  ctx = { userId: randomUUID(), workspaceId: w.id, role: 'admin', db, today: '2026-10-10' };
  other = { ...ctx, workspaceId: w2.id };
  const [t] = await db.insert(bankCardTypes).values({ displayName: 'PNB Select' }).returning();
  const [b1, b2] = await db.insert(benefits).values([{ bankCardTypeId: t.id }, { bankCardTypeId: t.id }]).returning();
  const base = { frequency: 'Quarterly', effectiveFrom: '2025-01-01', defaultCashValue: '2700.00' };
  const [v1] = await db.insert(benefitCatalogVersions).values({ ...base, benefitId: b1.id, benefitType: 'Spa Services', exactBenefit: 'Any one of 2 offers' }).returning();
  const [v2] = await db.insert(benefitCatalogVersions).values({ ...base, benefitId: b2.id, benefitType: 'OTT', exactBenefit: 'Any one of 1 offers' }).returning();
  const opts = await db.insert(benefitOptions).values([
    { versionId: v1.id, provider: 'Spa A', offerName: 'Swedish', cashValue: '1850.00', sortOrder: 0 },
    { versionId: v1.id, provider: 'Spa B', offerName: 'Thai', cashValue: '2700.00', sortOrder: 1 },
    { versionId: v2.id, provider: 'Hotstar', offerName: 'Year', cashValue: '1499.00' },
  ]).returning();
  optA = opts[0].id;
  foreignOpt = opts[2].id;
  const [h] = await db.insert(cardHolders).values({ workspaceId: w.id, name: 'Me' }).returning();
  const [c] = await db.insert(cards).values({ workspaceId: w.id, holderId: h.id, bankCardTypeId: t.id, displayName: 'My PNB' }).returning();
  const [i] = await db.insert(benefitInstances).values({
    workspaceId: w.id, cardId: c.id, bankCardTypeId: t.id, benefitId: b1.id, generatedFromVersion: v1.id,
    periodStart: '2026-10-01', periodEnd: '2026-12-31', periodLabel: 'Q4 2026', orderDeadline: '2026-12-31',
  }).returning();
  instId = i.id;
});
afterAll(() => close());

describe('redeem-any-one choice', () => {
  it('lists the version options in order', async () => {
    expect((await getInstanceOptions(ctx, instId)).map((o) => o.provider)).toEqual(['Spa A', 'Spa B']);
  });

  it('before choosing, the list shows the category and the highest value', async () => {
    const [it] = await listInstances(ctx, { view: Q4 });
    expect(it).toMatchObject({ benefitName: 'Any one of 2 offers', benefitProvider: null, value: 2700 });
  });

  it('choosing shows the offer and its value; clearing reverts', async () => {
    expect((await chooseOption(ctx, { instanceId: instId, optionId: optA })).chosenOptionId).toBe(optA);
    const [it] = await listInstances(ctx, { view: Q4 });
    expect(it).toMatchObject({ benefitName: 'Swedish', benefitProvider: 'Spa A', value: 1850 });
    await chooseOption(ctx, { instanceId: instId, optionId: null });
    expect((await listInstances(ctx, { view: Q4 }))[0].benefitProvider).toBeNull();
  });

  it("refuses another benefit's offer and other workspaces", async () => {
    await expect(chooseOption(ctx, { instanceId: instId, optionId: foreignOpt })).rejects.toBeInstanceOf(InstanceStateError);
    await expect(chooseOption(other, { instanceId: instId, optionId: optA })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getInstanceOptions(other, instId)).rejects.toBeInstanceOf(NotFoundError);
  });
});
