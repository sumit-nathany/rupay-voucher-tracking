import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  bankCardTypes,
  benefitCatalogVersions,
  benefitInstances,
  benefitOptions,
  benefits,
  cardVariants,
  systemAdmins,
} from '@/db/schema';
import { AuthzError, NotFoundError, type Ctx } from '@/lib/context';
import { inferOfferKind, OFFER_KINDS, type OfferKind } from '@/domain/benefit-offer-kind';
import { parseCardList } from '@/lib/card-list';

// Admin-only curation of the shared catalog (PLAN.md Phase 3 / Database notes).
// Global tables: no workspace scoping applies; access is gated by system_admins
// membership, checked HERE from ctx.userId (never from workspace_members.role,
// never from caller input). Four distinct write paths:
//   createBenefit    new identity + first version
//   correctVersion   in-place UPDATE of a version (typo / always-wrong value)
//   createVersion    real change: close current version, open next (same benefit_id, same frequency)
//   changeFrequency  FORK: close old version AND new benefits row + first version
// plus closeVersion (bank drops a benefit) and setCurationStatus.

export class CatalogRuleError extends Error {}

export async function assertSystemAdmin(ctx: Ctx): Promise<void> {
  const [row] = await ctx.db
    .select({ id: systemAdmins.id })
    .from(systemAdmins)
    .where(eq(systemAdmins.userId, ctx.userId));
  if (!row) throw new AuthzError('System admin access required');
}

// ── validation ──────────────────────────────────────────────────────────────

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Not a real calendar date');
const frequency = z.enum(['Annual', '6 months', 'Quarterly', 'Monthly']);
const offerKind = z.enum(OFFER_KINDS);
const money = z.number().finite().min(0).max(99_999_999.99);
const text = (max = 500) => z.string().trim().min(1).max(max);

const details = {
  benefitType: text(100),
  benefitProvider: text(200).nullable().optional(),
  exactBenefit: text(1000),
  instanceCount: z.number().int().min(1).max(1000),
  defaultCashValue: money.nullable().optional(),
};

const createBenefitInput = z
  .object({
    bankCardTypeId: uuid,
    ...details,
    frequency,
    offerKind: offerKind.optional(),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable().optional(),
  })
  .strict();

const correctInput = z
  .object({
    versionId: uuid,
    benefitType: details.benefitType.optional(),
    benefitProvider: details.benefitProvider,
    exactBenefit: details.exactBenefit.optional(),
    instanceCount: details.instanceCount.optional(),
    defaultCashValue: details.defaultCashValue,
    offerKind: offerKind.optional(),
    frequency: frequency.optional(),
    // Must be literally true to change frequency in place (see correctVersion).
    correctsErroneousFrequency: z.literal(true).optional(),
  })
  .strict();

const newVersionInput = z
  .object({
    benefitId: uuid,
    effectiveFrom: isoDate,
    benefitType: details.benefitType.optional(),
    benefitProvider: details.benefitProvider,
    exactBenefit: details.exactBenefit.optional(),
    instanceCount: details.instanceCount.optional(),
    defaultCashValue: details.defaultCashValue,
    offerKind: offerKind.optional(),
  })
  .strict(); // no `frequency`: a frequency change is changeFrequency()

const forkInput = z
  .object({
    benefitId: uuid,
    newFrequency: frequency,
    effectiveFrom: isoDate,
    benefitType: details.benefitType.optional(),
    benefitProvider: details.benefitProvider,
    exactBenefit: details.exactBenefit.optional(),
    instanceCount: details.instanceCount.optional(),
    defaultCashValue: details.defaultCashValue,
    offerKind: offerKind.optional(),
  })
  .strict();

const closeInput = z.object({ versionId: uuid, effectiveTo: isoDate }).strict();
const curationInput = z
  .object({
    bankCardTypeId: uuid,
    curationStatus: z.enum(['uncurated', 'curated', 'no_benefits']),
  })
  .strict();

// ── helpers ─────────────────────────────────────────────────────────────────

type Version = typeof benefitCatalogVersions.$inferSelect;
type Tx = Parameters<Parameters<Ctx['db']['transaction']>[0]>[0];

const toMoney = (n: number | null | undefined) => (n == null ? null : n.toFixed(2));

