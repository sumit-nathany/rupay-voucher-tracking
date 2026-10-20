import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/test/db';
import type { Database, Ctx } from '@/lib/context';
import * as schema from '@/db/schema';
import { encryptPaymentDetails } from '@/lib/card-payment-details';
import {
  listOrderingQueue,
  populateAndSortQueue,
  updateQueueItem,
  moveQueueItem,
  moveQueueItemToTop,
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

  const origKey = process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
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
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = origKey;
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

  it('allows moving any item to top of the global queue', async () => {
    // Current order: Cult.fit (1), Swiggy (2), Uber (3)
    const uberItem = (await listOrderingQueue(ctxA)).find((q) => q.benefitProvider === 'Uber')!;
    expect(uberItem.position).toBe(3);

    // Promote Uber to Top
    const afterTop = await moveQueueItemToTop(ctxA, uberItem.instanceId);
    expect(afterTop[0].benefitProvider).toBe('Uber');
    expect(afterTop[0].position).toBe(1);
    expect(afterTop[1].benefitProvider).toBe('Cult.fit');
    expect(afterTop[1].position).toBe(2);
    expect(afterTop[2].benefitProvider).toBe('Swiggy');
    expect(afterTop[2].position).toBe(3);
  });

  it('allows toggling enabled on queue items', async () => {
    const queue = await listOrderingQueue(ctxA);
    const item = queue[0];

    await updateQueueItem(ctxA, { instanceId: item.instanceId, enabled: false });

    const updated = await listOrderingQueue(ctxA);
    const found = updated.find((q) => q.instanceId === item.instanceId);
    expect(found?.enabled).toBe(false);
  });

  it('allows filtering queue by cardId and portalAccountId', async () => {
    // We have cardA in ctxA
    const queueAll = await listOrderingQueue(ctxA);
    expect(queueAll.length).toBeGreaterThan(0);

    const cardId = queueAll[0].cardId;
    const queueCard = await listOrderingQueue(ctxA, { cardId });
    expect(queueCard).toHaveLength(queueAll.length);

    // Non-existent card ID returns empty
    const queueNonExistent = await listOrderingQueue(ctxA, { cardId: '00000000-0000-0000-0000-000000000000' });
    expect(queueNonExistent).toHaveLength(0);

    // Filter by portal account ID
    const portalAccountId = queueAll[0].portalAccountId!;
    expect(portalAccountId).toBeDefined();
    const queueAccount = await listOrderingQueue(ctxA, { portalAccountId });
    expect(queueAccount.length).toBeGreaterThan(0);
  });

  it('allows picking a chosenOptionId for a category benefit and persists it', async () => {
    const queue = await listOrderingQueue(ctxA);
    const item = queue[0];

    // Insert a valid option for the instance's version
    const [opt] = await db.insert(schema.benefitOptions).values({
      versionId: '11111111-1111-4111-8111-111111111111', // will get from db
      provider: 'Cult.fit',
      offerName: 'Cult.fit Pro Pass',
      cashValue: '999.00',
    }).returning().catch(async () => {
      // Find an existing version
      const [v] = await db.select().from(schema.benefitCatalogVersions).limit(1);
      return db.insert(schema.benefitOptions).values({
        versionId: v.id,
        provider: 'Cult.fit',
        offerName: 'Cult.fit Pro Pass',
        cashValue: '999.00',
      }).returning();
    });

    await updateQueueItem(ctxA, { instanceId: item.instanceId, chosenOptionId: opt.id });

    const updated = await listOrderingQueue(ctxA);
    const found = updated.find((q) => q.instanceId === item.instanceId);
    expect(found?.chosenOptionId).toBe(opt.id);
  });

  it('enforces tenant isolation (workspace B cannot see workspace A items)', async () => {
    const queueB = await listOrderingQueue(ctxB);
    expect(queueB).toHaveLength(0);
  });

  it('automatically populates newly created instances into the queue while preserving manual order', async () => {
    // 1. Reorder existing queue: move Uber to Position 1
    const current = await listOrderingQueue(ctxA);
    const uber = current.find((q) => q.benefitProvider === 'Uber')!;
    const otherIds = current.filter((q) => q.instanceId !== uber.instanceId).map((q) => q.instanceId);
    
    // Explicit reorder: Uber at #1, followed by others
    const { reorderQueue } = await import('./ordering-queue');
    await reorderQueue(ctxA, [uber.instanceId, ...otherIds]);

    const reordered = await listOrderingQueue(ctxA);
    expect(reordered[0].benefitProvider).toBe('Uber');
    expect(reordered[0].position).toBe(1);

    // 2. Insert a brand new voucher benefit version and instance
    const [card] = await db.select().from(schema.cards).where(eq(schema.cards.workspaceId, W_A)).limit(1);
    const [newBen] = await db.insert(schema.benefits).values({ bankCardTypeId: card.bankCardTypeId }).returning();
    const [newVer] = await db.insert(schema.benefitCatalogVersions).values({
      benefitId: newBen.id,
      benefitType: 'OTT Subscription',
      benefitProvider: 'SonyLIV',
      exactBenefit: 'SonyLIV Premium 12 Month',
      frequency: 'Annual',
      defaultCashValue: '699.00',
      offerKind: 'voucher',
      effectiveFrom: '2026-01-01',
    }).returning();

    const [newInst] = await db.insert(schema.benefitInstances).values({
      workspaceId: W_A,
      cardId: card.id,
      bankCardTypeId: card.bankCardTypeId,
      benefitId: newBen.id,
      generatedFromVersion: newVer.id,
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      periodLabel: '2026',
      orderDeadline: '2026-12-31',
      cashValue: '699.00',
      orderStatus: 'Not Ordered',
    }).returning();

    // 3. Calling listOrderingQueue must automatically discover and append SonyLIV at the end
    const withNew = await listOrderingQueue(ctxA);
    expect(withNew.length).toBe(current.length + 1);

    // Uber must REMAIN at Position 1! (User custom reordering preserved)
    expect(withNew[0].benefitProvider).toBe('Uber');
    expect(withNew[0].position).toBe(1);

    // SonyLIV must be appended at the end
    const sonyliv = withNew.find((q) => q.benefitProvider === 'SonyLIV');
    expect(sonyliv).toBeDefined();
    expect(sonyliv?.position).toBe(withNew.length);

    // Check DB directly to ensure ordering_queue_items has SonyLIV persisted
    const [dbRow] = await db
      .select()
      .from(schema.orderingQueueItems)
      .where(eq(schema.orderingQueueItems.instanceId, newInst.id));
    expect(dbRow).toBeDefined();
    expect(dbRow.position).toBe(withNew.length);
  });

  it('suggests RuPay accounts for each benefit, flagging conflicts, ready accounts, and unmapped accounts', async () => {
    // 1. Create a second portal account in Workspace A
    const [account2] = await db.insert(schema.portalAccounts).values({
      workspaceId: W_A,
      label: 'account2@example.com',
      credentialsEncrypted: 'mock_encrypted_creds',
      status: 'connected',
    }).returning();

    // 2. Create a third portal account (not mapped to any card)
    const [account3] = await db.insert(schema.portalAccounts).values({
      workspaceId: W_A,
      label: 'account3@example.com',
      credentialsEncrypted: 'mock_encrypted_creds',
      status: 'connected',
    }).returning();

    // Map Card A to account2 as well
    const [cardA] = await db
      .select()
      .from(schema.cards)
      .where(eq(schema.cards.workspaceId, W_A))
      .limit(1);

    // Provide valid payment details on Card A
    await db
      .update(schema.cards)
      .set({
        paymentDetailsEncrypted: encryptPaymentDetails(
          { version: 1, mode: 'saved_card', cvv: '123' },
          cardA.id,
        ),
      })
      .where(eq(schema.cards.id, cardA.id));

    await db.insert(schema.portalCardMappings).values({
      workspaceId: W_A,
      portalAccountId: account2.id,
      cardId: cardA.id,
      active: true,
    });

    // 3. Mark an order attempt on account2 for the Cult.fit benefit in 2026 (entitlement conflict)
    const queue = await listOrderingQueue(ctxA);
    const cultfit = queue.find((q) => q.benefitProvider === 'Cult.fit');
    expect(cultfit).toBeDefined();

    await db.insert(schema.portalOrderAttempts).values({
      workspaceId: W_A,
      portalAccountId: account2.id,
      instanceId: cultfit!.instanceId,
      state: 'confirmed',
      bookingReference: 'CONF-CULTFIT-ACC2',
    });

    // 4. Query ordering queue again
    const refreshed = await listOrderingQueue(ctxA);
    const cultfitItem = refreshed.find((q) => q.benefitProvider === 'Cult.fit');
    expect(cultfitItem).toBeDefined();

    // 5. Inspect suggestedAccounts on the Cult.fit item
    const suggestions = cultfitItem!.suggestedAccounts;
    expect(suggestions).toBeDefined();
    expect(suggestions.length).toBeGreaterThanOrEqual(3);

    // Account 1: mapped, connected, no conflict -> status: 'ready', isRecommended: true
    const s1 = suggestions.find((s) => s.accountLabel === 'user@example.com');
    expect(s1).toBeDefined();
    expect(s1?.status).toBe('ready');
    expect(s1?.isMapped).toBe(true);
    expect(s1?.isEligible).toBe(true);
    expect(s1?.isRecommended).toBe(true);

    // Account 2: mapped, but already redeemed in this period -> status: 'conflict', isEligible: false
    const s2 = suggestions.find((s) => s.accountLabel === 'account2@example.com');
    expect(s2).toBeDefined();
    expect(s2?.status).toBe('conflict');
    expect(s2?.isMapped).toBe(true);
    expect(s2?.isEligible).toBe(false);

    // Account 3: not mapped to card -> status: 'available_to_map', isEligible: false
    const s3 = suggestions.find((s) => s.accountLabel === 'account3@example.com');
    expect(s3).toBeDefined();
    expect(s3?.accountId).toBe(account3.id);
    expect(s3?.status).toBe('available_to_map');
    expect(s3?.isMapped).toBe(false);
  });
});
