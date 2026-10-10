import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createTestDb } from '@/test/db';
import { bankCardTypes, benefits, cardBenefitOverrides, cards, cardHolders, workspaces } from '@/db/schema';
import { NotFoundError, type Ctx, type Database } from '@/lib/context';
import * as d from './workspace-data';

let db: Database;
let close: () => Promise<void>;
let A: Ctx, B: Ctx;
let typeX: string, typeY: string, benX: string, benY: string;
let holderA: string, holderB: string, cardA: string, cardB: string, ovA: string, ovB: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [wa, wb] = await db.insert(workspaces).values([{ name: 'A' }, { name: 'B' }]).returning();
  const mk = (w: string): Ctx => ({ userId: crypto.randomUUID(), workspaceId: w, role: 'admin', db, today: '2026-10-09' });
  A = mk(wa.id);
  B = mk(wb.id);
  const [tx, ty] = await db
    .insert(bankCardTypes)
    .values([
      { displayName: 'PNB Select', curationStatus: 'curated' },
      { displayName: 'BoB Eterna' },
    ])
    .returning();
  typeX = tx.id;
  typeY = ty.id;
  const [bx, by] = await db
    .insert(benefits)
    .values([{ bankCardTypeId: typeX }, { bankCardTypeId: typeY }])
    .returning();
  benX = bx.id;
  benY = by.id;
  holderA = (await d.createHolder(A, { name: 'Papa' })).id;
  holderB = (await d.createHolder(B, { name: 'Papa' })).id; // same name in another workspace is fine
  cardA = (await d.createCard(A, { holderId: holderA, bankCardTypeId: typeX, displayName: 'c', lastDigits: '1111' })).id;
  cardB = (await d.createCard(B, { holderId: holderB, bankCardTypeId: typeX, displayName: 'c', lastDigits: '1111' })).id;
  ovA = (await d.createOverride(A, { kind: 'suppress', cardId: cardA, benefitId: benX })).id;
  ovB = (await d.createOverride(B, { kind: 'suppress', cardId: cardB, benefitId: benX })).id;
});
afterAll(() => close());

const rejectsNotFound = (p: Promise<unknown>) => expect(p).rejects.toBeInstanceOf(NotFoundError);

describe('holders', () => {
  it('CRUD within workspace; duplicate name conflicts', async () => {
    const h = await d.createHolder(A, { name: 'Mummy', email: '' });
    expect(h.email).toBeNull();
    await expect(d.createHolder(A, { name: 'Mummy' })).rejects.toBeInstanceOf(d.ConflictError);
    expect((await d.updateHolder(A, { id: h.id, active: false })).active).toBe(false);
    await d.deleteHolder(A, { id: h.id });
    await rejectsNotFound(d.getHolder(A, { id: h.id }));
  });
  it('rejects workspaceId in input and bad input', async () => {
    await expect(d.createHolder(A, { name: 'x', workspaceId: B.workspaceId })).rejects.toBeInstanceOf(d.ValidationError);
    await expect(d.createHolder(A, { name: '  ' })).rejects.toBeInstanceOf(d.ValidationError);
  });
  it('isolation: list/get/update/delete', async () => {
    expect((await d.listHolders(A)).map((h) => h.id)).toEqual(expect.not.arrayContaining([holderB]));
    await rejectsNotFound(d.getHolder(A, { id: holderB }));
    await rejectsNotFound(d.updateHolder(A, { id: holderB, name: 'hacked' }));
    await rejectsNotFound(d.deleteHolder(A, { id: holderB }));
    expect((await d.getHolder(B, { id: holderB })).name).toBe('Papa');
  });
  it('cannot delete holder with cards', async () => {
    await expect(d.deleteHolder(A, { id: holderA })).rejects.toBeInstanceOf(d.ConflictError);
  });
});

