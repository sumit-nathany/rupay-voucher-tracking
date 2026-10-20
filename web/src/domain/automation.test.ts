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
  portalCardMappings,
  portalAccounts,
  automationSettings,
  cardVariants,
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
  setPortalAccountCards,
  createOrderingRule,
  findCandidatesForAccount,
  findCandidateFromGlobalQueue,
  getPortalStatusExplanation,
  getPortalStatusResolution,
} from './automation';
import { encryptPaymentDetails } from '@/lib/card-payment-details';

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

    // Set account to needs_attention with conflict detail code
    await db
      .update(portalAccounts)
      .set({ status: 'needs_attention', statusDetailCode: 'tracker_reference_conflict' })
      .where(eq(portalAccounts.id, acc.id));

    const attentionAcc = (await listPortalAccounts(ctx))[0];
    expect(attentionAcc.status).toBe('needs_attention');
    expect(attentionAcc.statusDetailCode).toBe('tracker_reference_conflict');

    // Resuming/reconnecting clears statusDetailCode and resets status to connected
    await resumePortalAccount(ctx, acc.id);
    const resumedAcc = (await listPortalAccounts(ctx))[0];
    expect(resumedAcc.status).toBe('connected');
    expect(resumedAcc.statusDetailCode).toBeNull();

    await updatePortalAccount(ctx, { id: acc.id, label: 'Renamed Account' });
    expect((await listPortalAccounts(ctx))[0].label).toBe('Renamed Account');

    await deletePortalAccount(ctx, acc.id);
    expect((await listPortalAccounts(ctx)).length).toBe(0);
  });

  it('strictly enforces uniqueness of label, loginId, and phoneNumber across portal accounts in workspace', async () => {
    const acc1 = await createPortalAccount(ctx, {
      label: 'Alpha Account',
      phoneNumber: '9876543210',
      credentials: { loginId: 'unique1@example.com', password: 'pwd' },
    });

    // 1. Duplicate label on create
    await expect(
      createPortalAccount(ctx, {
        label: 'ALPHA Account',
        credentials: { loginId: 'unique2@example.com', password: 'pwd' },
      }),
    ).rejects.toThrow('already exists in this workspace');

    // 2. Duplicate loginId on create
    await expect(
      createPortalAccount(ctx, {
        label: 'Beta Account',
        credentials: { loginId: 'UNIQUE1@example.com', password: 'pwd' },
      }),
    ).rejects.toThrow('already exists in this workspace');

    // 3. Duplicate phone on create
    await expect(
      createPortalAccount(ctx, {
        label: 'Beta Account',
        phoneNumber: '9876543210',
        credentials: { loginId: 'unique2@example.com', password: 'pwd' },
      }),
    ).rejects.toThrow('already exists in this workspace');

    // Create a valid second account
    const acc2 = await createPortalAccount(ctx, {
      label: 'Beta Account',
      phoneNumber: '9876543211',
      credentials: { loginId: 'unique2@example.com', password: 'pwd' },
    });

    // 4. Updating acc2 to duplicate acc1's label
    await expect(
      updatePortalAccount(ctx, { id: acc2.id, label: 'alpha account' }),
    ).rejects.toThrow('already exists in this workspace');

    // 5. Updating acc2 to duplicate acc1's loginId
    await expect(
      updatePortalAccount(ctx, {
        id: acc2.id,
        credentials: { loginId: 'unique1@example.com', password: 'pwd' },
      }),
    ).rejects.toThrow('already exists in this workspace');

    // 6. Updating acc2 to duplicate acc1's phone
    await expect(
      updatePortalAccount(ctx, { id: acc2.id, phoneNumber: '9876543210' }),
    ).rejects.toThrow('already exists in this workspace');

    // Clean up
    await deletePortalAccount(ctx, acc1.id);
    await deletePortalAccount(ctx, acc2.id);
  });

  it('maps known portal status detail codes and statuses to human-friendly explanations and resolutions', () => {
    expect(getPortalStatusExplanation('needs_attention', 'tracker_reference_conflict')).toBe(
      'A previous order reference conflicted with another card. Check RuPay portal orders.',
    );
    expect(getPortalStatusExplanation('needs_attention', 'worker_lost_after_submit_started')).toBe(
      'Automation worker lost connection during checkout. Check RuPay portal orders.',
    );
    expect(getPortalStatusExplanation('needs_attention', 'network_post_submit')).toBe(
      'Network disconnected after 3DS authorization. Check RuPay portal orders.',
    );
    expect(getPortalStatusExplanation('credentials_expired', null)).toBe(
      'Portal sign-in failed. Please update portal login credentials.',
    );
    expect(getPortalStatusExplanation('challenge_required', null)).toBe(
      'Portal required a captcha or security challenge. Sign in manually to clear.',
    );
    expect(getPortalStatusExplanation('portal_changed', null)).toBe(
      'Portal layout changed unexpectedly. Check account configuration.',
    );
    expect(getPortalStatusExplanation('needs_attention', null)).toBe(
      'Account needs attention before automation can proceed. Check RuPay portal orders.',
    );

    expect(getPortalStatusResolution('needs_attention', 'tracker_reference_conflict')).toBe(
      'A previous order reference conflicted with another card. Please verify your RuPay portal orders and reconnect this account when ready.',
    );
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
    const card1Id = crypto.randomUUID();
    const card2Id = crypto.randomUUID();
    const [card1] = await db.insert(cards).values({
      id: card1Id,
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      displayName: 'Card 1',
      lastDigits: '1111',
      paymentDetailsEncrypted: encryptPaymentDetails({ version: 1, mode: 'saved_card', cvv: '123' }, card1Id),
    }).returning();
    const [card2] = await db.insert(cards).values({
      id: card2Id,
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      displayName: 'Card 2',
      lastDigits: '2222',
      paymentDetailsEncrypted: encryptPaymentDetails({ version: 1, mode: 'saved_card', cvv: '456' }, card2Id),
    }).returning();

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
    const c1Id = crypto.randomUUID();
    const [c1] = await db.insert(cards).values({
      id: c1Id,
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      lastDigits: '1111',
      displayName: 'Card 1',
      active: true,
      paymentDetailsEncrypted: encryptPaymentDetails({ version: 1, mode: 'saved_card', cvv: '789' }, c1Id),
    }).returning();

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
    const cardId = crypto.randomUUID();
    const [card] = await db.insert(cards).values({
      id: cardId,
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      displayName: 'Card 1',
      lastDigits: '4321',
      paymentDetailsEncrypted: encryptPaymentDetails({ version: 1, mode: 'saved_card', cvv: '999' }, cardId),
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

  it('sets and updates card assignments for a portal account', async () => {
    const acc = await createPortalAccount(ctx, {
      label: 'Acc Multi Cards',
      credentials: { loginId: 'multicards@test.com', password: 'pwd' },
    });
    const [holder] = await db.insert(cardHolders).values({ workspaceId, name: 'Holder' }).returning();
    const [cardType] = await db.insert(bankCardTypes).values({ displayName: 'Bank Card', bankName: 'Bank' }).returning();

    const [cardA] = await db.insert(cards).values({
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      displayName: 'Card A',
      lastDigits: '1111',
    }).returning();
    const [cardB] = await db.insert(cards).values({
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      displayName: 'Card B',
      lastDigits: '2222',
    }).returning();
    const [cardC] = await db.insert(cards).values({
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      displayName: 'Card C',
      lastDigits: '3333',
    }).returning();

    const samplePayment = {
      version: 1 as const,
      mode: 'full' as const,
      cardNumber: '5085001234567890',
      expiryMonth: '12',
      expiryYear: '2028',
      cvv: '123',
    };
    for (const c of [cardA, cardB, cardC]) {
      await db.update(cards)
        .set({ paymentDetailsEncrypted: encryptPaymentDetails(samplePayment, c.id) })
        .where(eq(cards.id, c.id));
    }

    // Assign Card A and Card B to this account
    await setPortalAccountCards(ctx, {
      portalAccountId: acc.id,
      cardIds: [cardA.id, cardB.id],
    });

    const m1 = await listPortalCardMappings(ctx, acc.id);
    expect(m1.map((m) => m.cardId).sort()).toEqual([cardA.id, cardB.id].sort());

    // Update assignment to Card B and Card C (Card A removed, Card C added)
    await setPortalAccountCards(ctx, {
      portalAccountId: acc.id,
      cardIds: [cardB.id, cardC.id],
    });

    const m2 = await listPortalCardMappings(ctx, acc.id);
    expect(m2.map((m) => m.cardId).sort()).toEqual([cardB.id, cardC.id].sort());

    // Unassign all cards from this account
    await setPortalAccountCards(ctx, {
      portalAccountId: acc.id,
      cardIds: [],
    });

    const m3 = await listPortalCardMappings(ctx, acc.id);
    expect(m3.length).toBe(0);
  });


  it('prevents assigning card to portal account if card details are not configured', async () => {
    const acc = await createPortalAccount(ctx, {
      label: 'Acc No Details',
      credentials: { loginId: 'no@test.com', password: 'pwd' },
    });
    const [holder] = await db.insert(cardHolders).values({ workspaceId, name: 'Holder' }).returning();
    const [cardType] = await db.insert(bankCardTypes).values({ displayName: 'Bank Card', bankName: 'Bank' }).returning();
    const [cardWithoutDetails] = await db.insert(cards).values({
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      displayName: 'Card Without Details',
      lastDigits: '9999',
    }).returning();

    await expect(
      setCardPortalAccounts(ctx, {
        cardId: cardWithoutDetails.id,
        portalAccountIds: [acc.id],
      }),
    ).rejects.toThrow('Payment details');
  });

  it('excludes cards without payment details from candidate nomination', async () => {
    await saveAutomationSettings(ctx, { enabled: true });
    const acc = await createPortalAccount(ctx, {
      label: 'acc_no_pay@test.com',
      credentials: { loginId: 'acc_no_pay@test.com', password: 'pwd' },
    });
    const [holder] = await db.insert(cardHolders).values({ workspaceId, name: 'Holder 1' }).returning();
    const [cardType] = await db.insert(bankCardTypes).values({ bankName: 'HDFC', cardType: 'Millennia', displayName: 'HDFC Millennia' }).returning();
    const [noPayCard] = await db.insert(cards).values({
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      lastDigits: '0000',
      displayName: 'No Pay Card',
      active: true,
    }).returning();

    // Directly insert mapping bypassing assignment validation to test candidate nomination filtering
    await db.insert(portalCardMappings).values({
      workspaceId,
      portalAccountId: acc.id,
      cardId: noPayCard.id,
      active: true,
    });

    const [b1] = await db.insert(benefits).values({ bankCardTypeId: cardType.id }).returning();
    const [v1] = await db.insert(benefitCatalogVersions).values({
      benefitId: b1.id,
      benefitType: 'Spa',
      exactBenefit: 'Spa Session',
      frequency: 'Quarterly',
      effectiveFrom: '2026-01-01',
    }).returning();
    await db.insert(benefitInstances).values({
      workspaceId,
      cardId: noPayCard.id,
      benefitId: b1.id,
      bankCardTypeId: cardType.id,
      generatedFromVersion: v1.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-12-31',
      periodLabel: 'Q4 2026',
      orderDeadline: '2026-10-31',
      orderStatus: 'Not Ordered',
    });

    // Should NOT nominate because card has no payment details
    const cand = await findCandidatesForAccount(db, acc.id, today);
    expect(cand).toBeNull();
  });

  it('nominates candidates from Global Order Queue across accounts, respecting re-ordering and cooldowns', async () => {
    // 1. Setup workspace with automation enabled
    await saveAutomationSettings(ctx, { enabled: true });

    // 2. Create Account 1 and Account 2 (Account 1 created first)
    const acc1 = await createPortalAccount(ctx, {
      label: 'Account 1',
      credentials: { loginId: 'acc1@test.com', password: 'password1' },
    });
    const acc2 = await createPortalAccount(ctx, {
      label: 'Account 2',
      credentials: { loginId: 'acc2@test.com', password: 'password2' },
    });

    const [holder] = await db.insert(cardHolders).values({ workspaceId, name: 'John Doe' }).returning();
    const [cardType] = await db.insert(bankCardTypes).values({ displayName: 'HDFC RuPay', bankName: 'HDFC' }).returning();

    // 3. Card 1 mapped to Account 1
    const card1Id = crypto.randomUUID();
    const [card1] = await db.insert(cards).values({
      id: card1Id,
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      displayName: 'Card 1',
      lastDigits: '1111',
      paymentDetailsEncrypted: encryptPaymentDetails({ version: 1, mode: 'saved_card', cvv: '111' }, card1Id),
    }).returning();
    await savePortalCardMapping(ctx, {
      portalAccountId: acc1.id,
      cardId: card1.id,
      portalCardId: '101',
      portalCardbinId: '201',
    });

    // 4. Card 2 mapped to Account 2
    const card2Id = crypto.randomUUID();
    const [card2] = await db.insert(cards).values({
      id: card2Id,
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      displayName: 'Card 2',
      lastDigits: '2222',
      paymentDetailsEncrypted: encryptPaymentDetails({ version: 1, mode: 'saved_card', cvv: '222' }, card2Id),
    }).returning();
    await savePortalCardMapping(ctx, {
      portalAccountId: acc2.id,
      cardId: card2.id,
      portalCardId: '102',
      portalCardbinId: '202',
    });

    // 5. Create benefits and instances
    const [b1] = await db.insert(benefits).values({ bankCardTypeId: cardType.id, benefitType: 'OTT' }).returning();
    const [v1] = await db.insert(benefitCatalogVersions).values({
      benefitId: b1.id,
      benefitType: 'OTT',
      benefitProvider: 'Prime Video',
      exactBenefit: 'Amazon Prime 12M',
      defaultCashValue: '1499.00',
      offerKind: 'voucher',
      effectiveFrom: '2026-01-01',
      frequency: 'Annual',
    }).returning();
    const [inst1] = await db.insert(benefitInstances).values({
      workspaceId,
      cardId: card1.id,
      bankCardTypeId: cardType.id,
      benefitId: b1.id,
      generatedFromVersion: v1.id,
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      periodLabel: '2026',
      orderDeadline: '2026-12-31',
      cashValue: '1499.00',
      orderStatus: 'Not Ordered',
    }).returning();

    const [b2] = await db.insert(benefits).values({ bankCardTypeId: cardType.id, benefitType: 'Music' }).returning();
    const [v2] = await db.insert(benefitCatalogVersions).values({
      benefitId: b2.id,
      benefitType: 'Music',
      benefitProvider: 'Spotify',
      exactBenefit: 'Spotify Premium 12M',
      defaultCashValue: '999.00',
      offerKind: 'voucher',
      effectiveFrom: '2026-01-01',
      frequency: 'Annual',
    }).returning();
    const [inst2] = await db.insert(benefitInstances).values({
      workspaceId,
      cardId: card2.id,
      bankCardTypeId: cardType.id,
      benefitId: b2.id,
      generatedFromVersion: v2.id,
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      periodLabel: '2026',
      orderDeadline: '2026-12-31',
      cashValue: '999.00',
      orderStatus: 'Not Ordered',
    }).returning();

    // 6. Set explicit queue positions:
    // Position 1: inst2 (Card 2 on Account 2)
    // Position 2: inst1 (Card 1 on Account 1)
    await db.insert(orderingQueueItems).values([
      { workspaceId, instanceId: inst2.id, position: 1, enabled: true },
      { workspaceId, instanceId: inst1.id, position: 2, enabled: true },
    ]);

    // Test A: Both accounts are eligible.
    // Must pick Position 1 (inst2) on Account 2, despite Account 1 being created first in DB!
    const nomA = await findCandidateFromGlobalQueue(db, workspaceId, today);
    expect(nomA).not.toBeNull();
    expect(nomA?.candidate.instanceId).toBe(inst2.id);
    expect(nomA?.account.id).toBe(acc2.id);
    expect(nomA?.candidate.rulePriority).toBe(1);

    // Test B: Account 2 is placed on 24h portal cooldown
    const tomorrow = new Date(Date.now() + 20 * 60 * 60 * 1000);
    await db.update(portalAccounts).set({ cooldownUntil: tomorrow }).where(eq(portalAccounts.id, acc2.id));

    // Must seamlessly fall through to Position 2 (inst1 on Account 1)!
    const nomB = await findCandidateFromGlobalQueue(db, workspaceId, today);
    expect(nomB).not.toBeNull();
    expect(nomB?.candidate.instanceId).toBe(inst1.id);
    expect(nomB?.account.id).toBe(acc1.id);
    expect(nomB?.candidate.rulePriority).toBe(2);

    // Test C: Clear Account 2 cooldown, but user re-orders queue:
    // Move inst1 (Account 1) to Position 1, and inst2 (Account 2) to Position 2
    await db.update(portalAccounts).set({ cooldownUntil: null }).where(eq(portalAccounts.id, acc2.id));
    await db.update(orderingQueueItems).set({ position: 1 }).where(eq(orderingQueueItems.instanceId, inst1.id));
    await db.update(orderingQueueItems).set({ position: 2 }).where(eq(orderingQueueItems.instanceId, inst2.id));

    // Re-ordering must be respected: inst1 on Account 1 is now picked first!
    const nomC = await findCandidateFromGlobalQueue(db, workspaceId, today);
    expect(nomC).not.toBeNull();
    expect(nomC?.candidate.instanceId).toBe(inst1.id);
    expect(nomC?.account.id).toBe(acc1.id);

    // Test D: If an instance's card is mapped to multiple accounts, explicit portalAccountId wins
    await savePortalCardMapping(ctx, {
      portalAccountId: acc2.id,
      cardId: card1.id,
      portalCardId: '109',
      portalCardbinId: '209',
    });
    // Set inst1 at Position 1 with chosen portalAccountId = acc2.id
    await db.update(orderingQueueItems).set({ position: 1, portalAccountId: acc2.id }).where(eq(orderingQueueItems.instanceId, inst1.id));
    await db.update(orderingQueueItems).set({ position: 2 }).where(eq(orderingQueueItems.instanceId, inst2.id));

    const nomD = await findCandidateFromGlobalQueue(db, workspaceId, today);
    expect(nomD).not.toBeNull();
    expect(nomD?.candidate.instanceId).toBe(inst1.id);
    expect(nomD?.account.id).toBe(acc2.id);
    expect(nomC?.candidate.rulePriority).toBe(1);
  });

  it('enforces (portal_account, card_type, period) entitlement limit so multiple cards of the same type use distinct accounts', async () => {
    const today = '2026-10-18';
    const workspaceId = crypto.randomUUID();
    const testCtx: Ctx = {
      userId: 'user_1',
      workspaceId,
      role: 'admin',
      db,
      today,
    };

    await db.insert(workspaces).values({ id: workspaceId, name: 'Multi-Card Entitlement Workspace' });
    await db.insert(automationSettings).values({ workspaceId, enabled: true });

    // Two connected accounts
    const acc1 = await createPortalAccount(testCtx, {
      label: 'acc1@gmail.com',
      credentials: { loginId: 'acc1@gmail.com', password: 'p1' },
    });

    const acc2 = await createPortalAccount(testCtx, {
      label: 'acc2@gmail.com',
      credentials: { loginId: 'acc2@gmail.com', password: 'p2' },
    });

    const [variant] = await db.insert(cardVariants).values({ name: 'Select Variant' }).returning();
    const [cardType] = await db.insert(bankCardTypes).values({
      displayName: 'Bank of India RuPay Select',
      variantId: variant.id,
      bankName: 'Bank of India',
    }).returning();

    const [holder] = await db.insert(cardHolders).values({ workspaceId, name: 'Surendra' }).returning();

    // Two separate physical cards of the SAME card type
    const card1Id = crypto.randomUUID();
    const [card1] = await db.insert(cards).values({
      id: card1Id,
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      displayName: 'Card 1 (BOI)',
      lastDigits: '1111',
      paymentDetailsEncrypted: encryptPaymentDetails({ version: 1, mode: 'saved_card', cvv: '111' }, card1Id),
    }).returning();

    const card2Id = crypto.randomUUID();
    const [card2] = await db.insert(cards).values({
      id: card2Id,
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      displayName: 'Card 2 (BOI)',
      lastDigits: '2222',
      paymentDetailsEncrypted: encryptPaymentDetails({ version: 1, mode: 'saved_card', cvv: '222' }, card2Id),
    }).returning();

    // Card 1 is mapped to Account 1
    await savePortalCardMapping(testCtx, {
      portalAccountId: acc1.id,
      cardId: card1.id,
      portalCardId: '101',
      portalCardbinId: '201',
    });

    // Card 2 is mapped to BOTH Account 1 and Account 2
    await savePortalCardMapping(testCtx, {
      portalAccountId: acc1.id,
      cardId: card2.id,
      portalCardId: '101',
      portalCardbinId: '201',
    });
    await savePortalCardMapping(testCtx, {
      portalAccountId: acc2.id,
      cardId: card2.id,
      portalCardId: '102',
      portalCardbinId: '202',
    });

    // Benefit: Cab Services for Q4 2026
    const [benefit] = await db.insert(benefits).values({ bankCardTypeId: cardType.id, benefitType: 'Cab Services' }).returning();
    const [ver] = await db.insert(benefitCatalogVersions).values({
      benefitId: benefit.id,
      benefitType: 'Cab Services',
      benefitProvider: 'Uber',
      exactBenefit: 'Uber 100',
      defaultCashValue: '100.00',
      offerKind: 'voucher',
      effectiveFrom: '2026-10-01',
      frequency: 'Quarterly',
    }).returning();

    // Instance 1 for Card 1
    const [inst1] = await db.insert(benefitInstances).values({
      workspaceId,
      cardId: card1.id,
      bankCardTypeId: cardType.id,
      benefitId: benefit.id,
      generatedFromVersion: ver.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-12-31',
      periodLabel: 'Q4 2026',
      orderDeadline: '2026-12-31',
      cashValue: '100.00',
      orderStatus: 'Ordered but Coupon not received',
    }).returning();

    // Instance 2 for Card 2 (same benefit and period, but Not Ordered!)
    const [inst2] = await db.insert(benefitInstances).values({
      workspaceId,
      cardId: card2.id,
      bankCardTypeId: cardType.id,
      benefitId: benefit.id,
      generatedFromVersion: ver.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-12-31',
      periodLabel: 'Q4 2026',
      orderDeadline: '2026-12-31',
      cashValue: '100.00',
      orderStatus: 'Not Ordered',
    }).returning();

    // Record that Card 1 was already successfully ordered via Account 1
    await db.insert(portalOrderAttempts).values({
      workspaceId,
      portalAccountId: acc1.id,
      instanceId: inst1.id,
      state: 'confirmed',
      bookingReference: 'RUPS-CARD1-DONE',
    });

    // Put Card 2's instance in the queue
    await db.insert(orderingQueueItems).values({
      workspaceId,
      instanceId: inst2.id,
      position: 1,
      enabled: true,
    });

    // 1. Account 1 must NOT be nominated for Card 2's instance because Account 1 already redeemed
    // this (BOI Select, Cab Services, Q4 2026) entitlement!
    const candAcc1 = await findCandidatesForAccount(db, acc1.id, today);
    expect(candAcc1).toBeNull();

    // 2. Global queue evaluation must route Card 2's instance to Account 2!
    const globalNom = await findCandidateFromGlobalQueue(db, workspaceId, today);
    expect(globalNom).not.toBeNull();
    expect(globalNom?.candidate.instanceId).toBe(inst2.id);
    expect(globalNom?.account.id).toBe(acc2.id); // Routed to Account 2, bypassing Account 1!
  });
});