function dayBefore(d: string): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}

/**
 * The version a real change supersedes: the benefit's open version
 * (effective_to NULL). The new window must start strictly after that version's
 * own start and after every other version's start, so windows never overlap.
 */
async function openVersionForSuccession(tx: Tx, benefitId: string, effectiveFrom: string) {
  const [benefit] = await tx.select().from(benefits).where(eq(benefits.id, benefitId));
  if (!benefit) throw new NotFoundError('Benefit not found');
  const open = await tx
    .select()
    .from(benefitCatalogVersions)
    .where(and(eq(benefitCatalogVersions.benefitId, benefitId), isNull(benefitCatalogVersions.effectiveTo)));
  if (open.length !== 1) {
    throw new CatalogRuleError('Benefit must have exactly one open (effective_to NULL) version');
  }
  const [later] = await tx
    .select({ id: benefitCatalogVersions.id })
    .from(benefitCatalogVersions)
    .where(
      and(
        eq(benefitCatalogVersions.benefitId, benefitId),
        gte(benefitCatalogVersions.effectiveFrom, effectiveFrom),
      ),
    );
  if (later || effectiveFrom <= open[0].effectiveFrom) {
    throw new CatalogRuleError('effective_from must be after the start of every existing version');
  }
  return { benefit, current: open[0] };
}

// ── actions ─────────────────────────────────────────────────────────────────

export async function createBenefit(
  ctx: Ctx,
  input: z.input<typeof createBenefitInput>,
): Promise<{ benefitId: string; versionId: string }> {
  await assertSystemAdmin(ctx);
  const p = createBenefitInput.parse(input);
  if (p.effectiveTo && p.effectiveTo < p.effectiveFrom) {
    throw new CatalogRuleError('effective_to cannot be before effective_from');
  }
  return ctx.db.transaction(async (tx) => {
    const [type] = await tx.select({ id: bankCardTypes.id }).from(bankCardTypes).where(eq(bankCardTypes.id, p.bankCardTypeId));
    if (!type) throw new NotFoundError('Bank card type not found');
    const [b] = await tx.insert(benefits).values({ bankCardTypeId: p.bankCardTypeId }).returning({ id: benefits.id });
    const [v] = await tx
      .insert(benefitCatalogVersions)
      .values({
        benefitId: b.id,
        benefitType: p.benefitType,
        benefitProvider: p.benefitProvider ?? null,
        exactBenefit: p.exactBenefit,
        frequency: p.frequency,
        instanceCount: p.instanceCount,
        defaultCashValue: toMoney(p.defaultCashValue),
        offerKind: p.offerKind ?? inferOfferKind(p.benefitType, p.benefitProvider ?? null, p.exactBenefit),
        effectiveFrom: p.effectiveFrom,
        effectiveTo: p.effectiveTo ?? null,
      })
      .returning({ id: benefitCatalogVersions.id });
    return { benefitId: b.id, versionId: v.id };
  });
}

/**
 * In-place UPDATE for a pure correction; takes effect immediately. Effective
 * dates are deliberately not editable here (a date change is a real change).
 * A frequency edit is rejected unless explicitly marked
 * `correctsErroneousFrequency: true`, and even then is refused once any
 * instance exists for the benefit, because periods are keyed by frequency and
 * existing instances would silently carry the wrong period structure.
 */