describe('cards', () => {
  it('tracking_from defaults to ctx.today and may be backdated', async () => {
    const c = await d.createCard(A, { holderId: holderA, bankCardTypeId: typeY, displayName: 'default', lastDigits: '2222' });
    expect(c.trackingFrom).toBe('2026-10-09');
    const b = await d.createCard(A, { holderId: holderA, bankCardTypeId: typeY, displayName: 'back', trackingFrom: '2026-01-15', lastDigits: '3333' });
    expect(b.trackingFrom).toBe('2026-01-15');
    await expect(d.createCard(A, { holderId: holderA, bankCardTypeId: typeY, displayName: 'bad', trackingFrom: '2026-02-30', lastDigits: '4444' })).rejects.toBeInstanceOf(d.ValidationError);
  });
  it('requires exactly 4 digits for lastDigits', async () => {
    await expect(
      d.createCard(A, { holderId: holderA, bankCardTypeId: typeY, displayName: 'no-digits' } as unknown),
    ).rejects.toBeInstanceOf(d.ValidationError);
    await expect(d.createCard(A, { holderId: holderA, bankCardTypeId: typeY, displayName: 'bad-digits', lastDigits: '123' })).rejects.toBeInstanceOf(d.ValidationError);
    await expect(d.createCard(A, { holderId: holderA, bankCardTypeId: typeY, displayName: 'bad-digits', lastDigits: '12345' })).rejects.toBeInstanceOf(d.ValidationError);
    await expect(d.createCard(A, { holderId: holderA, bankCardTypeId: typeY, displayName: 'bad-digits', lastDigits: 'abcd' })).rejects.toBeInstanceOf(d.ValidationError);
  });
  it('optional nickname falls back to bank card type name, and allows multiple cards of same type with different lastDigits', async () => {
    const created1 = await d.createCard(A, { holderId: holderA, bankCardTypeId: typeX, displayName: null, lastDigits: '5551' });
    expect(created1.displayName).toBe('PNB Select');
    expect(created1.lastDigits).toBe('5551');

    // A second card of the same type without nickname also falls back to bank card type name without conflict
    const created2 = await d.createCard(A, { holderId: holderA, bankCardTypeId: typeX, displayName: '', lastDigits: '5552' });
    expect(created2.displayName).toBe('PNB Select');
    expect(created2.lastDigits).toBe('5552');

    const nicknamed = await d.createCard(A, { holderId: holderA, bankCardTypeId: typeY, displayName: 'My Eterna', lastDigits: '6666' });
    expect(nicknamed.displayName).toBe('My Eterna');
    const cleared = await d.updateCard(A, { id: nicknamed.id, displayName: null });
    expect(cleared.displayName).toBe('BoB Eterna');

    // A second card of the same type also has its nickname removed to empty string without conflict
    const nicknamed2 = await d.createCard(A, { holderId: holderA, bankCardTypeId: typeY, displayName: 'My Other Eterna', lastDigits: '7777' });
    expect(nicknamed2.displayName).toBe('My Other Eterna');
    const cleared2 = await d.updateCard(A, { id: nicknamed2.id, displayName: '' });
    expect(cleared2.displayName).toBe('BoB Eterna');
  });
  it('bank_card_type_id is immutable with a clean error', async () => {
    await expect(d.updateCard(A, { id: cardA, bankCardTypeId: typeY })).rejects.toBeInstanceOf(d.ImmutableFieldError);
    expect((await d.updateCard(A, { id: cardA, bankCardTypeId: typeX, lastDigits: '1234' })).lastDigits).toBe('1234');
  });
  it('picker lists catalog with curation_status', async () => {
    const t = await d.listBankCardTypes(A);
    expect(t.find((x) => x.id === typeX)?.curationStatus).toBe('curated');
    expect(t.find((x) => x.id === typeY)?.curationStatus).toBe('uncurated');
  });
  it('isolation: list/get/update/delete', async () => {
    expect((await d.listCards(A)).map((c) => c.id)).not.toContain(cardB);
    expect(await d.listCards(A, { holderId: holderB })).toEqual([]);
    await rejectsNotFound(d.getCard(A, { id: cardB }));
    await rejectsNotFound(d.updateCard(A, { id: cardB, displayName: 'hacked' }));
    await rejectsNotFound(d.deleteCard(A, { id: cardB }));
  });
  it('cannot attach A card to B holder (app + DB composite FK)', async () => {
    await rejectsNotFound(d.createCard(A, { holderId: holderB, bankCardTypeId: typeX, displayName: 'x', lastDigits: '7777' }));
    await rejectsNotFound(d.updateCard(A, { id: cardA, holderId: holderB }));
    await expect(
      db.insert(cards).values({ workspaceId: A.workspaceId, holderId: holderB, bankCardTypeId: typeX, displayName: 'raw' }),
    ).rejects.toThrow();
    await expect(
      db.update(cards).set({ holderId: holderB }).where(eq0(cardA)),
    ).rejects.toThrow();
  });
  it('cannot delete card with overrides', async () => {
    await expect(d.deleteCard(A, { id: cardA })).rejects.toBeInstanceOf(d.ConflictError);
  });
});

