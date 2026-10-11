import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDb } from '@/test/db';
import type { Database, Ctx } from '@/lib/context';
import * as schema from '@/db/schema';
import {
  listOrderingQueue,
  populateAndSortQueue,
  updateQueueItem,
  moveQueueItem,
} from './ordering-queue';

describe('ordering-queue domain', () => {
  let db: Database;
  let close: () => Promise<void>;
  const W_A = '11111111-1111-4111-8111-111111111111';
  const W_B = '22222222-2222-4222-8222-222222222222';
  const TODAY = '2026-10-12';

  const ctxA: Ctx = {
    userId: 'user-a',
    workspaceId: W_A,
    role: 'owner',
    db: null as unknown as Database,
    today: TODAY,
  };

  const ctxB: Ctx = {
    userId: 'user-b',
    workspaceId: W_B,
    role: 'owner',
    db: null as unknown as Database,
    today: TODAY,
  };

  beforeAll(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    close = testDb.close;
    ctxA.db = db;
    ctxB.db = db;

    // Seed workspaces
    await db.insert(schema.workspaces).values([
      { id: W_A, name: 'Workspace A' },
      { id: W_B, name: 'Workspace B' },
    ]);

    // Seed holder
    const [holderA] = await db.insert(schema.cardHolders).values({
      workspaceId: W_A,
      name: 'Holder A',
    }).returning();

    // Seed bank card type
    const [cardType] = await db.insert(schema.bankCardTypes).values({
      bankName: 'PNB',
      cardType: 'Salary Imperial',
      displayName: 'PNB Salary Imperial',
    }).returning();

    // Seed card in A
    const [cardA] = await db.insert(schema.cards).values({
      workspaceId: W_A,
      holderId: holderA.id,
      bankCardTypeId: cardType.id,
      displayName: 'My PNB Card',
      lastDigits: '1746',
      active: true,
    }).returning();

    // Seed portal account and mapping
    const [accountA] = await db.insert(schema.portalAccounts).values({
      workspaceId: W_A,
      label: 'user@example.com',
      credentialsEncrypted: 'mock_encrypted_creds',
      status: 'connected',
    }).returning();

    await db.insert(schema.portalCardMappings).values({
      workspaceId: W_A,
      portalAccountId: accountA.id,
      cardId: cardA.id,
      active: true,
    });

    // Seed base benefits
    const [b1] = await db.insert(schema.benefits).values({ bankCardTypeId: cardType.id }).returning();
    const [b2] = await db.insert(schema.benefits).values({ bankCardTypeId: cardType.id }).returning();
    const [bCab] = await db.insert(schema.benefits).values({ bankCardTypeId: cardType.id }).returning();
    const [bDiscount] = await db.insert(schema.benefits).values({ bankCardTypeId: cardType.id }).returning();

    // Seed catalog versions:
    // Version 1: Cult.fit 3 Month (Voucher, expires 2026-10-31, cash value 999)
    const [v1] = await db.insert(schema.benefitCatalogVersions).values({
      benefitId: b1.id,
      benefitType: 'Gym Access',
      benefitProvider: 'Cult.fit',
      exactBenefit: '3 Month Subscription',
      frequency: 'Quarterly',
      defaultCashValue: '999.00',
      offerKind: 'voucher',
      effectiveFrom: '2026-01-01',
    }).returning();

    // Version 2: Swiggy One (Voucher, expires 2026-10-20, cash value 250 - sooner deadline!)
    const [v2] = await db.insert(schema.benefitCatalogVersions).values({
      benefitId: b2.id,
      benefitType: 'Food Delivery',
      benefitProvider: 'Swiggy',
      exactBenefit: 'Swiggy One 3 Month',
      frequency: 'Quarterly',
      defaultCashValue: '250.00',
      offerKind: 'voucher',
      effectiveFrom: '2026-01-01',
    }).returning();

    // Version 3: Cab Services (Uber INR 100 - Voucher!)
    const [vCab] = await db.insert(schema.benefitCatalogVersions).values({
      benefitId: bCab.id,
      benefitType: 'Cab Services',
      benefitProvider: 'Uber',
      exactBenefit: 'Redeemable Coupon - INR 100',
      frequency: 'Monthly',
      defaultCashValue: '100.00',
      offerKind: 'voucher',
      effectiveFrom: '2026-01-01',
    }).returning();

    // Version 4: BookMyShow (Discount - MUST BE EXCLUDED!)
    const [vDiscount] = await db.insert(schema.benefitCatalogVersions).values({
      benefitId: bDiscount.id,
      benefitType: 'Entertainment',
      benefitProvider: 'BookMyShow',
      exactBenefit: 'Flat Rs. 250 Discount on Tickets',
      frequency: 'Quarterly',
      defaultCashValue: '250.00',
      offerKind: 'discount',
      effectiveFrom: '2026-01-01',
    }).returning();

    // Create instances for Card A
    await db.insert(schema.benefitInstances).values([
      // Instance 1: Cult.fit (Deadline 2026-10-31, Value 999)
      {
        workspaceId: W_A,
        cardId: cardA.id,
        bankCardTypeId: cardType.id,
        benefitId: b1.id,
        generatedFromVersion: v1.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-12-31',
        periodLabel: 'Q4 2026',
        orderDeadline: '2026-10-31',
        cashValue: '999.00',
        orderStatus: 'Not Ordered',
      },
      // Instance 2: Swiggy (Deadline 2026-10-20, Value 250 - Nearest Expiry!)
      {
        workspaceId: W_A,
        cardId: cardA.id,
        bankCardTypeId: cardType.id,
        benefitId: b2.id,
        generatedFromVersion: v2.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-12-31',
        periodLabel: 'Q4 2026',
        orderDeadline: '2026-10-20',
        cashValue: '250.00',
        orderStatus: 'Not Ordered',
      },
      // Instance 3: Cab Services (Deadline 2026-10-31, Value 100)
      {
        workspaceId: W_A,
        cardId: cardA.id,
        bankCardTypeId: cardType.id,
        benefitId: bCab.id,
        generatedFromVersion: vCab.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        periodLabel: 'Oct 2026',
        orderDeadline: '2026-10-31',
        cashValue: '100.00',
        orderStatus: 'Not Ordered',
      },
      // Instance 4: BookMyShow (Deadline 2026-10-15, Value 250 - Discount, should be EXCLUDED)
      {
        workspaceId: W_A,
        cardId: cardA.id,
        bankCardTypeId: cardType.id,
        benefitId: bDiscount.id,
        generatedFromVersion: vDiscount.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-12-31',
        periodLabel: 'Q4 2026',
        orderDeadline: '2026-10-15',
        cashValue: '250.00',
        orderStatus: 'Not Ordered',
      },
    ]);
  });

  afterAll(async () => {
    await close();
  });

  it('lists eligible vouchers and excludes discounts', async () => {
    const queue = await listOrderingQueue(ctxA);

    // BookMyShow should be excluded! Only Cult.fit, Swiggy, and Cab Services included (3 items)
    expect(queue.length).toBe(3);

    const names = queue.map((q) => q.benefitProvider);
    expect(names).toContain('Swiggy');
    expect(names).toContain('Cult.fit');
    expect(names).toContain('Uber');
    expect(names).not.toContain('BookMyShow');
  });

  it('orders by nearest expiring first, then highest value by default', async () => {
    const queue = await listOrderingQueue(ctxA);

    // 1. Swiggy expires 2026-10-20 -> must be Position 1!
    expect(queue[0].benefitProvider).toBe('Swiggy');
    expect(queue[0].position).toBe(1);

    // 2. Both Cult.fit and Uber expire 2026-10-31.
    // Cult.fit value (999) > Uber value (100) -> Cult.fit must be Position 2, Uber Position 3!
    expect(queue[1].benefitProvider).toBe('Cult.fit');
    expect(queue[1].position).toBe(2);

    expect(queue[2].benefitProvider).toBe('Uber');
    expect(queue[2].position).toBe(3);
  });

  it('supports populating with highest_value strategy', async () => {
    const queue = await populateAndSortQueue(ctxA, 'highest_value');

    // Cult.fit (999) -> Position 1
    expect(queue[0].benefitProvider).toBe('Cult.fit');
    expect(queue[0].position).toBe(1);

    // Swiggy (250) -> Position 2
    expect(queue[1].benefitProvider).toBe('Swiggy');
    expect(queue[1].position).toBe(2);

    // Uber (100) -> Position 3
    expect(queue[2].benefitProvider).toBe('Uber');
    expect(queue[2].position).toBe(3);
  });

  it('allows moving an item up and down in queue', async () => {
    // Current order: Cult.fit (1), Swiggy (2), Uber (3)
    const swiggyItem = (await listOrderingQueue(ctxA)).find((q) => q.benefitProvider === 'Swiggy')!;

    // Move Swiggy Up (should become Position 1)
    const afterUp = await moveQueueItem(ctxA, swiggyItem.instanceId, 'up');
    expect(afterUp[0].benefitProvider).toBe('Swiggy');
    expect(afterUp[1].benefitProvider).toBe('Cult.fit');

    // Move Swiggy Down
    const afterDown = await moveQueueItem(ctxA, swiggyItem.instanceId, 'down');
    expect(afterDown[0].benefitProvider).toBe('Cult.fit');
    expect(afterDown[1].benefitProvider).toBe('Swiggy');
  });

  it('allows toggling enabled on queue items', async () => {
    const queue = await listOrderingQueue(ctxA);
    const item = queue[0];

    await updateQueueItem(ctxA, { instanceId: item.instanceId, enabled: false });

    const updated = await listOrderingQueue(ctxA);
    const found = updated.find((q) => q.instanceId === item.instanceId);
    expect(found?.enabled).toBe(false);
  });

  it('enforces tenant isolation (workspace B cannot see workspace A items)', async () => {
    const queueB = await listOrderingQueue(ctxB);
    expect(queueB).toHaveLength(0);
  });
});
