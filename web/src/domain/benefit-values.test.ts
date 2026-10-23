import { describe, expect, it } from 'vitest';
import {
  bankCardTypes,
  benefitCatalogVersions,
  benefitInstances,
  benefits,
  cardHolders,
  cards,
  systemAdmins,
  workspaces,
} from '@/db/schema';
import { createTestDb } from '@/test/db';
import {
  changeBenefitValue,
  deleteBenefitValueOverride,
  listBenefitValueOverrides,
  listDistinctWorkspaceBenefits,
  upsertBenefitValueOverride,
  ValidationError,
} from './benefit-values';
import { AuthzError, NotFoundError, type Ctx } from '@/lib/context';
import { eq } from 'drizzle-orm';

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

    const [inst1] = await db.insert(benefitInstances).values({
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
    }).returning();

    const [holder2] = await db
      .insert(cardHolders)
      .values({ workspaceId: w2.id, name: 'Holder 2' })
      .returning();

    const [card2] = await db
      .insert(cards)
      .values({
        workspaceId: w2.id,
        holderId: holder2.id,
        bankCardTypeId: cardType.id,
        displayName: 'Card 2',
      })
      .returning();

    const [inst2] = await db.insert(benefitInstances).values({
      workspaceId: w2.id,
      cardId: card2.id,
      bankCardTypeId: cardType.id,
      benefitId: b1.id,
      generatedFromVersion: v1.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-12-31',
      periodLabel: '2026-Q4',
      instanceNumber: 1,
      orderDeadline: '2026-12-31',
    }).returning();

    const superAdminUserId = '00000000-0000-0000-0000-000000000099';
    await db.insert(systemAdmins).values({ userId: superAdminUserId });
    const superCtx: Ctx = {
      userId: superAdminUserId,
      workspaceId: w1.id,
      role: 'admin',
      db,
      today: '2026-10-11',
    };

    return { db, ctx1, ctx2, superCtx, b1, v1, card1, card2, inst1, inst2 };
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

  describe('changeBenefitValue mechanism', () => {
    it('applies valuation to the entire workspace (scope: workspace) with tenant isolation and clears instance overrides', async () => {
      const { db, ctx1, ctx2, inst1, inst2 } = await seed();

      // Give inst1 an instance-specific override
      await db.update(benefitInstances).set({ cashValue: '210.00' }).where(eq(benefitInstances.id, inst1.id));

      // User changes value applied to entire workspace
      const res = await changeBenefitValue(ctx1, {
        benefitName: 'BookMyShow ₹250 Voucher',
        value: 190,
        scope: 'workspace',
        instanceId: inst1.id,
      });

      expect(res).toMatchObject({
        scope: 'workspace',
        value: 190,
        benefitName: 'BookMyShow ₹250 Voucher',
      });

      // 1. Workspace 1 custom valuation is 190
      const list1 = await listBenefitValueOverrides(ctx1);
      expect(list1).toHaveLength(1);
      expect(list1[0].customValue).toBe(190);

      // 2. Instance 1's cashValue was cleared so it inherits the workspace valuation
      const [inst1Row] = await db.select().from(benefitInstances).where(eq(benefitInstances.id, inst1.id));
      expect(inst1Row.cashValue).toBeNull();

      // 3. Distinct benefits in workspace 1 reflect effectiveValue = 190
      const distinct1 = await listDistinctWorkspaceBenefits(ctx1);
      expect(distinct1[0].effectiveValue).toBe(190);

      // 4. Tenant isolation: Workspace 2 has NO overrides and sees catalog default (250)
      const list2 = await listBenefitValueOverrides(ctx2);
      expect(list2).toHaveLength(0);
      const distinct2 = await listDistinctWorkspaceBenefits(ctx2);
      expect(distinct2[0].effectiveValue).toBe(250);
      const [inst2Row] = await db.select().from(benefitInstances).where(eq(benefitInstances.id, inst2.id));
      expect(inst2Row.cashValue).toBeNull();
    });

    it('rejects all_workspaces scope when invoked by non-super-admin', async () => {
      const { ctx1 } = await seed();

      await expect(
        changeBenefitValue(ctx1, {
          benefitName: 'BookMyShow ₹250 Voucher',
          value: 300,
          scope: 'all_workspaces',
        }),
      ).rejects.toBeInstanceOf(AuthzError);
    });

    it('applies to all benefits across all workspaces when invoked by super admin (scope: all_workspaces)', async () => {
      const { db, ctx1, ctx2, superCtx, v1, inst1 } = await seed();

      // Set workspace 1 custom valuation to 180
      await upsertBenefitValueOverride(ctx1, {
        benefitName: 'BookMyShow ₹250 Voucher',
        customValue: 180,
      });

      // Super admin changes value globally to 350
      const res = await changeBenefitValue(superCtx, {
        benefitName: 'BookMyShow ₹250 Voucher',
        value: 350,
        scope: 'all_workspaces',
        versionId: v1.id,
        instanceId: inst1.id,
      });

      expect(res).toMatchObject({
        scope: 'all_workspaces',
        value: 350,
        benefitName: 'BookMyShow ₹250 Voucher',
      });

      // 1. Catalog version default cash value is updated in database
      const [v1Row] = await db.select().from(benefitCatalogVersions).where(eq(benefitCatalogVersions.id, v1.id));
      expect(Number(v1Row.defaultCashValue)).toBe(350);

      // 2. Conflicting workspace overrides were purged so all workspaces use the new catalog valuation
      const ws1Overrides = await listBenefitValueOverrides(ctx1);
      expect(ws1Overrides).toHaveLength(0);

      // 3. Both workspace 1 and workspace 2 now evaluate this benefit to 350!
      const distinct1 = await listDistinctWorkspaceBenefits(ctx1);
      expect(distinct1[0].effectiveValue).toBe(350);
      expect(distinct1[0].catalogValue).toBe(350);

      const distinct2 = await listDistinctWorkspaceBenefits(ctx2);
      expect(distinct2[0].effectiveValue).toBe(350);
      expect(distinct2[0].catalogValue).toBe(350);
    });

    it('updates single instance cash_value (scope: instance)', async () => {
      const { db, ctx1, inst1 } = await seed();

      const res = await changeBenefitValue(ctx1, {
        benefitName: 'BookMyShow ₹250 Voucher',
        value: 220,
        scope: 'instance',
        instanceId: inst1.id,
      });

      expect(res).toMatchObject({
        scope: 'instance',
        value: 220,
        benefitName: 'BookMyShow ₹250 Voucher',
        affectedCount: 1,
      });

      const [inst1Row] = await db.select().from(benefitInstances).where(eq(benefitInstances.id, inst1.id));
      expect(Number(inst1Row.cashValue)).toBe(220);

      // Missing instanceId fails with ValidationError
      await expect(
        changeBenefitValue(ctx1, {
          benefitName: 'BookMyShow ₹250 Voucher',
          value: 220,
          scope: 'instance',
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });
});
