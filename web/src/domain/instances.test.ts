import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/test/db';
import {
  bankCardTypes, benefitCatalogVersions, benefitInstances, benefits,
  cardHolders, cards, workspaces,
} from '@/db/schema';
import { NotFoundError, type Ctx } from '@/lib/context';
import * as inst from './instances';

process.env.VOUCHER_ENCRYPTION_KEY = randomBytes(32).toString('base64');
const SECRET = 'SECRET-CODE-9f3a';

let db: Ctx['db'];
let close: () => Promise<void>;
let A: Ctx;
let B: Ctx;
let n = 0;

async function mkInstance(ctx: Ctx, cardId: string, typeId: string, benefitId: string, status = 'Not Ordered') {
  n += 1;
  const [row] = await db.insert(benefitInstances).values({
    workspaceId: ctx.workspaceId, cardId, bankCardTypeId: typeId, benefitId,
    periodStart: `2026-0${(n % 9) + 1}-01`, periodEnd: `2026-0${(n % 9) + 1}-28`,
    periodLabel: `2026-0${(n % 9) + 1}`, orderDeadline: `2026-0${(n % 9) + 1}-28`,
    orderStatus: status, instanceNumber: n,
  }).returning();
  return row.id;
}

let cardA: string, typeId: string, benefitId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [wa] = await db.insert(workspaces).values({ name: 'A' }).returning();
  const [wb] = await db.insert(workspaces).values({ name: 'B' }).returning();
  const mk = (w: string): Ctx => ({ userId: randomUUID(), workspaceId: w, role: 'admin', db, today: '2026-07-10' });
  A = mk(wa.id); B = mk(wb.id);
  const [t] = await db.insert(bankCardTypes).values({ displayName: 'X Y' }).returning();
  typeId = t.id;
  const [b] = await db.insert(benefits).values({ bankCardTypeId: typeId }).returning();
  benefitId = b.id;
  await db.insert(benefitCatalogVersions).values({
    benefitId, benefitType: 't', exactBenefit: 'e', frequency: 'Monthly', effectiveFrom: '2026-01-01',
  });
  const [h] = await db.insert(cardHolders).values({ workspaceId: wa.id, name: 'h' }).returning();
  const [c] = await db.insert(cards).values({
    workspaceId: wa.id, holderId: h.id, bankCardTypeId: typeId, displayName: 'c', trackingFrom: '2026-01-01',
  }).returning();
  cardA = c.id;
});
afterAll(() => close());

const fresh = (status = 'Not Ordered') => mkInstance(A, cardA, typeId, benefitId, status);

describe('tenant isolation (reveal-code first)', () => {
  it('workspace B cannot reveal workspace A code', async () => {
    const id = await fresh();
    await inst.setCode(A, { instanceId: id, code: SECRET });
    expect((await inst.revealCode(A, id))?.code).toBe(SECRET);
    const err = await inst.revealCode(B, id).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(String(err.message)).not.toContain(SECRET);
    // same error as a nonexistent id
    const missing = await inst.revealCode(B, randomUUID()).catch((e) => e);
    expect(missing.message).toBe(err.message);
  });

  it('workspace B cannot read or modify A instance by id with any function', async () => {
    const id = await fresh();
    const before = (await db.select().from(benefitInstances).where(eq(benefitInstances.id, id)))[0];
    const calls: Array<() => Promise<unknown>> = [
      () => inst.getInstance(B, id),
      () => inst.setStatus(B, { instanceId: id, status: 'Coupon Received' }),
      () => inst.skipInstance(B, id),
      () => inst.unskipInstance(B, id),
      () => inst.recordSale(B, { instanceId: id, soldFor: 5 }),
      () => inst.updateDetails(B, { instanceId: id, comments: 'x' }),
      () => inst.setCode(B, { instanceId: id, code: 'zzz' }),
    ];
    for (const c of calls) await expect(c()).rejects.toBeInstanceOf(NotFoundError);
    const after = (await db.select().from(benefitInstances).where(eq(benefitInstances.id, id)))[0];
    expect(after).toEqual(before);
  });

  it('ciphertext copied onto another instance does not decrypt', async () => {
    const a = await fresh();
    const b = await fresh();
    await inst.setCode(A, { instanceId: a, code: SECRET });
    const [src] = await db.select().from(benefitInstances).where(eq(benefitInstances.id, a));
    await db.update(benefitInstances).set({ codeEncrypted: src.codeEncrypted }).where(eq(benefitInstances.id, b));
    const err = await inst.revealCode(A, b).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String(err.message)).not.toContain(SECRET);
  });
});

describe('code handling', () => {
  it('stores only ciphertext, exposes hasCode, splits number/PIN on a space', async () => {
    const id = await fresh();
    const v = await inst.setCode(A, { instanceId: id, code: '1234567890 4321' });
    expect(v.hasCode).toBe(true);
    expect(JSON.stringify(v)).not.toContain('1234567890');
    const [row] = await db.select().from(benefitInstances).where(eq(benefitInstances.id, id));
    expect(row.codeEncrypted).toMatch(/^v1\./);
    expect(row.codeEncrypted).not.toContain('1234567890');
    expect(await inst.revealCode(A, id)).toEqual({ code: '1234567890 4321', number: '1234567890', pin: '4321' });
  });
  it('single token has no split; no code returns null; clearing works', async () => {
    const id = await fresh();
    expect(await inst.revealCode(A, id)).toBeNull();
    await inst.setCode(A, { instanceId: id, code: 'ABC' });
    expect(await inst.revealCode(A, id)).toEqual({ code: 'ABC' });
    await inst.setCode(A, { instanceId: id, code: null });
    expect(await inst.revealCode(A, id)).toBeNull();
  });
  it('updates updated_at', async () => {
    const id = await fresh();
    const [r0] = await db.select().from(benefitInstances).where(eq(benefitInstances.id, id));
    await new Promise((r) => setTimeout(r, 15));
    await inst.updateDetails(A, { instanceId: id, comments: 'hi' });
    const [r1] = await db.select().from(benefitInstances).where(eq(benefitInstances.id, id));
    expect(r1.updatedAt!.getTime()).toBeGreaterThan(r0.updatedAt!.getTime());
  });
});

