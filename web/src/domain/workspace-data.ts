/**
 * Workspace-scoped domain functions: holders, cards, card benefit overrides,
 * plus the read-only card-picker over the shared catalog.
 *
 * Every function is `(ctx, input)`. workspace_id ALWAYS comes from ctx; no
 * input schema has a workspaceId field (zod strips unknown keys, and the
 * schemas are .strict() so a stray one is rejected loudly). Every query,
 * reads included, filters on ctx.workspaceId.
 */
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  bankCardTypes,
  benefits,
  benefitInstances,
  cardBenefitOverrides,
  cardHolders,
  cardVariants,
  cards,
} from '@/db/schema';
import { NotFoundError, type Ctx } from '@/lib/context';
import { inferOfferKind } from '@/domain/benefit-offer-kind';
import {
  decryptPaymentDetails,
  encryptPaymentDetails,
  maskPaymentSummary,
} from '@/lib/card-payment-details';

export class ValidationError extends Error {}
export class ConflictError extends Error {}
export class ImmutableFieldError extends ValidationError {}

// ── helpers ─────────────────────────────────────────────────────────────────

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new ValidationError(r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '));
  }
  return r.data;
}

function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code ?? err?.cause?.code;
}

/** Map unique violations to a clean ConflictError; rethrow everything else. */
async function mapConflicts<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (pgCode(e) === '23505') throw new ConflictError(`${what} already exists`);
    throw e;
  }
}

const uuid = z.uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}, 'invalid calendar date');
const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) =>
  z.string().trim().max(max).transform((s) => (s === '' ? null : s)).nullable().optional();
const money = z
  .union([z.number(), z.string()])
  .transform((v) => String(v))
  .refine((s) => /^\d{1,8}(\.\d{1,2})?$/.test(s), 'expected non-negative amount with up to 2 decimals');
const frequency = z.enum(['Annual', '6 months', 'Quarterly', 'Monthly']);

// ── holders ─────────────────────────────────────────────────────────────────

const holderCreate = z.strictObject({
  name: trimmed(100),
  email: z.union([z.email(), z.literal('')]).transform((s) => s || null).nullable().optional(),
});
const holderUpdate = z.strictObject({
  id: uuid,
  name: trimmed(100).optional(),
  email: z.union([z.email(), z.literal('')]).transform((s) => s || null).nullable().optional(),
  active: z.boolean().optional(),
});
const idOnly = z.strictObject({ id: uuid });

export async function listHolders(ctx: Ctx) {
  return ctx.db
    .select()
    .from(cardHolders)
    .where(eq(cardHolders.workspaceId, ctx.workspaceId))
    .orderBy(asc(cardHolders.name));
}

export async function getHolder(ctx: Ctx, input: unknown) {
  const { id } = parse(idOnly, input);
  const [row] = await ctx.db
    .select()
    .from(cardHolders)
    .where(and(eq(cardHolders.workspaceId, ctx.workspaceId), eq(cardHolders.id, id)));
  if (!row) throw new NotFoundError('Holder not found');
  return row;
}

export async function createHolder(ctx: Ctx, input: unknown) {
  const v = parse(holderCreate, input);
  return mapConflicts('A holder with this name', async () => {
    const [row] = await ctx.db
      .insert(cardHolders)
      .values({ workspaceId: ctx.workspaceId, name: v.name, email: v.email ?? null })
      .returning();
    return row;
  });
}

export async function updateHolder(ctx: Ctx, input: unknown) {
  const { id, ...patch } = parse(holderUpdate, input);
  const set: Partial<typeof cardHolders.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.email !== undefined) set.email = patch.email;
  if (patch.active !== undefined) set.active = patch.active;
  if (Object.keys(set).length === 0) return getHolder(ctx, { id });
  return mapConflicts('A holder with this name', async () => {
    const [row] = await ctx.db
      .update(cardHolders)
      .set(set)
      .where(and(eq(cardHolders.workspaceId, ctx.workspaceId), eq(cardHolders.id, id)))
      .returning();
    if (!row) throw new NotFoundError('Holder not found');
    return row;
  });
}

