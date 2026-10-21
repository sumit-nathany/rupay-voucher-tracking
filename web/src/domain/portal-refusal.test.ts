import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/test/db';
import type { Database, Ctx } from '@/lib/context';
import {
  workspaces,
  cardHolders,
  cards,
  bankCardTypes,
  benefits,
  benefitCatalogVersions,
  benefitInstances,
} from '@/db/schema';
import { encryptPaymentDetails } from '@/lib/card-payment-details';
import {
  createOrderingRule,
  createPortalAccount,
  findCandidatesForAccount,
  saveAutomationSettings,
  savePortalCardMapping,
} from './automation';
import { dismissPortalRefusal } from './instances';
import { recordPortalRefusal } from './portal-refusal-store';
import { classifyPortalRefusal, portalRefusalSentence, PORTAL_REFUSAL_CODES } from './portal-refusal';

describe('classifyPortalRefusal', () => {
  it('recognises a card whose limit is already used up', () => {
    for (const phrase of [
      'Maximum uses exhausted on this card number',
      'Uses exhausted on this card',
      'Limit exceeded on this card',
      'Redemption limit reached for this benefit',
    ]) {
      expect(classifyPortalRefusal(phrase), phrase).toBe('card_limit_reached');
    }
  });

  it('recognises a benefit that is not available for the card', () => {
    for (const phrase of [
      'Offer not available for this card',
      'Benefit not available',
      'Card not eligible',
      'Not eligible for this card',
      'Not applicable for this card',
    ]) {
      expect(classifyPortalRefusal(phrase), phrase).toBe('benefit_unavailable');
    }
  });

  it('recognises a benefit the portal says was already ordered', () => {
    for (const phrase of [
      'Offer already availed',
      'Already redeemed on this card',
      'Already ordered',
    ]) {
      expect(classifyPortalRefusal(phrase), phrase).toBe('already_ordered');
    }
  });

  it('prefers "already ordered" over the limit wording', () => {
    // "offer already availed" reads like a limit message, but it is a
    // different fact, and the ordering of the phrase table matters.
    expect(classifyPortalRefusal('Offer already availed for this card')).toBe('already_ordered');
  });

  it('is case insensitive', () => {
    expect(classifyPortalRefusal('OFFER NOT AVAILABLE FOR THIS CARD')).toBe('benefit_unavailable');
  });

  it('does not treat a declined payment as a refusal', () => {
    // A declined payment is transient and worth retrying — the benefit is
    // still available. It belongs on the attempt, not on the instance.
    for (const phrase of ['Transaction Failed', 'Declined', 'Payment failed', 'Try again later']) {
      expect(classifyPortalRefusal(phrase), phrase).toBeNull();
    }
  });

  it('returns null for text that says nothing about a refusal', () => {
    expect(classifyPortalRefusal('Enter the OTP sent to your registered mobile')).toBeNull();
    expect(classifyPortalRefusal('')).toBeNull();
    expect(classifyPortalRefusal(null)).toBeNull();
    expect(classifyPortalRefusal(undefined)).toBeNull();
  });
});

describe('portalRefusalSentence', () => {
  it('names the source and the reason', () => {
    const s = portalRefusalSentence('card_limit_reached', 'rupay_portal', 'Maximum uses exhausted');
    expect(s).toContain('RuPay portal');
    expect(s).toContain('Card limit reached');
    expect(s).toContain('Maximum uses exhausted');
  });

  it('works without a detail', () => {
    const s = portalRefusalSentence('benefit_unavailable', 'bank');
    expect(s).toContain('Bank');
    expect(s).toContain('Not available for this card');
  });
});

describe('the vocabulary', () => {
  it('has a label for every code', () => {
    for (const code of PORTAL_REFUSAL_CODES) {
      expect(typeof code).toBe('string');
    }
  });
});

// ── The behaviour that matters: a refused instance stops being nominated ──────