describe('transitions', () => {
  it('moves forward, jumps, and backward', async () => {
    const id = await fresh();
    for (const s of ['Ordered but Coupon not received', 'Coupon Received', 'Coupon Redeemed', 'Coupon Received', 'Not Ordered', 'Coupon Redeemed'] as const) {
      expect((await inst.setStatus(A, { instanceId: id, status: s })).orderStatus).toBe(s);
    }
  });
  it('skip/unskip round trip stores Skipped', async () => {
    const id = await fresh();
    expect((await inst.skipInstance(A, id)).orderStatus).toBe('Skipped');
    expect((await inst.unskipInstance(A, id)).orderStatus).toBe('Not Ordered');
  });
  it('illegal: skip an ordered instance; leave Skipped other than to Not Ordered; unskip non-skipped', async () => {
    const o = await fresh('Coupon Received');
    await expect(inst.skipInstance(A, o)).rejects.toBeInstanceOf(inst.InstanceStateError);
    const s = await fresh('Skipped');
    await expect(inst.setStatus(A, { instanceId: s, status: 'Coupon Received' })).rejects.toBeInstanceOf(inst.InstanceStateError);
    await expect(inst.unskipInstance(A, o)).rejects.toBeInstanceOf(inst.InstanceStateError);
  });
  it('Withdrawn cannot be set, cleared, or edited', async () => {
    const nid = await fresh();
    await expect(inst.setStatus(A, { instanceId: nid, status: 'Withdrawn' })).rejects.toBeInstanceOf(inst.InstanceStateError);
    const w = await fresh('Withdrawn');
    for (const s of ['Not Ordered', 'Skipped', 'Coupon Received'] as const) {
      await expect(inst.setStatus(A, { instanceId: w, status: s })).rejects.toBeInstanceOf(inst.InstanceStateError);
    }
    await expect(inst.unskipInstance(A, w)).rejects.toBeInstanceOf(inst.InstanceStateError);
    await expect(inst.recordSale(A, { instanceId: w, soldFor: 1 })).rejects.toBeInstanceOf(inst.InstanceStateError);
    await expect(inst.setCode(A, { instanceId: w, code: 'x' })).rejects.toBeInstanceOf(inst.InstanceStateError);
    await expect(inst.updateDetails(A, { instanceId: w, comments: 'x' })).rejects.toBeInstanceOf(inst.InstanceStateError);
    expect((await inst.getInstance(A, w)).orderStatus).toBe('Withdrawn');
  });
  it('same status is a no-op; invalid status string rejected by zod', async () => {
    const id = await fresh();
    expect((await inst.setStatus(A, { instanceId: id, status: 'Not Ordered' })).orderStatus).toBe('Not Ordered');
    await expect(inst.setStatus(A, { instanceId: id, status: 'Bogus' as never })).rejects.toThrow();
  });
});

describe('sale and details', () => {
  it('records sold_for without changing status; clears with null', async () => {
    const id = await fresh('Coupon Received');
    const v = await inst.recordSale(A, { instanceId: id, soldFor: 450.5 });
    expect(v.soldFor).toBe('450.50');
    expect(v.orderStatus).toBe('Coupon Received');
    expect((await inst.recordSale(A, { instanceId: id, soldFor: null })).soldFor).toBeNull();
  });
  it('cannot sell a Skipped instance; rejects negative amounts', async () => {
    const s = await fresh('Skipped');
    await expect(inst.recordSale(A, { instanceId: s, soldFor: 1 })).rejects.toBeInstanceOf(inst.InstanceStateError);
    const id = await fresh();
    await expect(inst.recordSale(A, { instanceId: id, soldFor: -1 })).rejects.toThrow();
  });
  it('sets details, leaves omitted fields, validates dates', async () => {
    const id = await fresh();
    const v = await inst.updateDetails(A, {
      instanceId: id, orderDate: '2026-07-01', expiryDate: '2026-08-01', cashValue: 500, rupayBookingId: 'BK1', comments: 'c',
    });
    expect(v).toMatchObject({ orderDate: '2026-07-01', expiryDate: '2026-08-01', cashValue: '500.00', rupayBookingId: 'BK1', comments: 'c' });
    const v2 = await inst.updateDetails(A, { instanceId: id, comments: null });
    expect(v2.comments).toBeNull();
    expect(v2.rupayBookingId).toBe('BK1');
    await expect(inst.updateDetails(A, { instanceId: id, expiryDate: '2026-06-01' })).rejects.toBeInstanceOf(inst.InstanceStateError);
    await expect(inst.updateDetails(A, { instanceId: id, orderDate: '2026-02-30' })).rejects.toThrow();
    await expect(inst.updateDetails(A, { instanceId: id, workspaceId: 'x' } as never)).rejects.toThrow();
  });
});
