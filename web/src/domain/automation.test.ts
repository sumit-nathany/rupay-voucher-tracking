import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/test/db';
import {
  workspaces,
  cardHolders,
  cards,
  bankCardTypes,
  benefits,
  benefitCatalogVersions,
  benefitInstances,
  portalOrderAttempts,
  orderingRules,
  orderingQueueItems,
} from '@/db/schema';
import type { Database, Ctx } from '@/lib/context';
import {
  getAutomationSettings,
  saveAutomationSettings,
  createPortalAccount,
  listPortalAccounts,
  updatePortalAccount,
  pausePortalAccount,
  resumePortalAccount,
  deletePortalAccount,
  savePortalCardMapping,
  listPortalCardMappings,
  setCardPortalAccounts,
  createOrderingRule,
  findCandidatesForAccount,
} from './automation';

describe('automation domain', () => {
  let db: Database;
  let close: () => Promise<void>;
  let ctx: Ctx;
  const workspaceId = '11111111-1111-4111-a111-111111111111';
  const today = '2026-10-15';
  const origKey = process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY;

  beforeEach(async () => {
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    await db.insert(workspaces).values({ id: workspaceId, name: 'Workspace A' });
    ctx = {
      userId: 'user_1',
      workspaceId,
      role: 'admin',
      db,
      today,
    };
  });

  afterEach(async () => {
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = origKey;
    await close();
  });

  it('manages automation settings', async () => {
    const s1 = await getAutomationSettings(ctx);
    expect(s1.enabled).toBe(false);

    const s2 = await saveAutomationSettings(ctx, { enabled: true });
    expect(s2.enabled).toBe(true);

    const s3 = await getAutomationSettings(ctx);
    expect(s3.enabled).toBe(true);
  });

  it('manages portal accounts securely without exposing credentials', async () => {
    const acc = await createPortalAccount(ctx, {
      label: 'Main RuPay Account',
      credentials: { loginId: 'my_login', password: 'my_password' },
    });

    expect(acc.label).toBe('Main RuPay Account');
    expect(acc.hasCredentials).toBe(true);
    expect(acc.status).toBe('connected');

    const list = await listPortalAccounts(ctx);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(acc.id);
    expect('credentialsEncrypted' in list[0]).toBe(false);

    await pausePortalAccount(ctx, acc.id);
    expect((await listPortalAccounts(ctx))[0].status).toBe('paused');

    await resumePortalAccount(ctx, acc.id);
    expect((await listPortalAccounts(ctx))[0].status).toBe('connected');

    await updatePortalAccount(ctx, { id: acc.id, label: 'Renamed Account' });
    expect((await listPortalAccounts(ctx))[0].label).toBe('Renamed Account');

    await deletePortalAccount(ctx, acc.id);
    expect((await listPortalAccounts(ctx)).length).toBe(0);
  });

  it('nominates eligible candidates based on rule priority, filters, and 24h limit', async () => {
    await saveAutomationSettings(ctx, { enabled: true });

    // Setup portal account
    const acc = await createPortalAccount(ctx, {
      label: 'Primary Account',
      credentials: { loginId: 'user1', password: 'pwd' },
    });

    // Setup holder, card type, and 2 cards
    const [holder] = await db.insert(cardHolders).values({ workspaceId, name: 'John Doe' }).returning();
    const [cardType] = await db.insert(bankCardTypes).values({ displayName: 'PNB Select Card', bankName: 'PNB' }).returning();
    const [card1] = await db.insert(cards).values({ workspaceId, holderId: holder.id, bankCardTypeId: cardType.id, displayName: 'Card 1', lastDigits: '1111' }).returning();
    const [card2] = await db.insert(cards).values({ workspaceId, holderId: holder.id, bankCardTypeId: cardType.id, displayName: 'Card 2', lastDigits: '2222' }).returning();

    // Map card 1 and card 2 to portal account
    await savePortalCardMapping(ctx, {
      portalAccountId: acc.id,
      cardId: card1.id,
      portalCardId: '151',
      portalCardbinId: '208',
    });
    await savePortalCardMapping(ctx, {
      portalAccountId: acc.id,
      cardId: card2.id,
      portalCardId: '151',
      portalCardbinId: '208',
    });

    // Create 2 benefits
    const [ben1] = await db.insert(benefits).values({ bankCardTypeId: cardType.id, benefitType: 'Spa Services' }).returning();
    const [ben2] = await db.insert(benefits).values({ bankCardTypeId: cardType.id, benefitType: 'BookMyShow' }).returning();

    // Create versions for benefits
    const [v1] = await db.insert(benefitCatalogVersions).values({
      benefitId: ben1.id,
      benefitType: 'Spa Services',
      exactBenefit: 'Spa 60min',
      effectiveFrom: '2026-01-01',
      frequency: 'Quarterly',
      instanceCount: 1,
    }).returning();
    const [v2] = await db.insert(benefitCatalogVersions).values({
      benefitId: ben2.id,
      benefitType: 'BookMyShow',
      exactBenefit: 'Rs 250 off',
      effectiveFrom: '2026-01-01',
      frequency: 'Quarterly',
      instanceCount: 1,
    }).returning();

    // Instance 1 for card1, ben1 (Spa, deadline: 2026-10-31)
    const [inst1] = await db.insert(benefitInstances).values({
      workspaceId,
      cardId: card1.id,
      benefitId: ben1.id,
      bankCardTypeId: cardType.id,
      generatedFromVersion: v1.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-12-31',
      periodLabel: 'Q4 2026',
      instanceNumber: 1,
      orderDeadline: '2026-10-31',
      orderStatus: 'Not Ordered',
    }).returning();

    // Instance 2 for card2, ben2 (BookMyShow, deadline: 2026-10-20)
    const [inst2] = await db.insert(benefitInstances).values({
      workspaceId,
      cardId: card2.id,
      benefitId: ben2.id,
      bankCardTypeId: cardType.id,
      generatedFromVersion: v2.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-12-31',
      periodLabel: 'Q4 2026',
      instanceNumber: 1,
      orderDeadline: '2026-10-20',
      orderStatus: 'Not Ordered',
    }).returning();

    // Without enabled rules, no candidate is nominated
    let cand = await findCandidatesForAccount(db, acc.id, today);
    expect(cand).toBeNull();

    // Create Rule A (priority 10) matching BMS (ben2)
    const ruleA = await createOrderingRule(ctx, {
      portalAccountId: acc.id,
      name: 'Order BMS',
      priority: 10,
      benefitIds: [ben2.id],
    });

    // Create Rule B (priority 5 - higher priority!) matching Spa (ben1)
    const ruleB = await createOrderingRule(ctx, {
      portalAccountId: acc.id,
      name: 'Order Spa first',
      priority: 5,
      benefitIds: [ben1.id],
    });

    // Priority 5 wins even though BMS deadline is earlier!
    cand = await findCandidatesForAccount(db, acc.id, today);
    expect(cand).not.toBeNull();
    expect(cand?.instanceId).toBe(inst1.id);
    expect(cand?.ruleId).toBe(ruleB.id);

    // Disable Rule B -> Rule A should win
    await createOrderingRule(ctx, {
      portalAccountId: acc.id,
      name: 'Temp rule',
    }); // just to verify create
    await db.update(orderingRules).set({ enabled: false }).where(eq(orderingRules.id, ruleB.id));

    cand = await findCandidatesForAccount(db, acc.id, today);
    expect(cand).not.toBeNull();
    expect(cand?.instanceId).toBe(inst2.id);
    expect(cand?.ruleId).toBe(ruleA.id);

    // If account has confirmed order in past 24 hours -> no candidate nominated
    await db.insert(portalOrderAttempts).values({
      workspaceId,
      portalAccountId: acc.id,
      instanceId: inst1.id,
      state: 'confirmed',
      submissionStartedAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      finishedAt: new Date(),
    });

    cand = await findCandidatesForAccount(db, acc.id, today);
    expect(cand).toBeNull();
  });

  it('nominates candidate from ordering_queue_items according to queue position', async () => {
    await saveAutomationSettings(ctx, { enabled: true });

    const [holder] = await db.insert(cardHolders).values({ workspaceId, name: 'Holder 1' }).returning();
    const [cardType] = await db.insert(bankCardTypes).values({ bankName: 'HDFC', cardType: 'Millennia', displayName: 'HDFC Millennia' }).returning();
    const [c1] = await db.insert(cards).values({ workspaceId, holderId: holder.id, bankCardTypeId: cardType.id, lastDigits: '1111', displayName: 'Card 1', active: true }).returning();

    const acc = await createPortalAccount(ctx, {
      label: 'acc@test.com',
      credentials: { loginId: 'acc@test.com', password: 'pwd' },
    });
    await savePortalCardMapping(ctx, {
      portalAccountId: acc.id,
      cardId: c1.id,
      portalCardId: 'pc-1',
      portalCardbinId: 'bin-1',
    });

    const [b1] = await db.insert(benefits).values({ bankCardTypeId: cardType.id }).returning();
    const [b2] = await db.insert(benefits).values({ bankCardTypeId: cardType.id }).returning();

    const [v1] = await db.insert(benefitCatalogVersions).values({
      benefitId: b1.id,
      benefitType: 'Spa',
      benefitProvider: 'O2',
      exactBenefit: 'Spa Session',
      frequency: 'Quarterly',
      effectiveFrom: '2026-01-01',
    }).returning();

    const [v2] = await db.insert(benefitCatalogVersions).values({
      benefitId: b2.id,
      benefitType: 'Swiggy',
      benefitProvider: 'Swiggy',
      exactBenefit: 'Swiggy Voucher',
      frequency: 'Monthly',
      effectiveFrom: '2026-01-01',
    }).returning();

    const [inst1] = await db.insert(benefitInstances).values({
      workspaceId,
      cardId: c1.id,
      benefitId: b1.id,
      bankCardTypeId: cardType.id,
      generatedFromVersion: v1.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-12-31',
      periodLabel: 'Q4 2026',
      orderDeadline: '2026-10-31',
      orderStatus: 'Not Ordered',
    }).returning();

    const [inst2] = await db.insert(benefitInstances).values({
      workspaceId,
      cardId: c1.id,
      benefitId: b2.id,
      bankCardTypeId: cardType.id,
      generatedFromVersion: v2.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      periodLabel: 'Oct 2026',
      orderDeadline: '2026-10-31',
      orderStatus: 'Not Ordered',
    }).returning();

    // Insert queue items: inst2 is position 0 (first), inst1 is position 1 (second)
    await db.insert(orderingQueueItems).values([
      { workspaceId, instanceId: inst2.id, position: 0, enabled: true },
      { workspaceId, instanceId: inst1.id, position: 1, enabled: true },
    ]);

    // Position 0 (inst2) should be picked
    let cand = await findCandidatesForAccount(db, acc.id, today);
    expect(cand).not.toBeNull();
    expect(cand?.instanceId).toBe(inst2.id);
    expect(cand?.rulePriority).toBe(0);

    // Disable inst2 in the queue -> inst1 should now be picked
    await db.update(orderingQueueItems).set({ enabled: false }).where(eq(orderingQueueItems.instanceId, inst2.id));
    cand = await findCandidatesForAccount(db, acc.id, today);
    expect(cand).not.toBeNull();
    expect(cand?.instanceId).toBe(inst1.id);
    expect(cand?.rulePriority).toBe(1);
  });

  it('allows mapping the same card to multiple portal accounts and inherits/syncs payment details', async () => {
    // 1. Create two portal accounts
    const acc1 = await createPortalAccount(ctx, {
      label: 'Account 1',
      credentials: {
        loginId: 'user1@test.com',
        password: 'password123',
      },
    });

    const acc2 = await createPortalAccount(ctx, {
      label: 'Account 2',
      credentials: {
        loginId: 'user2@test.com',
        password: 'password123',
      },
    });

    // 2. Create card holder and card
    const [holder] = await db.insert(cardHolders).values({ workspaceId, name: 'Amit' }).returning();
    const [cardType] = await db.insert(bankCardTypes).values({ displayName: 'PNB Select Card', bankName: 'PNB' }).returning();
    const [card] = await db.insert(cards).values({ workspaceId, holderId: holder.id, bankCardTypeId: cardType.id, displayName: 'My RuPay Card', lastDigits: '1746' }).returning();

    // 3. Map card to Account 1 WITH payment details (CVV 254)
    await savePortalCardMapping(ctx, {
      portalAccountId: acc1.id,
      cardId: card.id,
      paymentDetails: {
        version: 1,
        mode: 'saved_card',
        cvv: '254',
      },
    });

    // 4. Map the SAME card to Account 2 WITHOUT providing payment details
    await savePortalCardMapping(ctx, {
      portalAccountId: acc2.id,
      cardId: card.id,
    });

    // 5. Verify both mappings exist
    const mappingsAcc1 = await listPortalCardMappings(ctx, acc1.id);
    const mappingsAcc2 = await listPortalCardMappings(ctx, acc2.id);

    expect(mappingsAcc1.length).toBe(1);
    expect(mappingsAcc2.length).toBe(1);
    expect(mappingsAcc1[0].cardId).toBe(card.id);
    expect(mappingsAcc2[0].cardId).toBe(card.id);

    // 6. Verify payment details are automatically inherited on Account 2!
    expect(mappingsAcc2[0].paymentDetails).not.toBeNull();
    expect(mappingsAcc2[0].paymentDetails?.mode).toBe('saved_card');
    expect(mappingsAcc2[0].paymentDetails?.hasCvv).toBe(true);

    // 7. Verify updating payment details on Account 1 synchronizes to Account 2
    await savePortalCardMapping(ctx, {
      id: mappingsAcc1[0].id,
      portalAccountId: acc1.id,
      cardId: card.id,
      paymentDetails: {
        version: 1,
        mode: 'saved_card',
        cvv: '999',
      },
    });

    const refreshedAcc2 = await listPortalCardMappings(ctx, acc2.id);
    expect(refreshedAcc2[0].paymentDetails?.hasCvv).toBe(true);
  });

  it('sets and updates portal account assignments for a card', async () => {
    const acc1 = await createPortalAccount(ctx, {
      label: 'Acc 1',
      credentials: { loginId: 'u1@test.com', password: 'p1' },
    });
    const acc2 = await createPortalAccount(ctx, {
      label: 'Acc 2',
      credentials: { loginId: 'u2@test.com', password: 'p2' },
    });
    const acc3 = await createPortalAccount(ctx, {
      label: 'Acc 3',
      credentials: { loginId: 'u3@test.com', password: 'p3' },
    });

    const [holder] = await db.insert(cardHolders).values({ workspaceId, name: 'Holder 1' }).returning();
    const [cardType] = await db.insert(bankCardTypes).values({ displayName: 'Bank Card', bankName: 'Bank' }).returning();
    const [card] = await db.insert(cards).values({
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      displayName: 'Card 1',
      lastDigits: '4321',
    }).returning();

    // Assign to Acc 1 and Acc 2
    await setCardPortalAccounts(ctx, {
      cardId: card.id,
      portalAccountIds: [acc1.id, acc2.id],
    });

    const mappings1 = await listPortalCardMappings(ctx);
    expect(mappings1.filter((m) => m.cardId === card.id).map((m) => m.portalAccountId).sort()).toEqual(
      [acc1.id, acc2.id].sort(),
    );

    // Update assignment to Acc 2 and Acc 3 (Acc 1 removed, Acc 3 added)
    await setCardPortalAccounts(ctx, {
      cardId: card.id,
      portalAccountIds: [acc2.id, acc3.id],
    });

    const mappings2 = await listPortalCardMappings(ctx);
    expect(mappings2.filter((m) => m.cardId === card.id).map((m) => m.portalAccountId).sort()).toEqual(
      [acc2.id, acc3.id].sort(),
    );

    // Unassign from all
    await setCardPortalAccounts(ctx, {
      cardId: card.id,
      portalAccountIds: [],
    });

    const mappings3 = await listPortalCardMappings(ctx);
    expect(mappings3.filter((m) => m.cardId === card.id).length).toBe(0);
  });
});