export async function correctVersion(
  ctx: Ctx,
  input: z.input<typeof correctInput>,
): Promise<Version> {
  await assertSystemAdmin(ctx);
  const p = correctInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const [cur] = await tx.select().from(benefitCatalogVersions).where(eq(benefitCatalogVersions.id, p.versionId));
    if (!cur) throw new NotFoundError('Version not found');
    const freqChanges = p.frequency !== undefined && p.frequency !== cur.frequency;
    if (freqChanges) {
      if (p.correctsErroneousFrequency !== true) {
        throw new CatalogRuleError(
          'Frequency cannot be edited as a correction unless marked correctsErroneousFrequency; a real frequency change must use changeFrequency (new benefit)',
        );
      }
      const [inst] = await tx
        .select({ id: benefitInstances.id })
        .from(benefitInstances)
        .where(eq(benefitInstances.benefitId, cur.benefitId))
        .limit(1);
      if (inst) {
        throw new CatalogRuleError(
          'Instances already exist for this benefit; frequency cannot be corrected in place',
        );
      }
    } else if (p.correctsErroneousFrequency === true && p.frequency === undefined) {
      throw new CatalogRuleError('correctsErroneousFrequency given without a frequency');
    }
    const patch: Partial<typeof benefitCatalogVersions.$inferInsert> = {};
    if (p.benefitType !== undefined) patch.benefitType = p.benefitType;
    if (p.benefitProvider !== undefined) patch.benefitProvider = p.benefitProvider;
    if (p.exactBenefit !== undefined) patch.exactBenefit = p.exactBenefit;
    if (p.instanceCount !== undefined) patch.instanceCount = p.instanceCount;
    if (p.defaultCashValue !== undefined) patch.defaultCashValue = toMoney(p.defaultCashValue);
    if (p.offerKind !== undefined) patch.offerKind = p.offerKind;
    if (freqChanges) patch.frequency = p.frequency;
    if (Object.keys(patch).length === 0) return cur;
    const [row] = await tx
      .update(benefitCatalogVersions)
      .set(patch)
      .where(eq(benefitCatalogVersions.id, p.versionId))
      .returning();
    return row;
  });
}

/** Real change, same frequency: close the open version the day before effectiveFrom, open the next under the same benefit_id. */
export async function createVersion(
  ctx: Ctx,
  input: z.input<typeof newVersionInput>,
): Promise<{ closedVersionId: string; versionId: string }> {
  await assertSystemAdmin(ctx);
  const p = newVersionInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const { current } = await openVersionForSuccession(tx, p.benefitId, p.effectiveFrom);
    await tx
      .update(benefitCatalogVersions)
      .set({ effectiveTo: dayBefore(p.effectiveFrom) })
      .where(eq(benefitCatalogVersions.id, current.id));
    const [v] = await tx
      .insert(benefitCatalogVersions)
      .values({
        benefitId: p.benefitId,
        benefitType: p.benefitType ?? current.benefitType,
        benefitProvider: p.benefitProvider === undefined ? current.benefitProvider : p.benefitProvider,
        exactBenefit: p.exactBenefit ?? current.exactBenefit,
        frequency: current.frequency,
        instanceCount: p.instanceCount ?? current.instanceCount,
        defaultCashValue: p.defaultCashValue === undefined ? current.defaultCashValue : toMoney(p.defaultCashValue),
        offerKind: p.offerKind ?? (current.offerKind as OfferKind),
        effectiveFrom: p.effectiveFrom,
        effectiveTo: null,
      })
      .returning({ id: benefitCatalogVersions.id });
    return { closedVersionId: current.id, versionId: v.id };
  });
}

/**
 * FREQUENCY CHANGE: close the old benefit's open version and create a NEW
 * benefits row (same bank_card_type_id) with its own first version. Never a new
 * version of the same benefit.
 */
export async function changeFrequency(
  ctx: Ctx,
  input: z.input<typeof forkInput>,
): Promise<{ closedVersionId: string; newBenefitId: string; versionId: string }> {
  await assertSystemAdmin(ctx);
  const p = forkInput.parse(input);
  return ctx.db.transaction(async (tx) => {
    const { benefit, current } = await openVersionForSuccession(tx, p.benefitId, p.effectiveFrom);
    if (p.newFrequency === current.frequency) {
      throw new CatalogRuleError('Frequency is unchanged; use createVersion for a non-frequency change');
    }
    await tx
      .update(benefitCatalogVersions)
      .set({ effectiveTo: dayBefore(p.effectiveFrom) })
      .where(eq(benefitCatalogVersions.id, current.id));
    const [nb] = await tx
      .insert(benefits)
      .values({ bankCardTypeId: benefit.bankCardTypeId })
      .returning({ id: benefits.id });
    const [v] = await tx
      .insert(benefitCatalogVersions)
      .values({
        benefitId: nb.id,
        benefitType: p.benefitType ?? current.benefitType,
        benefitProvider: p.benefitProvider === undefined ? current.benefitProvider : p.benefitProvider,
        exactBenefit: p.exactBenefit ?? current.exactBenefit,
        frequency: p.newFrequency,
        instanceCount: p.instanceCount ?? current.instanceCount,
        defaultCashValue: p.defaultCashValue === undefined ? current.defaultCashValue : toMoney(p.defaultCashValue),
        offerKind: p.offerKind ?? (current.offerKind as OfferKind),
        effectiveFrom: p.effectiveFrom,
        effectiveTo: null,
      })
      .returning({ id: benefitCatalogVersions.id });
    return { closedVersionId: current.id, newBenefitId: nb.id, versionId: v.id };
  });
}

