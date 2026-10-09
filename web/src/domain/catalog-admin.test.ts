import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@/test/db';
import {
  bankCardTypes, benefitCatalogVersions, benefitInstances, benefits,
  cardHolders, cards, systemAdmins, workspaces,
} from '@/db/schema';
import { AuthzError, NotFoundError, type Ctx } from '@/lib/context';
import * as cat from './catalog-admin';

let db: Ctx['db'];
let close: () => Promise<void>;
let admin: Ctx;
let user: Ctx; // workspace 'admin' role but NOT a system admin
let typeId: string;

const base = { benefitType: 'Voucher', exactBenefit: 'Big Basket', instanceCount: 2, frequency: 'Quarterly' as const, effectiveFrom: '2026-01-01' };
const versionsOf = (bid: string) => db.select().from(benefitCatalogVersions).where(eq(benefitCatalogVersions.benefitId, bid)).orderBy(benefitCatalogVersions.effectiveFrom);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const [w] = await db.insert(workspaces).values({ name: 'A' }).returning();
  admin = { userId: randomUUID(), workspaceId: w.id, role: 'member', db, today: '2026-07-10' };
  user = { userId: randomUUID(), workspaceId: w.id, role: 'admin', db, today: '2026-07-10' };
  await db.insert(systemAdmins).values({ userId: admin.userId });
  const [t] = await db.insert(bankCardTypes).values({ displayName: 'X Y' }).returning();
  typeId = t.id;
});
afterAll(() => close());

describe('non-admin gets AuthzError on every function', () => {
  it('rejects all', async () => {
    const id = randomUUID();
    const calls: Array<() => Promise<unknown>> = [
      () => cat.createBenefit(user, { ...base, bankCardTypeId: typeId }),
      () => cat.correctVersion(user, { versionId: id, exactBenefit: 'x' }),
      () => cat.createVersion(user, { benefitId: id, effectiveFrom: '2026-09-01' }),
      () => cat.changeFrequency(user, { benefitId: id, newFrequency: 'Monthly', effectiveFrom: '2026-09-01' }),
      () => cat.closeVersion(user, { versionId: id, effectiveTo: '2026-09-01' }),
      () => cat.setCurationStatus(user, { bankCardTypeId: typeId, curationStatus: 'curated' }),
    ];
    for (const c of calls) await expect(c()).rejects.toBeInstanceOf(AuthzError);
    expect((await db.select().from(benefits)).length).toBe(0);
    const [t] = await db.select().from(bankCardTypes);
    expect(t.curationStatus).toBe('uncurated');
  });
  it('workspace admin role alone does not grant access (invalid input still AuthzError first)', async () => {
    await expect(cat.createBenefit(user, {} as never)).rejects.toBeInstanceOf(AuthzError);
  });
});

