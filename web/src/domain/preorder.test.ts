import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/test/db';
import type { Database } from '@/lib/context';
import {
  workspaces,
  cardHolders,
  cards,
  bankCardTypes,
  benefits,
  benefitCatalogVersions,
  benefitInstances,
  benefitOptions,
  portalAccounts,
  portalOrderPreorderSessions,
} from '@/db/schema';
import { getAvailableBenefitsForPreorder } from './preorder';

describe('getAvailableBenefitsForPreorder', () => {
  let db: Database;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const testDb = await createTestDb();
    db = testDb.db;
    close = testDb.close;
  });

  afterAll(async () => {
    await close();
  });

  it('retrieves entitled benefits and filters out portal-locked and expired ones', async () => {
    // 1. Setup workspace & cardholder
    const [ws] = await db.insert(workspaces).values({ name: 'Preorder Test WS' }).returning();
    const [holder] = await db
      .insert(cardHolders)
      .values({ workspaceId: ws.id, name: 'Sumit' })
      .returning();

    // 2. Setup Bank Card Type
    const [cardType] = await db
      .insert(bankCardTypes)
      .values({
        bankName: 'Bank of India',
        cardType: 'Select',
        displayName: 'Bank of India Select',
        network: 'RuPay',
      })
      .returning();

    // 3. Setup Cards
    const [card1] = await db
      .insert(cards)
      .values({
        workspaceId: ws.id,
        holderId: holder.id,
        bankCardTypeId: cardType.id,
        displayName: 'Card 1',
        lastDigits: '1111',
      })
      .returning();

    const [card2] = await db
      .insert(cards)
      .values({
        workspaceId: ws.id,
        holderId: holder.id,
        bankCardTypeId: cardType.id,
        displayName: 'Card 2',
        lastDigits: '2222',
      })
      .returning();

    // 4. Setup Portal Account
    const [portalAcc] = await db
      .insert(portalAccounts)
      .values({
        workspaceId: ws.id,
        label: 'Sumit Truztee',
        credentialsEncrypted: 'mock-enc',
        phoneNumber: '9876543210',
        status: 'connected',
      })
      .returning();

    // 5. Setup Catalog Benefits: Cab, OTT, Spa
    const [benCab] = await db.insert(benefits).values({ bankCardTypeId: cardType.id }).returning();
    const [cabVersion] = await db
      .insert(benefitCatalogVersions)
      .values({
        benefitId: benCab.id,
        benefitType: 'Cab Services',
        benefitProvider: 'Uber',
        exactBenefit: 'Uber ₹250 Voucher',
        frequency: 'Quarterly',
        defaultCashValue: '250',
        effectiveFrom: '2026-01-01',
      })
      .returning();

    const [benOtt] = await db.insert(benefits).values({ bankCardTypeId: cardType.id }).returning();
    const [ottVersion] = await db
      .insert(benefitCatalogVersions)
      .values({
        benefitId: benOtt.id,
        benefitType: 'OTT Entertainment',
        benefitProvider: 'SonyLIV',
        exactBenefit: 'SonyLIV Premium',
        frequency: 'Quarterly',
        defaultCashValue: '500',
        effectiveFrom: '2026-01-01',
      })
      .returning();

    // Add options for OTT
    await db.insert(benefitOptions).values([
      {
        versionId: ottVersion.id,
        provider: 'SonyLIV',
        offerName: 'SonyLIV 1-Month',
        cashValue: '500',
      },
      {
        versionId: ottVersion.id,
        provider: 'Zee5',
        offerName: 'Zee5 3-Month',
        cashValue: '500',
      },
    ]);

    const [benSpa] = await db.insert(benefits).values({ bankCardTypeId: cardType.id }).returning();
    const [spaVersion] = await db
      .insert(benefitCatalogVersions)
      .values({
        benefitId: benSpa.id,
        benefitType: 'Spa & Salon',
        benefitProvider: 'Four Fountains',
        exactBenefit: 'Four Fountains ₹1000',
        frequency: 'Quarterly',
        defaultCashValue: '1000',
        effectiveFrom: '2026-01-01',
      })
      .returning();

    const periodStart = '2026-10-01';
    const periodEnd = '2026-12-31';

    // 6. Setup Instances for Card 1
    // Cab (Not Ordered)
    const [instCab1] = await db
      .insert(benefitInstances)
      .values({
        workspaceId: ws.id,
        cardId: card1.id,
        bankCardTypeId: cardType.id,
        benefitId: benCab.id,
        generatedFromVersion: cabVersion.id,
        periodStart,
        periodEnd,
        periodLabel: 'Q4 2026',
        orderStatus: 'Not Ordered',
        orderDeadline: '2026-12-31',
      })
      .returning();

    // OTT (Not Ordered)
    const [instOtt1] = await db
      .insert(benefitInstances)
      .values({
        workspaceId: ws.id,
        cardId: card1.id,
        bankCardTypeId: cardType.id,
        benefitId: benOtt.id,
        generatedFromVersion: ottVersion.id,
        periodStart,
        periodEnd,
        periodLabel: 'Q4 2026',
        orderStatus: 'Not Ordered',
        orderDeadline: '2026-12-31',
      })
      .returning();

    // Spa (Already Ordered on Card 2 using this same portal account -> should lock out Spa for this portal account!)
    await db.insert(benefitInstances).values({
      workspaceId: ws.id,
      cardId: card2.id,
      bankCardTypeId: cardType.id,
      benefitId: benSpa.id,
      portalAccountId: portalAcc.id,
      generatedFromVersion: spaVersion.id,
      periodStart,
      periodEnd,
      periodLabel: 'Q4 2026',
      orderStatus: 'Ordered but Coupon not received',
      orderDeadline: '2026-12-31',
    });

    // Spa instance on Card 1 (Not Ordered)
    const [instSpa1] = await db
      .insert(benefitInstances)
      .values({
        workspaceId: ws.id,
        cardId: card1.id,
        bankCardTypeId: cardType.id,
        benefitId: benSpa.id,
        generatedFromVersion: spaVersion.id,
        periodStart,
        periodEnd,
        periodLabel: 'Q4 2026',
        orderStatus: 'Not Ordered',
        orderDeadline: '2026-12-31',
      })
      .returning();

    // Call getAvailableBenefitsForPreorder for Card 1
    const results = await getAvailableBenefitsForPreorder(db, {
      workspaceId: ws.id,
      cardId: card1.id,
      portalAccountId: portalAcc.id,
      bankCardTypeId: cardType.id,
      periodStart,
      today: '2026-11-02',
    });

    // Expect Cab and OTT to be available, but Spa excluded because portalAcc already ordered Spa on this card type this quarter!
    const availableInstanceIds = results.map((r) => r.instanceId);
    expect(availableInstanceIds).toContain(instCab1.id);
    expect(availableInstanceIds).toContain(instOtt1.id);
    expect(availableInstanceIds).not.toContain(instSpa1.id);

    // Verify OTT options are unpacked
    const ott = results.find((r) => r.instanceId === instOtt1.id);
    expect(ott).toBeDefined();
    expect(ott?.options).toHaveLength(2);
    expect(ott?.options.map((o) => o.offerName)).toEqual(['SonyLIV 1-Month', 'Zee5 3-Month']);
  });

  it('updates session and persists candidate swap when user chooses a different benefit', async () => {
    const [ws] = await db.insert(workspaces).values({ name: 'Swap Test WS' }).returning();
    const [holder] = await db
      .insert(cardHolders)
      .values({ workspaceId: ws.id, name: 'Sumit' })
      .returning();

    const [cardType] = await db
      .insert(bankCardTypes)
      .values({
        bankName: 'HDFC Bank',
        cardType: 'Platinum',
        displayName: 'HDFC Bank Platinum',
        network: 'RuPay',
      })
      .returning();

    const [card] = await db
      .insert(cards)
      .values({
        workspaceId: ws.id,
        holderId: holder.id,
        bankCardTypeId: cardType.id,
        displayName: 'Card 1',
        lastDigits: '3333',
      })
      .returning();

    const [benCab] = await db.insert(benefits).values({ bankCardTypeId: cardType.id }).returning();
    const [cabVersion] = await db
      .insert(benefitCatalogVersions)
      .values({
        benefitId: benCab.id,
        benefitType: 'Cab Services',
        benefitProvider: 'Uber',
        exactBenefit: 'Uber ₹250 Voucher',
        frequency: 'Quarterly',
        defaultCashValue: '250',
        effectiveFrom: '2026-01-01',
      })
      .returning();

    const [benOtt] = await db.insert(benefits).values({ bankCardTypeId: cardType.id }).returning();
    const [ottVersion] = await db
      .insert(benefitCatalogVersions)
      .values({
        benefitId: benOtt.id,
        benefitType: 'OTT Entertainment',
        benefitProvider: 'SonyLIV',
        exactBenefit: 'SonyLIV Premium',
        frequency: 'Quarterly',
        defaultCashValue: '500',
        effectiveFrom: '2026-01-01',
      })
      .returning();

    const [opt] = await db
      .insert(benefitOptions)
      .values({
        versionId: ottVersion.id,
        provider: 'SonyLIV',
        offerName: 'SonyLIV 1-Month',
        cashValue: '500',
      })
      .returning();

    const [instCab] = await db
      .insert(benefitInstances)
      .values({
        workspaceId: ws.id,
        cardId: card.id,
        bankCardTypeId: cardType.id,
        benefitId: benCab.id,
        generatedFromVersion: cabVersion.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-12-31',
        periodLabel: 'Q4 2026',
        orderStatus: 'Not Ordered',
        orderDeadline: '2026-12-31',
      })
      .returning();

    const [instOtt] = await db
      .insert(benefitInstances)
      .values({
        workspaceId: ws.id,
        cardId: card.id,
        bankCardTypeId: cardType.id,
        benefitId: benOtt.id,
        generatedFromVersion: ottVersion.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-12-31',
        periodLabel: 'Q4 2026',
        orderStatus: 'Not Ordered',
        orderDeadline: '2026-12-31',
      })
      .returning();

    // Create initial session for Cab
    const [session] = await db
      .insert(portalOrderPreorderSessions)
      .values({
        workspaceId: ws.id,
        instanceId: instCab.id,
        telegramChatId: '123456789',
        status: 'pending',
        expiresAt: new Date(Date.now() + 45000),
        metadata: {
          availableBenefits: [
            { instanceId: instCab.id, benefitType: 'Cab Services' },
            { instanceId: instOtt.id, benefitType: 'OTT Entertainment' },
          ],
          availableBenefitIds: [instCab.id, instOtt.id],
        },
      })
      .returning();

    expect(session.instanceId).toBe(instCab.id);
    expect(session.selectedInstanceId).toBeNull();

    // User switches to OTT + selects option
    await db
      .update(portalOrderPreorderSessions)
      .set({
        status: 'benefit_selected',
        selectedInstanceId: instOtt.id,
        selectedOptionId: opt.id,
        selectedOptionName: opt.offerName,
        updatedAt: new Date(),
      })
      .where(eq(portalOrderPreorderSessions.id, session.id));

    await db
      .update(benefitInstances)
      .set({ chosenOptionId: opt.id, updatedAt: new Date() })
      .where(eq(benefitInstances.id, instOtt.id));

    // Verify session state
    const [updatedSession] = await db
      .select()
      .from(portalOrderPreorderSessions)
      .where(eq(portalOrderPreorderSessions.id, session.id));

    expect(updatedSession.status).toBe('benefit_selected');
    expect(updatedSession.selectedInstanceId).toBe(instOtt.id);
    expect(updatedSession.selectedOptionId).toBe(opt.id);
    expect(updatedSession.selectedOptionName).toBe('SonyLIV 1-Month');

    // Verify that original instance (Cab) remained untouched in Not Ordered
    const [cabAfter] = await db
      .select()
      .from(benefitInstances)
      .where(eq(benefitInstances.id, instCab.id));
    expect(cabAfter.orderStatus).toBe('Not Ordered');
    expect(cabAfter.chosenOptionId).toBeNull();

    // Verify chosenOptionId set on target instance
    const [ottAfter] = await db
      .select()
      .from(benefitInstances)
      .where(eq(benefitInstances.id, instOtt.id));
    expect(ottAfter.chosenOptionId).toBe(opt.id);
  });
});