import { eq } from 'drizzle-orm';
const eq0 = (id: string) => eq(cards.id, id);

describe('overrides', () => {
  it('suppress copies card type server-side, ignoring input', async () => {
    await expect(d.createOverride(A, { kind: 'suppress', cardId: cardA, benefitId: benY, bankCardTypeId: typeY })).rejects.toBeInstanceOf(d.ValidationError);
    const o = await d.getOverride(A, { id: ovA });
    expect(o.bankCardTypeId).toBe(typeX);
    expect(o.kind).toBe('suppress');
  });
  it('suppress of another card type\'s benefit is rejected (app + DB)', async () => {
    await expect(d.createOverride(A, { kind: 'suppress', cardId: cardA, benefitId: benY })).rejects.toBeInstanceOf(d.ValidationError);
    await expect(
      db.insert(cardBenefitOverrides).values({ workspaceId: A.workspaceId, cardId: cardA, bankCardTypeId: typeX, kind: 'suppress', benefitId: benY }),
    ).rejects.toThrow();
    await expect(
      db.insert(cardBenefitOverrides).values({ workspaceId: A.workspaceId, cardId: cardA, bankCardTypeId: typeY, kind: 'suppress', benefitId: benY }),
    ).rejects.toThrow();
  });
  it('add requires instance_count; toggle; duplicates conflict', async () => {
    const base = { kind: 'add', cardId: cardA, benefitType: 'Movie', exactBenefit: '1 ticket', frequency: 'Monthly' };
    await expect(d.createOverride(A, base)).rejects.toBeInstanceOf(d.ValidationError);
    await expect(d.createOverride(A, { ...base, instanceCount: 0 })).rejects.toBeInstanceOf(d.ValidationError);
    const o = await d.createOverride(A, { ...base, instanceCount: 2, defaultCashValue: 150 });
    expect(o.bankCardTypeId).toBe(typeX);
    expect(o.defaultCashValue).toBe('150.00');
    await expect(d.createOverride(A, { ...base, instanceCount: 3 })).rejects.toBeInstanceOf(d.ConflictError);
    expect((await d.setOverrideActive(A, { id: o.id, active: false })).active).toBe(false);
    expect((await d.setOverrideActive(A, { id: o.id, active: true })).active).toBe(true);
    await d.deleteOverride(A, { id: o.id });
    await rejectsNotFound(d.getOverride(A, { id: o.id }));
  });
  it('isolation: list/get/create/update/toggle/delete', async () => {
    expect((await d.listOverrides(A)).map((o) => o.id)).not.toContain(ovB);
    expect(await d.listOverrides(A, { cardId: cardB })).toEqual([]);
    await rejectsNotFound(d.getOverride(A, { id: ovB }));
    await rejectsNotFound(d.updateOverride(A, { id: ovB, active: false }));
    await rejectsNotFound(d.setOverrideActive(A, { id: ovB, active: false }));
    await rejectsNotFound(d.deleteOverride(A, { id: ovB }));
    await rejectsNotFound(d.createOverride(A, { kind: 'suppress', cardId: cardB, benefitId: benX }));
    await rejectsNotFound(
      d.createOverride(A, { kind: 'add', cardId: cardB, benefitType: 't', exactBenefit: 'e', frequency: 'Annual', instanceCount: 1 }),
    );
    expect((await d.getOverride(B, { id: ovB })).active).toBe(true);
  });
  it('DB-level: override cannot reference another workspace\'s card', async () => {
    await expect(
      db.insert(cardBenefitOverrides).values({ workspaceId: A.workspaceId, cardId: cardB, bankCardTypeId: typeX, kind: 'add', benefitType: 't', exactBenefit: 'e', frequency: 'Annual', instanceCount: 1 }),
    ).rejects.toThrow();
  });
});

void cardHolders;