/** Deletes only a holder with no cards; otherwise the user should deactivate. */
export async function deleteHolder(ctx: Ctx, input: unknown) {
  const { id } = parse(idOnly, input);
  await getHolder(ctx, { id });
  const [{ n }] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(cards)
    .where(and(eq(cards.workspaceId, ctx.workspaceId), eq(cards.holderId, id)));
  if (n > 0) throw new ConflictError('Holder still has cards; deactivate the holder instead of deleting');
  await ctx.db
    .delete(cardHolders)
    .where(and(eq(cardHolders.workspaceId, ctx.workspaceId), eq(cardHolders.id, id)));
  return { id };
}

// ── shared catalog read (card picker) ───────────────────────────────────────

/** Active card variants, in portal order, for the first step of the card picker. */
export async function listCardVariants(ctx: Ctx) {
  return ctx.db
    .select({ id: cardVariants.id, name: cardVariants.name })
    .from(cardVariants)
    .where(eq(cardVariants.active, true))
    .orderBy(asc(cardVariants.sortOrder), asc(cardVariants.name));
}

/**
 * All bank card types (hidden ones included, so existing cards still show their name;
 * callers filter on `active` for the picker). Global data.
 */
export async function listBankCardTypes(ctx: Ctx) {
  return ctx.db
    .select({
      id: bankCardTypes.id,
      displayName: bankCardTypes.displayName,
      variantId: bankCardTypes.variantId,
      active: bankCardTypes.active,
      network: bankCardTypes.network,
      curationStatus: bankCardTypes.curationStatus,
    })
    .from(bankCardTypes)
    .orderBy(asc(bankCardTypes.displayName));
}

// ── cards ───────────────────────────────────────────────────────────────────

/** Optional nickname; empty/missing falls back to the bank card type name at write time. */
const cardNickname = optText(100);

async function resolveCardDisplayName(
  ctx: Ctx,
  bankCardTypeId: string,
  nickname: string | null | undefined,
): Promise<string> {
  const clean = nickname?.trim();
  if (clean) return clean;
  const [type] = await ctx.db
    .select({ displayName: bankCardTypes.displayName })
    .from(bankCardTypes)
    .where(eq(bankCardTypes.id, bankCardTypeId));
  if (!type) throw new ValidationError('Unknown card type');
  return type.displayName;
}

const cardDigits = z.string().trim().regex(/^\d{4}$/, 'expected exactly 4 digits');

const paymentDetailsInput = z
  .object({
    version: z.literal(1).default(1),
    mode: z.enum(['full', 'saved_card']).default('full'),
    cardNumber: z.string().optional(),
    expiryMonth: z.string().optional(),
    expiryYear: z.string().optional(),
    cvv: z.string().optional(),
    nameOnCard: z.string().optional(),
  })
  .nullable()
  .optional();

const cardCreate = z.strictObject({
  holderId: uuid,
  bankCardTypeId: uuid,
  displayName: cardNickname,
  lastDigits: cardDigits.optional(),
  trackingFrom: dateStr.optional(),
  paymentDetails: paymentDetailsInput,
});
const cardUpdate = z.strictObject({
  id: uuid,
  // Accepted only so we can reject a change with a clean error.
  bankCardTypeId: uuid.optional(),
  holderId: uuid.optional(),
  displayName: cardNickname,
  lastDigits: cardDigits.optional(),
  trackingFrom: dateStr.optional(),
  active: z.boolean().optional(),
  inactiveFrom: dateStr.nullable().optional(),
  paymentDetails: paymentDetailsInput,
});
const cardList = z.strictObject({ holderId: uuid.optional() }).optional();

export async function listCards(ctx: Ctx, input?: unknown) {
  const f = parse(cardList, input);
  const rows = await ctx.db
    .select()
    .from(cards)
    .where(
      and(eq(cards.workspaceId, ctx.workspaceId), f?.holderId ? eq(cards.holderId, f.holderId) : undefined),
    )
    .orderBy(asc(cards.displayName));

  return rows.map((r) => {
    let paymentSummary = null;
    if (r.paymentDetailsEncrypted) {
      try {
        const decrypted = decryptPaymentDetails(r.paymentDetailsEncrypted, r.id);
        paymentSummary = maskPaymentSummary(decrypted);
      } catch {}
    }
    return {
      ...r,
      paymentSummary,
    };
  });
}