/** Bank drops a benefit: close an open version's effective_to (no replacement). */
export async function closeVersion(ctx: Ctx, input: z.input<typeof closeInput>): Promise<Version> {
  await assertSystemAdmin(ctx);
  const p = closeInput.parse(input);
  const [cur] = await ctx.db.select().from(benefitCatalogVersions).where(eq(benefitCatalogVersions.id, p.versionId));
  if (!cur) throw new NotFoundError('Version not found');
  if (cur.effectiveTo !== null) throw new CatalogRuleError('Version is already closed');
  if (p.effectiveTo < cur.effectiveFrom) throw new CatalogRuleError('effective_to cannot be before effective_from');
  const [row] = await ctx.db
    .update(benefitCatalogVersions)
    .set({ effectiveTo: p.effectiveTo })
    .where(and(eq(benefitCatalogVersions.id, p.versionId), isNull(benefitCatalogVersions.effectiveTo)))
    .returning();
  if (!row) throw new CatalogRuleError('Version changed concurrently');
  return row;
}

export async function setCurationStatus(
  ctx: Ctx,
  input: z.input<typeof curationInput>,
): Promise<{ id: string; curationStatus: string }> {
  await assertSystemAdmin(ctx);
  const p = curationInput.parse(input);
  const [row] = await ctx.db
    .update(bankCardTypes)
    .set({ curationStatus: p.curationStatus })
    .where(eq(bankCardTypes.id, p.bankCardTypeId))
    .returning({ id: bankCardTypes.id, curationStatus: bankCardTypes.curationStatus });
  if (!row) throw new NotFoundError('Bank card type not found');
  return row;
}

// ── variants and card list (RuPay portal lists, managed from the admin page) ─

const variantCreateInput = z.object({ name: text(100) }).strict();
const variantUpdateInput = z
  .object({
    id: uuid,
    name: text(100).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    active: z.boolean().optional(),
  })
  .strict();
const cardTypesAddInput = z
  .object({ variantId: uuid, text: z.string().max(200_000) })
  .strict();
const cardTypeUpdateInput = z
  .object({
    id: uuid,
    displayName: text(200).optional(),
    variantId: uuid.optional(),
    active: z.boolean().optional(),
  })
  .strict();

const CARD_NAME_MAX = 200;

/** Postgres unique_violation, whether raised directly or wrapped by drizzle. */
function isUniqueViolation(e: unknown): boolean {
  const code = (x: unknown) => (x as { code?: string } | null)?.code;
  return code(e) === '23505' || code((e as { cause?: unknown } | null)?.cause) === '23505';
}

export async function listCatalogForAdmin(ctx: Ctx) {
  await assertSystemAdmin(ctx);
  const variants = await ctx.db
    .select()
    .from(cardVariants)
    .orderBy(asc(cardVariants.sortOrder), asc(cardVariants.name));
  const types = await ctx.db
    .select({
      id: bankCardTypes.id,
      displayName: bankCardTypes.displayName,
      variantId: bankCardTypes.variantId,
      active: bankCardTypes.active,
      curationStatus: bankCardTypes.curationStatus,
    })
    .from(bankCardTypes)
    .orderBy(asc(bankCardTypes.displayName));
  const benefitCounts = await ctx.db
    .select({
      bankCardTypeId: benefits.bankCardTypeId,
      count: sql<number>`count(*)::int`,
    })
    .from(benefits)
    .groupBy(benefits.bankCardTypeId);
  const benefitCountByTypeId = Object.fromEntries(
    benefitCounts.map((r) => [r.bankCardTypeId, r.count]),
  ) as Record<string, number>;
  return { variants, types, benefitCountByTypeId };
}

export interface CardTypeBenefitOption {
  provider: string;
  offerName: string;
  cashValue: string | null;
}