describe('admin curation', () => {
  it('creates benefit + first version', async () => {
    const { benefitId, versionId } = await cat.createBenefit(admin, { ...base, bankCardTypeId: typeId, defaultCashValue: 500 });
    const [v] = await versionsOf(benefitId);
    expect(v).toMatchObject({ id: versionId, effectiveTo: null, defaultCashValue: '500.00', frequency: 'Quarterly' });
    await expect(cat.createBenefit(admin, { ...base, bankCardTypeId: randomUUID() })).rejects.toBeInstanceOf(NotFoundError);
    await expect(cat.createBenefit(admin, { ...base, bankCardTypeId: typeId, frequency: 'Weekly' as never })).rejects.toThrow();
  });

  it('correction updates in place; no new rows', async () => {
    const { benefitId, versionId } = await cat.createBenefit(admin, { ...base, bankCardTypeId: typeId });
    const row = await cat.correctVersion(admin, { versionId, exactBenefit: 'BigBasket' });
    expect(row.exactBenefit).toBe('BigBasket');
    expect((await versionsOf(benefitId)).length).toBe(1);
  });

  it('frequency edit via correction is rejected unless explicitly marked', async () => {
    const { benefitId, versionId } = await cat.createBenefit(admin, { ...base, bankCardTypeId: typeId });
    await expect(cat.correctVersion(admin, { versionId, frequency: 'Monthly' })).rejects.toBeInstanceOf(cat.CatalogRuleError);
    await expect(cat.correctVersion(admin, { versionId, frequency: 'Monthly', correctsErroneousFrequency: false as never })).rejects.toThrow();
    expect((await versionsOf(benefitId))[0].frequency).toBe('Quarterly');
    const ok = await cat.correctVersion(admin, { versionId, frequency: 'Monthly', correctsErroneousFrequency: true });
    expect(ok.frequency).toBe('Monthly');
  });

  it('marked frequency correction is refused once instances exist', async () => {
    const { benefitId, versionId } = await cat.createBenefit(admin, { ...base, bankCardTypeId: typeId });
    const [w] = await db.select().from(workspaces).limit(1);
    const [h] = await db.insert(cardHolders).values({ workspaceId: w.id, name: 'h' }).returning();
    const [c] = await db.insert(cards).values({ workspaceId: w.id, holderId: h.id, bankCardTypeId: typeId, displayName: 'c', trackingFrom: '2026-01-01' }).returning();
    await db.insert(benefitInstances).values({
      workspaceId: w.id, cardId: c.id, bankCardTypeId: typeId, benefitId,
      periodStart: '2026-07-01', periodEnd: '2026-09-30', periodLabel: '2026-Q3', orderDeadline: '2026-09-30',
    });
    await expect(cat.correctVersion(admin, { versionId, frequency: 'Monthly', correctsErroneousFrequency: true })).rejects.toBeInstanceOf(cat.CatalogRuleError);
  });

  it('real change closes current version and opens a new one under the same benefit_id', async () => {
    const { benefitId, versionId } = await cat.createBenefit(admin, { ...base, bankCardTypeId: typeId });
    const r = await cat.createVersion(admin, { benefitId, effectiveFrom: '2026-07-01', instanceCount: 3 });
    const vs = await versionsOf(benefitId);
    expect(vs.length).toBe(2);
    expect(vs[0]).toMatchObject({ id: versionId, effectiveTo: '2026-06-30' });
    expect(vs[1]).toMatchObject({ id: r.versionId, effectiveTo: null, instanceCount: 3, frequency: 'Quarterly', exactBenefit: 'Big Basket' });
    expect((await db.select().from(benefits).where(eq(benefits.bankCardTypeId, typeId))).filter((b) => b.id === benefitId).length).toBe(1);
  });

  it('rejects a new version that does not start after the current one, and frequency smuggling', async () => {
    const { benefitId } = await cat.createBenefit(admin, { ...base, bankCardTypeId: typeId });
    await expect(cat.createVersion(admin, { benefitId, effectiveFrom: '2026-01-01' })).rejects.toBeInstanceOf(cat.CatalogRuleError);
    await expect(cat.createVersion(admin, { benefitId, effectiveFrom: '2025-06-01' })).rejects.toBeInstanceOf(cat.CatalogRuleError);
    await expect(cat.createVersion(admin, { benefitId, effectiveFrom: '2026-07-01', frequency: 'Monthly' } as never)).rejects.toThrow();
    await expect(cat.createVersion(admin, { benefitId: randomUUID(), effectiveFrom: '2026-07-01' })).rejects.toBeInstanceOf(NotFoundError);
    expect((await versionsOf(benefitId)).length).toBe(1);
  });

  it('frequency change forks a NEW benefits row, never a new version of the old', async () => {
    const { benefitId, versionId } = await cat.createBenefit(admin, { ...base, bankCardTypeId: typeId });
    const r = await cat.changeFrequency(admin, { benefitId, newFrequency: 'Monthly', effectiveFrom: '2026-08-01' });
    expect(r.newBenefitId).not.toBe(benefitId);
    const old = await versionsOf(benefitId);
    expect(old.length).toBe(1);
    expect(old[0]).toMatchObject({ id: versionId, effectiveTo: '2026-07-31', frequency: 'Quarterly' });
    const nv = await versionsOf(r.newBenefitId);
    expect(nv.length).toBe(1);
    expect(nv[0]).toMatchObject({ id: r.versionId, frequency: 'Monthly', effectiveFrom: '2026-08-01', effectiveTo: null, exactBenefit: 'Big Basket' });
    const [nb] = await db.select().from(benefits).where(eq(benefits.id, r.newBenefitId));
    expect(nb.bankCardTypeId).toBe(typeId);
  });

  it('frequency change with an unchanged frequency is rejected and writes nothing', async () => {
    const { benefitId } = await cat.createBenefit(admin, { ...base, bankCardTypeId: typeId });
    const before = (await db.select().from(benefits)).length;
    await expect(cat.changeFrequency(admin, { benefitId, newFrequency: 'Quarterly', effectiveFrom: '2026-08-01' })).rejects.toBeInstanceOf(cat.CatalogRuleError);
    expect((await db.select().from(benefits)).length).toBe(before);
    expect((await versionsOf(benefitId))[0].effectiveTo).toBeNull();
  });

  it('closeVersion sets effective_to once', async () => {
    const { versionId } = await cat.createBenefit(admin, { ...base, bankCardTypeId: typeId });
    expect((await cat.closeVersion(admin, { versionId, effectiveTo: '2026-12-31' })).effectiveTo).toBe('2026-12-31');
    await expect(cat.closeVersion(admin, { versionId, effectiveTo: '2026-12-31' })).rejects.toBeInstanceOf(cat.CatalogRuleError);
  });

  it('sets curation status; rejects bad values and unknown ids', async () => {
    expect((await cat.setCurationStatus(admin, { bankCardTypeId: typeId, curationStatus: 'curated' })).curationStatus).toBe('curated');
    await expect(cat.setCurationStatus(admin, { bankCardTypeId: typeId, curationStatus: 'bogus' as never })).rejects.toThrow();
    await expect(cat.setCurationStatus(admin, { bankCardTypeId: randomUUID(), curationStatus: 'curated' })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('variants and card lists', () => {
  it('non-admin is rejected', async () => {
    const id = randomUUID();
    await expect(cat.listCatalogForAdmin(user)).rejects.toBeInstanceOf(AuthzError);
    await expect(cat.createVariant(user, { name: 'Z' })).rejects.toBeInstanceOf(AuthzError);
    await expect(cat.updateVariant(user, { id, active: false })).rejects.toBeInstanceOf(AuthzError);
    await expect(cat.addCardTypes(user, { variantId: id, text: 'A' })).rejects.toBeInstanceOf(AuthzError);
    await expect(cat.updateCardType(user, { id, active: false })).rejects.toBeInstanceOf(AuthzError);
  });

  it('migration seeds the two Select variants; duplicate names are refused', async () => {
    const { variants } = await cat.listCatalogForAdmin(admin);
    expect(variants.map((v) => v.name)).toEqual(['RuPay Select Debit Card', 'RuPay Select Credit Card']);
    await expect(cat.createVariant(admin, { name: 'RuPay Select Debit Card' })).rejects.toBeInstanceOf(cat.CatalogRuleError);
    const { id } = await cat.createVariant(admin, { name: 'RuPay Platinum Debit Card' });
    expect(id).toBeTruthy();
  });

  it('bulk add cleans the list and re-running skips what exists', async () => {
    const { variants } = await cat.listCatalogForAdmin(admin);
    const debit = variants.find((v) => v.name === 'RuPay Select Debit Card')!;
    const text = 'Punjab &amp; Sind Bank RuPay Select Card\n  HDFC Bank RuPay Select Card \n\nhdfc bank rupay select card\n';
    expect(await cat.addCardTypes(admin, { variantId: debit.id, text })).toEqual({ added: 2, skipped: 0, tooLong: [] });
    expect(await cat.addCardTypes(admin, { variantId: debit.id, text })).toEqual({ added: 0, skipped: 2, tooLong: [] });
    const { types } = await cat.listCatalogForAdmin(admin);
    expect(types.filter((t) => t.variantId === debit.id).map((t) => t.displayName).sort()).toEqual([
      'HDFC Bank RuPay Select Card',
      'Punjab & Sind Bank RuPay Select Card',
    ]);
    await expect(cat.addCardTypes(admin, { variantId: randomUUID(), text: 'A' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('same name may exist under two variants; rename collision inside one variant is refused', async () => {
    const { variants, types } = await cat.listCatalogForAdmin(admin);
    const credit = variants.find((v) => v.name === 'RuPay Select Credit Card')!;
    await cat.addCardTypes(admin, { variantId: credit.id, text: 'HDFC Bank RuPay Select Card' });
    const fresh = (await cat.listCatalogForAdmin(admin)).types;
    expect(fresh.filter((t) => t.displayName === 'HDFC Bank RuPay Select Card')).toHaveLength(2);
    const debitHdfc = types.find((t) => t.displayName === 'HDFC Bank RuPay Select Card')!;
    await expect(cat.updateCardType(admin, { id: debitHdfc.id, displayName: 'Punjab & Sind Bank RuPay Select Card' })).rejects.toBeInstanceOf(cat.CatalogRuleError);
  });

  it('hiding a card removes it from the picker list only', async () => {
    const wd = await import('./workspace-data');
    const { types } = await cat.listCatalogForAdmin(admin);
    const t = types.find((x) => x.displayName === 'HDFC Bank RuPay Select Card')!;
    await cat.updateCardType(admin, { id: t.id, active: false });
    const picker = await wd.listBankCardTypes(admin);
    expect(picker.find((x) => x.id === t.id)?.active).toBe(false);
    await expect(cat.updateCardType(admin, { id: randomUUID(), active: true })).rejects.toBeInstanceOf(NotFoundError);
    await expect(cat.updateCardType(admin, { id: t.id })).rejects.toBeInstanceOf(cat.CatalogRuleError);
  });
});