describe('a portal refusal on a benefit instance', () => {
  let db: Database;
  let close: () => Promise<void>;
  let ctx: Ctx;
  const workspaceId = '11111111-1111-4111-a111-111111111111';
  const today = '2026-10-15';
  const origKey = process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY;

  let instanceId: string;
  let accountId: string;

  // One database for the whole file. Spinning up PGlite and replaying every
  // migration takes seconds, and the suite runs many of these in parallel —
  // doing it per test made the whole suite flaky.
  beforeAll(async () => {
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    const res = await createTestDb();
    db = res.db;
    close = res.close;

    await db.insert(workspaces).values({ id: workspaceId, name: 'Workspace A' });
    ctx = { userId: 'user_1', workspaceId, role: 'admin', db, today };

    await saveAutomationSettings(ctx, { enabled: true });
    const acc = await createPortalAccount(ctx, {
      label: 'Primary Account',
      credentials: { loginId: 'user1', password: 'pwd' },
    });
    accountId = acc.id;
    const [holder] = await db.insert(cardHolders).values({ workspaceId, name: 'John Doe' }).returning();
    const [cardType] = await db
      .insert(bankCardTypes)
      .values({ displayName: 'PNB Select Card', bankName: 'PNB' })
      .returning();
    const cardId = crypto.randomUUID();
    const [card] = await db
      .insert(cards)
      .values({
        id: cardId,
        workspaceId,
        holderId: holder.id,
        bankCardTypeId: cardType.id,
        displayName: 'Card 1',
        lastDigits: '1111',
        paymentDetailsEncrypted: encryptPaymentDetails(
          { version: 1, mode: 'saved_card', cvv: '123' },
          cardId,
        ),
      })
      .returning();
    await savePortalCardMapping(ctx, {
      portalAccountId: acc.id,
      cardId: card.id,
      portalCardId: '151',
      portalCardbinId: '208',
    });

    const [ben] = await db
      .insert(benefits)
      .values({ bankCardTypeId: cardType.id, benefitType: 'Spa Services' })
      .returning();
    const [version] = await db
      .insert(benefitCatalogVersions)
      .values({
        benefitId: ben.id,
        benefitType: 'Spa Services',
        exactBenefit: 'Spa 60min',
        effectiveFrom: '2026-01-01',
        frequency: 'Quarterly',
        instanceCount: 1,
      })
      .returning();
    const [inst] = await db
      .insert(benefitInstances)
      .values({
        workspaceId,
        cardId: card.id,
        benefitId: ben.id,
        bankCardTypeId: cardType.id,
        generatedFromVersion: version.id,
        periodStart: '2026-10-01',
        periodEnd: '2026-12-31',
        periodLabel: 'Q4 2026',
        instanceNumber: 1,
        orderDeadline: '2026-10-31',
        orderStatus: 'Not Ordered',
      })
      .returning();
    instanceId = inst.id;

    await createOrderingRule(ctx, {
      portalAccountId: acc.id,
      name: 'Order everything',
      cardIds: [card.id],
    });
  });

  afterAll(async () => {
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = origKey;
    await close();
  });

  it('stops nominating the instance once the portal refuses it, and starts again when it is dismissed', async () => {
    // Before the refusal the instance is orderable.
    const before = await findCandidatesForAccount(db, accountId, today);
    expect(before?.instanceId).toBe(instanceId);

    await recordPortalRefusal(db, {
      instanceId,
      code: 'card_limit_reached',
      source: 'rupay_portal',
      detail: 'Maximum uses exhausted on this card number',
    });

    // The portal will not serve it, so the worker must not try again.
    expect(await findCandidatesForAccount(db, accountId, today)).toBeNull();

    // The workflow status is untouched: the benefit was never ordered.
    const [row] = await db
      .select()
      .from(benefitInstances)
      .where(eq(benefitInstances.id, instanceId));
    expect(row.orderStatus).toBe('Not Ordered');
    expect(row.portalRefusal).toBe('card_limit_reached');
    expect(row.portalRefusalSource).toBe('rupay_portal');
    expect(row.portalRefusalDetail).toBe('Maximum uses exhausted on this card number');
    expect(row.portalRefusalAt).toBeTruthy();

    // The user can overrule the portal and have it tried again.
    const view = await dismissPortalRefusal(ctx, instanceId);
    expect(view.portalRefusal).toBeNull();
    expect(view.portalRefusalDetail).toBeNull();

    const after = await findCandidatesForAccount(db, accountId, today);
    expect(after?.instanceId).toBe(instanceId);
  });

  it('records a benefit that is not available for the card', async () => {
    await recordPortalRefusal(db, {
      instanceId,
      code: 'benefit_unavailable',
      source: 'bank',
      detail: 'Offer not available for this card',
    });

    const [row] = await db
      .select()
      .from(benefitInstances)
      .where(eq(benefitInstances.id, instanceId));
    expect(row.orderStatus).toBe('Not Ordered');
    expect(row.portalRefusal).toBe('benefit_unavailable');
    expect(row.portalRefusalSource).toBe('bank');
  });

  it('dismissing a refusal that is not there is a no-op', async () => {
    await dismissPortalRefusal(ctx, instanceId);
    const view = await dismissPortalRefusal(ctx, instanceId);
    expect(view.portalRefusal).toBeNull();
    expect(view.orderStatus).toBe('Not Ordered');
  });
});