/** One row per stable benefit identity — display version is the open one, or the latest if all closed. */
export interface CardTypeBenefitRow {
  benefitId: string;
  versionId: string;
  benefitType: string;
  benefitProvider: string | null;
  exactBenefit: string;
  frequency: string;
  instanceCount: number;
  defaultCashValue: string | null;
  offerKind: OfferKind;
  effectiveFrom: string;
  effectiveTo: string | null;
  versionCount: number;
  options: CardTypeBenefitOption[];
}

const cardTypeIdInput = z.object({ bankCardTypeId: uuid }).strict();

type VersionSlice = {
  id: string;
  benefitId: string;
  benefitType: string;
  benefitProvider: string | null;
  exactBenefit: string;
  frequency: string;
  instanceCount: number;
  defaultCashValue: string | null;
  offerKind: string;
  effectiveFrom: string;
  effectiveTo: string | null;
};

function pickDisplayVersion(versions: VersionSlice[]): VersionSlice | null {
  if (versions.length === 0) return null;
  const open = versions.filter((v) => v.effectiveTo === null);
  const pool = open.length > 0 ? open : versions;
  return pool.reduce((best, v) => (v.effectiveFrom > best.effectiveFrom ? v : best));
}

export async function listCardTypeBenefits(
  ctx: Ctx,
  input: z.input<typeof cardTypeIdInput>,
): Promise<CardTypeBenefitRow[]> {
  await assertSystemAdmin(ctx);
  const { bankCardTypeId } = cardTypeIdInput.parse(input);
  const [type] = await ctx.db
    .select({ id: bankCardTypes.id })
    .from(bankCardTypes)
    .where(eq(bankCardTypes.id, bankCardTypeId));
  if (!type) throw new NotFoundError('Bank card type not found');

  const versionRows = await ctx.db
    .select({
      id: benefitCatalogVersions.id,
      benefitId: benefitCatalogVersions.benefitId,
      benefitType: benefitCatalogVersions.benefitType,
      benefitProvider: benefitCatalogVersions.benefitProvider,
      exactBenefit: benefitCatalogVersions.exactBenefit,
      frequency: benefitCatalogVersions.frequency,
      instanceCount: benefitCatalogVersions.instanceCount,
      defaultCashValue: benefitCatalogVersions.defaultCashValue,
      offerKind: benefitCatalogVersions.offerKind,
      effectiveFrom: benefitCatalogVersions.effectiveFrom,
      effectiveTo: benefitCatalogVersions.effectiveTo,
    })
    .from(benefitCatalogVersions)
    .innerJoin(benefits, eq(benefits.id, benefitCatalogVersions.benefitId))
    .where(eq(benefits.bankCardTypeId, bankCardTypeId))
    .orderBy(asc(benefitCatalogVersions.benefitType), asc(benefitCatalogVersions.exactBenefit));

  const byBenefit = new Map<string, VersionSlice[]>();
  for (const v of versionRows) {
    const list = byBenefit.get(v.benefitId) ?? [];
    list.push(v);
    byBenefit.set(v.benefitId, list);
  }

  const displayVersions = [...byBenefit.entries()]
    .map(([benefitId, versions]) => {
      const chosen = pickDisplayVersion(versions);
      return chosen ? { benefitId, chosen, versionCount: versions.length } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (displayVersions.length === 0) return [];

  const versionIds = displayVersions.map((d) => d.chosen.id);
  const optionRows = await ctx.db
    .select({
      versionId: benefitOptions.versionId,
      provider: benefitOptions.provider,
      offerName: benefitOptions.offerName,
      cashValue: benefitOptions.cashValue,
      sortOrder: benefitOptions.sortOrder,
    })
    .from(benefitOptions)
    .where(inArray(benefitOptions.versionId, versionIds))
    .orderBy(asc(benefitOptions.sortOrder), asc(benefitOptions.provider));

  const optionsByVersion = new Map<string, CardTypeBenefitOption[]>();
  for (const o of optionRows) {
    const list = optionsByVersion.get(o.versionId) ?? [];
    list.push({ provider: o.provider, offerName: o.offerName, cashValue: o.cashValue });
    optionsByVersion.set(o.versionId, list);
  }

  return displayVersions
    .map(({ benefitId, chosen, versionCount }) => ({
      benefitId,
      versionId: chosen.id,
      benefitType: chosen.benefitType,
      benefitProvider: chosen.benefitProvider,
      exactBenefit: chosen.exactBenefit,
      frequency: chosen.frequency,
      instanceCount: chosen.instanceCount,
      defaultCashValue: chosen.defaultCashValue,
      offerKind: chosen.offerKind as OfferKind,
      effectiveFrom: chosen.effectiveFrom,
      effectiveTo: chosen.effectiveTo,
      versionCount,
      options: optionsByVersion.get(chosen.id) ?? [],
    }))
    .sort((a, b) => {
      const t = a.benefitType.localeCompare(b.benefitType);
      if (t !== 0) return t;
      const p = (a.benefitProvider ?? '').localeCompare(b.benefitProvider ?? '');
      if (p !== 0) return p;
      return a.exactBenefit.localeCompare(b.exactBenefit);
    });
}

export async function createVariant(ctx: Ctx, input: z.input<typeof variantCreateInput>): Promise<{ id: string }> {
  await assertSystemAdmin(ctx);
  const p = variantCreateInput.parse(input);
  try {
    const [row] = await ctx.db
      .insert(cardVariants)
      .values({ name: p.name })
      .returning({ id: cardVariants.id });
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new CatalogRuleError(`A variant named "${p.name}" already exists`);
    throw e;
  }
}

export async function updateVariant(ctx: Ctx, input: z.input<typeof variantUpdateInput>): Promise<{ id: string }> {
  await assertSystemAdmin(ctx);
  const { id, ...patch } = variantUpdateInput.parse(input);
  if (Object.keys(patch).length === 0) throw new CatalogRuleError('Nothing to change');
  try {
    const [row] = await ctx.db
      .update(cardVariants)
      .set(patch)
      .where(eq(cardVariants.id, id))
      .returning({ id: cardVariants.id });
    if (!row) throw new NotFoundError('Variant not found');
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new CatalogRuleError('Another variant already has that name');
    throw e;
  }
}

/** Bulk add: one card name per line. Existing names in the variant are skipped, not duplicated. */
export async function addCardTypes(
  ctx: Ctx,
  input: z.input<typeof cardTypesAddInput>,
): Promise<{ added: number; skipped: number; tooLong: string[] }> {
  await assertSystemAdmin(ctx);
  const p = cardTypesAddInput.parse(input);
  const [variant] = await ctx.db.select({ id: cardVariants.id }).from(cardVariants).where(eq(cardVariants.id, p.variantId));
  if (!variant) throw new NotFoundError('Variant not found');

  const names = parseCardList(p.text);
  const tooLong = names.filter((n) => n.length > CARD_NAME_MAX);
  const ok = names.filter((n) => n.length <= CARD_NAME_MAX);
  if (ok.length === 0) return { added: 0, skipped: 0, tooLong };

  const inserted = await ctx.db
    .insert(bankCardTypes)
    .values(ok.map((displayName) => ({ displayName, variantId: p.variantId })))
    .onConflictDoNothing()
    .returning({ id: bankCardTypes.id });
  return { added: inserted.length, skipped: ok.length - inserted.length, tooLong };
}

/** Rename, move to another variant, or hide/show a card. Hiding keeps existing cards working. */
export async function updateCardType(ctx: Ctx, input: z.input<typeof cardTypeUpdateInput>): Promise<{ id: string }> {
  await assertSystemAdmin(ctx);
  const { id, ...patch } = cardTypeUpdateInput.parse(input);
  if (Object.keys(patch).length === 0) throw new CatalogRuleError('Nothing to change');
  if (patch.variantId) {
    const [v] = await ctx.db.select({ id: cardVariants.id }).from(cardVariants).where(eq(cardVariants.id, patch.variantId));
    if (!v) throw new NotFoundError('Variant not found');
  }
  try {
    const [row] = await ctx.db
      .update(bankCardTypes)
      .set(patch)
      .where(eq(bankCardTypes.id, id))
      .returning({ id: bankCardTypes.id });
    if (!row) throw new NotFoundError('Card not found');
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new CatalogRuleError('That variant already has a card with this name');
    throw e;
  }
}