export async function getCard(ctx: Ctx, input: unknown) {
  const { id } = parse(idOnly, input);
  const [row] = await ctx.db
    .select()
    .from(cards)
    .where(and(eq(cards.workspaceId, ctx.workspaceId), eq(cards.id, id)));
  if (!row) throw new NotFoundError('Card not found');
  let paymentSummary = null;
  if (row.paymentDetailsEncrypted) {
    try {
      const decrypted = decryptPaymentDetails(row.paymentDetailsEncrypted, row.id);
      paymentSummary = maskPaymentSummary(decrypted);
    } catch {}
  }
  return {
    ...row,
    paymentSummary,
  };
}

export async function createCard(ctx: Ctx, input: unknown) {
  const v = parse(cardCreate, input);
  await getHolder(ctx, { id: v.holderId }); // same-workspace check (DB composite FK is the backstop)
  const [type] = await ctx.db
    .select({ id: bankCardTypes.id, active: bankCardTypes.active })
    .from(bankCardTypes)
    .where(eq(bankCardTypes.id, v.bankCardTypeId));
  if (!type) throw new ValidationError('Unknown card type');
  if (type.active === false) throw new ValidationError('This card type is no longer available');
  const displayName = await resolveCardDisplayName(ctx, v.bankCardTypeId, v.displayName);

  let lastDigits = v.lastDigits;
  if (!lastDigits && v.paymentDetails?.cardNumber) {
    const cleanNum = v.paymentDetails.cardNumber.replace(/\D/g, '');
    if (cleanNum.length >= 4) {
      lastDigits = cleanNum.slice(-4);
    }
  }
  if (!lastDigits) {
    throw new ValidationError('Card digits required (last 4 digits)');
  }

  const cardId = crypto.randomUUID();
  let paymentDetailsEncrypted = null;
  if (v.paymentDetails) {
    paymentDetailsEncrypted = encryptPaymentDetails(
      {
        version: 1,
        mode: v.paymentDetails.mode ?? 'full',
        cardNumber: v.paymentDetails.cardNumber?.replace(/\s+/g, '') || undefined,
        expiryMonth: v.paymentDetails.expiryMonth?.trim() || undefined,
        expiryYear: v.paymentDetails.expiryYear?.trim() || undefined,
        cvv: v.paymentDetails.cvv?.trim() || undefined,
        nameOnCard: v.paymentDetails.nameOnCard?.trim() || undefined,
      },
      cardId,
    );
  }

  const [row] = await ctx.db
    .insert(cards)
    .values({
      id: cardId,
      workspaceId: ctx.workspaceId,
      holderId: v.holderId,
      bankCardTypeId: v.bankCardTypeId,
      displayName,
      lastDigits,
      trackingFrom: v.trackingFrom ?? ctx.today, // Asia/Kolkata today; backdating allowed
      paymentDetailsEncrypted,
    })
    .returning();
  return row;
}

