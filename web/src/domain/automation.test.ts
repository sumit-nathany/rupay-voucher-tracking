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
});
