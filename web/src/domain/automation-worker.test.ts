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
  portalAccounts,
  portalOrderAttempts,
} from '@/db/schema';
import type { Database, Ctx } from '@/lib/context';
import { FakePortalOrderClient, PortalOrderError } from '@/lib/portal-client';
import {
  saveAutomationSettings,
  createPortalAccount,
  savePortalCardMapping,
  createOrderingRule,
} from './automation';
import {
  runAutomationJob,
  recoverExpiredAttempts,
  resolveUncertainAttempt,
} from './automation-worker';

describe('automation worker', () => {
  let db: Database;
  let close: () => Promise<void>;
  let ctx: Ctx;
  const workspaceId = '22222222-2222-4222-a222-222222222222';
  const today = '2026-10-15';
  const origKey = process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY;

  beforeEach(async () => {
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    await db.insert(workspaces).values({ id: workspaceId, name: 'Workspace Worker' });
    ctx = {
      userId: 'user_worker',
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

  async function setupFixture() {
    await saveAutomationSettings(ctx, { enabled: true });

    const acc = await createPortalAccount(ctx, {
      label: 'Automated Account',
      credentials: { loginId: 'portal_user', password: 'portal_password' },
    });

    const [holder] = await db.insert(cardHolders).values({ workspaceId, name: 'Alice Smith' }).returning();
    const [cardType] = await db.insert(bankCardTypes).values({ displayName: 'PNB Select Card', bankName: 'PNB' }).returning();
    const [card] = await db.insert(cards).values({
      workspaceId,
      holderId: holder.id,
      bankCardTypeId: cardType.id,
      displayName: 'Alice PNB',
      lastDigits: '8888',
    }).returning();

    await savePortalCardMapping(ctx, {
      portalAccountId: acc.id,
      cardId: card.id,
      portalCardId: '151',
      portalCardbinId: '208',
    });

    const [ben] = await db.insert(benefits).values({ bankCardTypeId: cardType.id, benefitType: 'Movie Tickets' }).returning();
    const [ver] = await db.insert(benefitCatalogVersions).values({
      benefitId: ben.id,
      benefitType: 'Movie Tickets',
      exactBenefit: 'BMS Rs 250 off',
      effectiveFrom: '2026-01-01',
      frequency: 'Quarterly',
      instanceCount: 1,
    }).returning();

    const [inst] = await db.insert(benefitInstances).values({
      workspaceId,
      cardId: card.id,
      benefitId: ben.id,
      bankCardTypeId: cardType.id,
      generatedFromVersion: ver.id,
      periodStart: '2026-10-01',
      periodEnd: '2026-12-31',
      periodLabel: 'Q4 2026',
      instanceNumber: 1,
      orderDeadline: '2026-10-31',
      orderStatus: 'Not Ordered',
    }).returning();

    await createOrderingRule(ctx, {
      portalAccountId: acc.id,
      name: 'Order Movie Tickets',
      priority: 1,
      benefitIds: [ben.id],
    });

    return { acc, card, ben, inst };
  }

  it('runs automated job, confirms order, updates instance and records booking ID', async () => {
    const { acc, inst } = await setupFixture();

    const client = new FakePortalOrderClient({
      bookingReference: 'BK-CONFIRMED-999',
    });

    const result = await runAutomationJob({ db, client, today });
    expect(result.status).toBe('completed');
    expect(result.accountsProcessed).toBe(1);
    expect(result.ordersConfirmed).toBe(1);
    expect(result.ordersFailed).toBe(0);

    // Verify instance updated
    const [updatedInst] = await db.select().from(benefitInstances).where(eq(benefitInstances.id, inst.id));
    expect(updatedInst.orderStatus).toBe('Ordered but Coupon not received');
    expect(updatedInst.orderDate).toBe(today);
    expect(updatedInst.rupayBookingId).toBe('BK-CONFIRMED-999');

    // Verify account updated
    const [updatedAcc] = await db.select().from(portalAccounts).where(eq(portalAccounts.id, acc.id));
    expect(updatedAcc.lastConfirmedOrderAt).not.toBeNull();

    // Verify attempt recorded as confirmed
    const attempts = await db.select().from(portalOrderAttempts).where(eq(portalOrderAttempts.portalAccountId, acc.id));
    expect(attempts.length).toBe(1);
    expect(attempts[0].state).toBe('confirmed');
    expect(attempts[0].bookingReference).toBe('BK-CONFIRMED-999');
  });

  it('handles post-submit timeout as uncertain and requires manual resolution', async () => {
    const { acc, inst } = await setupFixture();

    const client = new FakePortalOrderClient({
      submitError: new PortalOrderError('network_post_submit', 'Network timeout after submit', true),
    });

    const result = await runAutomationJob({ db, client, today });
    expect(result.ordersFailed).toBe(1);

    // Verify instance remains Not Ordered
    const [updatedInst] = await db.select().from(benefitInstances).where(eq(benefitInstances.id, inst.id));
    expect(updatedInst.orderStatus).toBe('Not Ordered');

    // Verify account marked needs_attention
    const [updatedAcc] = await db.select().from(portalAccounts).where(eq(portalAccounts.id, acc.id));
    expect(updatedAcc.status).toBe('needs_attention');
    expect(updatedAcc.statusDetailCode).toBe('network_post_submit');

    // Verify attempt is uncertain
    const [attempt] = await db.select().from(portalOrderAttempts).where(eq(portalOrderAttempts.portalAccountId, acc.id));
    expect(attempt.state).toBe('uncertain');

    // User checks portal and confirms booking WAS created
    await resolveUncertainAttempt(ctx, {
      attemptId: attempt.id,
      resolution: 'confirmed',
      bookingReference: 'MANUAL-REF-456',
    });

    const [resolvedInst] = await db.select().from(benefitInstances).where(eq(benefitInstances.id, inst.id));
    expect(resolvedInst.orderStatus).toBe('Ordered but Coupon not received');
    expect(resolvedInst.rupayBookingId).toBe('MANUAL-REF-456');

    const [clearedAcc] = await db.select().from(portalAccounts).where(eq(portalAccounts.id, acc.id));
    expect(clearedAcc.status).toBe('connected');
  });

  it('handles user resolving uncertain attempt when NO booking was created', async () => {
    const { acc, inst } = await setupFixture();

    const client = new FakePortalOrderClient({
      submitError: new PortalOrderError('network_post_submit', 'Network timeout after submit', true),
    });

    await runAutomationJob({ db, client, today });

    const [attempt] = await db.select().from(portalOrderAttempts).where(eq(portalOrderAttempts.portalAccountId, acc.id));
    expect(attempt.state).toBe('uncertain');

    // User confirms no booking exists on portal
    await resolveUncertainAttempt(ctx, {
      attemptId: attempt.id,
      resolution: 'resolved_no_order',
    });

    const [finalInst] = await db.select().from(benefitInstances).where(eq(benefitInstances.id, inst.id));
    expect(finalInst.orderStatus).toBe('Not Ordered');

    const [finalAttempt] = await db.select().from(portalOrderAttempts).where(eq(portalOrderAttempts.id, attempt.id));
    expect(finalAttempt.state).toBe('resolved_no_order');

    const [finalAcc] = await db.select().from(portalAccounts).where(eq(portalAccounts.id, acc.id));
    expect(finalAcc.status).toBe('connected');
  });

  it('recovers expired reserved attempts to cancelled and expired submitting to uncertain', async () => {
    const { acc, inst } = await setupFixture();

    const pastLease = new Date(Date.now() - 10 * 60 * 1000);

    // Expired reserved attempt
    const [att1] = await db.insert(portalOrderAttempts).values({
      workspaceId,
      portalAccountId: acc.id,
      instanceId: inst.id,
      state: 'reserved',
      leaseExpiresAt: pastLease,
    }).returning();

    await recoverExpiredAttempts(db);

    const [recovered1] = await db.select().from(portalOrderAttempts).where(eq(portalOrderAttempts.id, att1.id));
    expect(recovered1.state).toBe('cancelled');
    expect(recovered1.failureCode).toBe('reservation_lease_expired');
  });

  it('preserves conflicting human booking ID and flags account needs_attention', async () => {
    const { acc, inst } = await setupFixture();

    // Human already entered a booking ID
    await db.update(benefitInstances).set({ rupayBookingId: 'HUMAN-ENTERED-ID' }).where(eq(benefitInstances.id, inst.id));

    const client = new FakePortalOrderClient({
      bookingReference: 'PORTAL-GENERATED-ID',
    });

    await runAutomationJob({ db, client, today });

    const [updatedInst] = await db.select().from(benefitInstances).where(eq(benefitInstances.id, inst.id));
    expect(updatedInst.rupayBookingId).toBe('HUMAN-ENTERED-ID'); // Human value preserved!

    const [updatedAcc] = await db.select().from(portalAccounts).where(eq(portalAccounts.id, acc.id));
    expect(updatedAcc.status).toBe('needs_attention');
    expect(updatedAcc.statusDetailCode).toBe('tracker_reference_conflict');

    const [attempt] = await db.select().from(portalOrderAttempts).where(eq(portalOrderAttempts.portalAccountId, acc.id));
    expect(attempt.state).toBe('confirmed');
    expect(attempt.bookingReference).toBe('PORTAL-GENERATED-ID');
    expect(attempt.failureCode).toBe('tracker_reference_conflict');
  });
});