export async function updateCard(ctx: Ctx, input: unknown) {
  const { id, bankCardTypeId, holderId, ...patch } = parse(cardUpdate, input);
  const existing = await getCard(ctx, { id });
  if (bankCardTypeId !== undefined && bankCardTypeId !== existing.bankCardTypeId) {
    throw new ImmutableFieldError('A card\'s card type cannot be changed once set; create a new card instead');
  }
  if (holderId !== undefined) await getHolder(ctx, { id: holderId });
  const set: Partial<typeof cards.$inferInsert> = {};
  if (holderId !== undefined) set.holderId = holderId;
  if (patch.displayName !== undefined) {
    set.displayName = await resolveCardDisplayName(ctx, existing.bankCardTypeId, patch.displayName);
  }
  if (patch.lastDigits !== undefined) set.lastDigits = patch.lastDigits;
  if (patch.trackingFrom !== undefined) set.trackingFrom = patch.trackingFrom;

  if (patch.paymentDetails !== undefined) {
    if (patch.paymentDetails) {
      set.paymentDetailsEncrypted = encryptPaymentDetails(
        {
          version: 1,
          mode: patch.paymentDetails.mode ?? 'full',
          cardNumber: patch.paymentDetails.cardNumber?.replace(/\s+/g, '') || undefined,
          expiryMonth: patch.paymentDetails.expiryMonth?.trim() || undefined,
          expiryYear: patch.paymentDetails.expiryYear?.trim() || undefined,
          cvv: patch.paymentDetails.cvv?.trim() || undefined,
          nameOnCard: patch.paymentDetails.nameOnCard?.trim() || undefined,
        },
        existing.id,
      );
      if (!patch.lastDigits && patch.paymentDetails.cardNumber) {
        const clean = patch.paymentDetails.cardNumber.replace(/\D/g, '');
        if (clean.length >= 4) {
          set.lastDigits = clean.slice(-4);
        }
      }
    } else {
      set.paymentDetailsEncrypted = null;
    }
  }

  let inactiveDateForPruning: string | null = null;
  if (patch.active !== undefined) {
    set.active = patch.active;
    if (patch.active === false) {
      const inactiveDate = patch.inactiveFrom ?? existing.inactiveFrom ?? ctx.today;
      set.inactiveFrom = inactiveDate;
      inactiveDateForPruning = inactiveDate;
    } else {
      set.inactiveFrom = null;
    }
  } else if (patch.inactiveFrom !== undefined && existing.active === false) {
    set.inactiveFrom = patch.inactiveFrom;
    if (patch.inactiveFrom) {
      inactiveDateForPruning = patch.inactiveFrom;
    }
  }

  if (Object.keys(set).length === 0) return existing;
  const [row] = await ctx.db
    .update(cards)
    .set(set)
    .where(and(eq(cards.workspaceId, ctx.workspaceId), eq(cards.id, id)))
    .returning();
  if (!row) throw new NotFoundError('Card not found');

  if (inactiveDateForPruning) {
    await ctx.db
      .delete(benefitInstances)
      .where(
        and(
          eq(benefitInstances.workspaceId, ctx.workspaceId),
          eq(benefitInstances.cardId, id),
          gte(benefitInstances.periodEnd, inactiveDateForPruning),
          isNull(benefitInstances.rupayBookingId),
          isNull(benefitInstances.codeEncrypted),
          inArray(benefitInstances.orderStatus, ['Not Ordered', 'Withdrawn', 'Skipped']),
        ),
      );
  }

  return row;
}

/** Deletes only a card with no overrides or instances; otherwise deactivate. */
export async function deleteCard(ctx: Ctx, input: unknown) {
  const { id } = parse(idOnly, input);
  await getCard(ctx, { id });
  const [o] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(cardBenefitOverrides)
    .where(and(eq(cardBenefitOverrides.workspaceId, ctx.workspaceId), eq(cardBenefitOverrides.cardId, id)));
  const [i] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(benefitInstances)
    .where(and(eq(benefitInstances.workspaceId, ctx.workspaceId), eq(benefitInstances.cardId, id)));
  if (o.n > 0 || i.n > 0) {
    throw new ConflictError('Card has benefit history; deactivate the card instead of deleting');
  }
  await ctx.db.delete(cards).where(and(eq(cards.workspaceId, ctx.workspaceId), eq(cards.id, id)));
  return { id };
}

// ── overrides ───────────────────────────────────────────────────────────────

const overrideCreate = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('add'),
    cardId: uuid,
    benefitType: trimmed(100),
    benefitProvider: optText(100),
    exactBenefit: trimmed(500),
    frequency,
    instanceCount: z.number().int().min(1),
    defaultCashValue: money.nullable().optional(),
  }),
  z.strictObject({
    kind: z.literal('suppress'),
    cardId: uuid,
    benefitId: uuid,
  }),
]);
const overrideUpdate = z.strictObject({
  id: uuid,
  active: z.boolean().optional(),
  defaultCashValue: money.nullable().optional(), // 'add' overrides only
});
const overrideToggle = z.strictObject({ id: uuid, active: z.boolean() });
const overrideList = z.strictObject({ cardId: uuid.optional() }).optional();

