import { describe, expect, it } from 'vitest';
import {
  bankCardTypes,
  benefitCatalogVersions,
  benefitInstances,
  benefits,
  cardHolders,
  cards,
  workspaces,
} from '@/db/schema';
import { createTestDb } from '@/test/db';
import {
  deleteBenefitValueOverride,
  listBenefitValueOverrides,
  listDistinctWorkspaceBenefits,
  upsertBenefitValueOverride,
} from './benefit-values';
import { NotFoundError, type Ctx } from '@/lib/context';

describe('benefit-values domain', () => {
  async function seed() {
    const { db } = await createTestDb();
    const [w1] = await db.insert(workspaces).values({ name: 'W1' }).returning();
    const [w2] = await db.insert(workspaces).values({ name: 'W2' }).returning();

    const ctx1: Ctx = {
      userId: '00000000-0000-0000-0000-000000000001',
      workspaceId: w1.id,
      role: 'admin',
      db,
      today: '2026-10-11',
    };

    const ctx2: Ctx = {
      userId: '00000000-0000-0000-0000-000000000002',
      workspaceId: w2.id,
      role: 'admin',
      db,
      today: '2026-10-11',
    };

    const [cardType] = await db
      .insert(bankCardTypes)
      .values({ displayName: 'Test RuPay Select Card', network: 'RuPay' })
      .returning();

    const [b1] = await db.insert(benefits).values({ bankCardTypeId: cardType.id }).returning();
    const [v1] = await db
      .insert(benefitCatalogVersions)
      .values({
        benefitId: b1.id,
        benefitType: 'Entertainment',
        benefitProvider: 'BookMyShow',
        exactBenefit: 'BookMyShow ₹250 Voucher',
        frequency: 'Quarterly',
        instanceCount: 1,
        defaultCashValue: '250.00',
        effectiveFrom: '2026-01-01',
      })
      .returning();

    const [holder1] = await db
      .insert(cardHolders)
      .values({ workspaceId: w1.id, name: 'Holder 1' })
      .returning();

    const [card1] = await db
      .insert(cards)
      .values({
        workspaceId: w1.id,
        holderId: holder1.id,
        bankCardTypeId: cardType.id,
        displayName: 'Card 1',
      })
      .returning();

    await db.insert(benefitInstances).values({
      workspaceId: w1.id,
      cardId: card1.id,
      bankCardTypeId: cardType.id,
      benefitId: b1.id,
      generatedFromVersion: v1.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-12-31',
      periodLabel: '2026-Q4',
      instanceNumber: 1,
      orderDeadline: '2026-12-31',
    });

    return { db, ctx1, ctx2, b1, v1 };
  }

  it('upserts and lists custom benefit valuations per workspace with tenant isolation', async () => {
    const { ctx1, ctx2 } = await seed();

    // 1. Create custom valuation in workspace 1
    const created = await upsertBenefitValueOverride(ctx1, {
      benefitName: 'BookMyShow ₹250 Voucher',
      customValue: 180,
      benefitType: 'Entertainment',
      benefitProvider: 'BookMyShow',
    });

    expect(created.benefitName).toBe('BookMyShow ₹250 Voucher');
    expect(created.customValue).toBe(180);

    // 2. Listed in workspace 1
    const list1 = await listBenefitValueOverrides(ctx1);
    expect(list1).toHaveLength(1);
    expect(list1[0].customValue).toBe(180);

    // 3. Workspace 2 sees nothing (tenant isolation)
    const list2 = await listBenefitValueOverrides(ctx2);
    expect(list2).toHaveLength(0);

    // 4. Updating the same benefit (case-insensitive) updates the row rather than creating duplicate
    const updated = await upsertBenefitValueOverride(ctx1, {
      benefitName: 'bookmyshow ₹250 voucher ',
      customValue: 200,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.customValue).toBe(200);

    const list1After = await listBenefitValueOverrides(ctx1);
    expect(list1After).toHaveLength(1);
    expect(list1After[0].customValue).toBe(200);
  });

  it('deletes custom valuation and enforces workspace boundary', async () => {
    const { ctx1, ctx2 } = await seed();

    const created = await upsertBenefitValueOverride(ctx1, {
      benefitName: 'Amazon Prime 12 Months',
      customValue: 1000,
    });

    // Workspace 2 cannot delete workspace 1's override
    await expect(deleteBenefitValueOverride(ctx2, { id: created.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    // Workspace 1 can delete
    await deleteBenefitValueOverride(ctx1, { id: created.id });
    expect(await listBenefitValueOverrides(ctx1)).toHaveLength(0);
  });

  it('lists distinct workspace benefits merged with custom valuation and catalog value', async () => {
    const { ctx1 } = await seed();

    // Before custom valuation: effectiveValue is catalog value (250)
    const distinctBefore = await listDistinctWorkspaceBenefits(ctx1);
    expect(distinctBefore).toHaveLength(1);
    expect(distinctBefore[0]).toMatchObject({
      benefitName: 'BookMyShow ₹250 Voucher',
      catalogValue: 250,
      customValue: null,
      effectiveValue: 250,
      overrideId: null,
    });

    // Set custom valuation
    await upsertBenefitValueOverride(ctx1, {
      benefitName: 'BookMyShow ₹250 Voucher',
      customValue: 175,
    });

    // After custom valuation: effectiveValue is 175
    const distinctAfter = await listDistinctWorkspaceBenefits(ctx1);
    expect(distinctAfter).toHaveLength(1);
    expect(distinctAfter[0]).toMatchObject({
      benefitName: 'BookMyShow ₹250 Voucher',
      catalogValue: 250,
      customValue: 175,
      effectiveValue: 175,
    });
    expect(distinctAfter[0].overrideId).not.toBeNull();
  });
});