export async function listOverrides(ctx: Ctx, input?: unknown) {
  const f = parse(overrideList, input);
  return ctx.db
    .select()
    .from(cardBenefitOverrides)
    .where(
      and(
        eq(cardBenefitOverrides.workspaceId, ctx.workspaceId),
        f?.cardId ? eq(cardBenefitOverrides.cardId, f.cardId) : undefined,
      ),
    )
    .orderBy(asc(cardBenefitOverrides.createdAt));
}

export async function getOverride(ctx: Ctx, input: unknown) {
  const { id } = parse(idOnly, input);
  const [row] = await ctx.db
    .select()
    .from(cardBenefitOverrides)
    .where(and(eq(cardBenefitOverrides.workspaceId, ctx.workspaceId), eq(cardBenefitOverrides.id, id)));
  if (!row) throw new NotFoundError('Override not found');
  return row;
}

export async function createOverride(ctx: Ctx, input: unknown) {
  const v = parse(overrideCreate, input);
  const card = await getCard(ctx, { id: v.cardId });
  // bank_card_type_id is ALWAYS copied from the card here, never from input.
  const common = {
    workspaceId: ctx.workspaceId,
    cardId: card.id,
    bankCardTypeId: card.bankCardTypeId,
  };
  if (v.kind === 'suppress') {
    const [b] = await ctx.db
      .select({ id: benefits.id })
      .from(benefits)
      .where(and(eq(benefits.id, v.benefitId), eq(benefits.bankCardTypeId, card.bankCardTypeId)));
    if (!b) throw new ValidationError('That benefit does not belong to this card\'s card type');
    return mapConflicts('This suppression', async () => {
      const [row] = await ctx.db
        .insert(cardBenefitOverrides)
        .values({ ...common, kind: 'suppress', benefitId: v.benefitId })
        .returning();
      return row;
    });
  }
  return mapConflicts('This added benefit', async () => {
    const [row] = await ctx.db
      .insert(cardBenefitOverrides)
      .values({
        ...common,
        kind: 'add',
        benefitType: v.benefitType,
        benefitProvider: v.benefitProvider ?? null,
        exactBenefit: v.exactBenefit,
        frequency: v.frequency,
        instanceCount: v.instanceCount,
        defaultCashValue: v.defaultCashValue ?? null,
        offerKind: inferOfferKind(v.benefitType, v.benefitProvider ?? null, v.exactBenefit),
      })
      .returning();
    return row;
  });
}

export async function updateOverride(ctx: Ctx, input: unknown) {
  const { id, ...patch } = parse(overrideUpdate, input);
  const existing = await getOverride(ctx, { id });
  const set: Partial<typeof cardBenefitOverrides.$inferInsert> = {};
  if (patch.active !== undefined) set.active = patch.active;
  if (patch.defaultCashValue !== undefined) {
    if (existing.kind !== 'add') throw new ValidationError('Only added benefits have a cash value');
    set.defaultCashValue = patch.defaultCashValue;
  }
  if (Object.keys(set).length === 0) return existing;
  const [row] = await ctx.db
    .update(cardBenefitOverrides)
    .set(set)
    .where(and(eq(cardBenefitOverrides.workspaceId, ctx.workspaceId), eq(cardBenefitOverrides.id, id)))
    .returning();
  if (!row) throw new NotFoundError('Override not found');
  return row;
}

/** On/off toggle: the user-facing way to retire an override (instances keep referencing it). */
export async function setOverrideActive(ctx: Ctx, input: unknown) {
  const v = parse(overrideToggle, input);
  return updateOverride(ctx, v);
}

/** Hard delete only while no instance references the override; otherwise turn it off. */
export async function deleteOverride(ctx: Ctx, input: unknown) {
  const { id } = parse(idOnly, input);
  await getOverride(ctx, { id });
  const [i] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(benefitInstances)
    .where(and(eq(benefitInstances.workspaceId, ctx.workspaceId), eq(benefitInstances.overrideId, id)));
  if (i.n > 0) throw new ConflictError('Override has generated instances; turn it off instead of deleting');
  await ctx.db
    .delete(cardBenefitOverrides)
    .where(and(eq(cardBenefitOverrides.workspaceId, ctx.workspaceId), eq(cardBenefitOverrides.id, id)));
  return { id };
}
