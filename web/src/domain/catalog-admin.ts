import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  bankCardTypes,
  benefitCatalogVersions,
  benefitInstances,
  benefitOptions,
  benefits,
  cardVariants,
  cards,
  systemAdmins,
  workspaces,
} from '@/db/schema';
import { AuthzError, NotFoundError, type Ctx } from '@/lib/context';
import { inferOfferKind, OFFER_KINDS, type OfferKind } from '@/domain/benefit-offer-kind';
import { parseCardList } from '@/lib/card-list';
import { computePeriods, type Frequency } from '@/lib/periods';

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

export type { OfferKind } from '@/domain/benefit-offer-kind';

// Preview types
export interface WorkspaceImpact {
  workspaceId: string;
  workspaceName: string;
  cardCount: number;
  currentPeriod: {
    totalInstances: number;
    notOrdered: number;
    orderedPlus: number;
    withdrawn: number;
    keep: { archive: number; add: number; preserve: number };
    regenerateCurrent: { archive: number; add: number; preserve: number };
    regenerateAllFuture: { archive: number; add: number; preserve: number };
    migrate: { archive: number; add: number; preserve: number; sourceInstance: { period: string; status: string; hasCode: boolean; bookingId: string | null } | null; conflicts: string[] };
  };
  futurePeriods: {
    totalInstances: number;
    notOrdered: number;
    orderedPlus: number;
    withdrawn: number;
    periodsAffected: number;
    keep: { archive: number; add: number; preserve: number };
    regenerateCurrent: { archive: number; add: number; preserve: number };
    regenerateAllFuture: { archive: number; add: number; preserve: number };
    migrate: { archive: number; add: number; preserve: number };
  };
}

export interface FrequencyChangePreview {
  oldBenefitId: string;
  newBenefitId: string;
  oldFrequency: string;
  newFrequency: string;
  effectiveFrom: string;
  affectedWorkspaces: WorkspaceImpact[];
  summary: {
    totalWorkspaces: number;
    totalCards: number;
    currentPeriod: Record<string, { archive: number; add: number; preserve: number }>;
    futurePeriods: Record<string, { archive: number; add: number; preserve: number }>;
  };
  warnings: string[];
}

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

const frequencyChangePreviewInput = z
  .object({
    benefitId: uuid,
    newFrequency: frequency,
    effectiveFrom: isoDate,
    instanceHandling: z.enum(['keep', 'regenerate_current', 'regenerate_all_future', 'migrate']),
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

/**
 * PREVIEW: Computes the impact of a frequency change without modifying data.
 */
export async function previewFrequencyChange(
  ctx: Ctx,
  input: z.input<typeof frequencyChangePreviewInput>,
): Promise<FrequencyChangePreview> {
  await assertSystemAdmin(ctx);
  const p = frequencyChangePreviewInput.parse(input);

  // Get current benefit and its open version
  const [benefit] = await ctx.db.select().from(benefits).where(eq(benefits.id, p.benefitId));
  if (!benefit) throw new NotFoundError('Benefit not found');

  const [currentVersion] = await ctx.db
    .select()
    .from(benefitCatalogVersions)
    .where(and(eq(benefitCatalogVersions.benefitId, p.benefitId), isNull(benefitCatalogVersions.effectiveTo)));
  if (!currentVersion) throw new CatalogRuleError('Benefit has no open version');

  const bankCardTypeId = benefit.bankCardTypeId;
  const todayStr = ctx.today;
  const newFreq = p.newFrequency;

  // Check if benefit has options
  const options = await ctx.db
    .select()
    .from(benefitOptions)
    .where(eq(benefitOptions.versionId, currentVersion.id));
  const hasOptions = options.length > 0;

  // Find all cards of this bank card type across all workspaces
  const cardRows = await ctx.db
    .select({
      workspaceId: cards.workspaceId,
      cardId: cards.id,
      workspaceName: workspaces.name,
    })
    .from(cards)
    .innerJoin(workspaces, eq(workspaces.id, cards.workspaceId))
    .where(eq(cards.bankCardTypeId, bankCardTypeId));

  // Group by workspace
  const workspaceMap = new Map<string, { workspaceName: string; cardIds: string[] }>();
  for (const c of cardRows) {
    const entry = workspaceMap.get(c.workspaceId) ?? { workspaceName: c.workspaceName, cardIds: [] };
    entry.cardIds.push(c.cardId);
    workspaceMap.set(c.workspaceId, entry);
  }

  // For each workspace, query instances for the old benefitId
  const affectedWorkspaces: FrequencyChangePreview['affectedWorkspaces'] = [];

  for (const [workspaceId, { workspaceName, cardIds }] of workspaceMap) {
    // Get instances for old benefitId where period_end >= effectiveFrom and not archived
    const instances = await ctx.db
      .select({
        id: benefitInstances.id,
        periodStart: benefitInstances.periodStart,
        periodEnd: benefitInstances.periodEnd,
        orderStatus: benefitInstances.orderStatus,
        codeEncrypted: benefitInstances.codeEncrypted,
        rupayBookingId: benefitInstances.rupayBookingId,
      })
      .from(benefitInstances)
      .where(
        and(
          eq(benefitInstances.workspaceId, workspaceId),
          inArray(benefitInstances.cardId, cardIds),
          eq(benefitInstances.benefitId, p.benefitId),
          gte(benefitInstances.periodEnd, p.effectiveFrom),
          eq(benefitInstances.archived, false),
        ),
      );

    // Split into current period and future periods
    const currentPeriod = instances.filter((i) => i.periodStart <= todayStr && i.periodEnd >= todayStr);
    const futurePeriods = instances.filter((i) => i.periodStart > todayStr);

    // Count by status
    const countByStatus = (arr: typeof instances) => ({
      total: arr.length,
      notOrdered: arr.filter((i) => i.orderStatus === 'Not Ordered').length,
      orderedPlus: arr.filter((i) => i.orderStatus !== 'Not Ordered').length,
      withdrawn: arr.filter((i) => i.orderStatus === 'Withdrawn').length,
      hasCode: arr.filter((i) => i.codeEncrypted).length,
      withBookingId: arr.filter((i) => i.rupayBookingId).length,
    });

    const currentCounts = countByStatus(currentPeriod);
    const futureCounts = countByStatus(futurePeriods);

    // Find non-Not-Ordered instances for migration mode
    const nonNotOrdered = instances.filter((i) => i.orderStatus !== 'Not Ordered');
    const sourceInstance = nonNotOrdered[0] ?? null;

    // Check conflicts for migration
    const conflicts: string[] = [];
    if (p.instanceHandling === 'migrate') {
      if (nonNotOrdered.length > 1) {
        conflicts.push(`${nonNotOrdered.length} instances with status != Not Ordered`);
      }
      // Check for multiple different codes/booking IDs
      const codes = new Set(nonNotOrdered.filter((i) => i.codeEncrypted).map((i) => i.codeEncrypted));
      const bookingIds = new Set(nonNotOrdered.filter((i) => i.rupayBookingId).map((i) => i.rupayBookingId));
      if (codes.size > 1) conflicts.push('Multiple different voucher codes');
      if (bookingIds.size > 1) conflicts.push('Multiple different booking IDs');
    }

    // Get periods for new frequency
    const currentPeriodObj = currentPeriod[0];
    const futurePeriodObjs = futurePeriods;

    // Simplified new instance counts for preview
    const newInstanceCountForCurrentPeriod = currentPeriodObj ? currentVersion.instanceCount : 0;
    const newInstanceCountForAllFuturePeriods = futurePeriodObjs.length * currentVersion.instanceCount;

    affectedWorkspaces.push({
      workspaceId,
      workspaceName,
      cardCount: cardIds.length,
      currentPeriod: {
        totalInstances: currentCounts.total,
        notOrdered: currentCounts.notOrdered,
        orderedPlus: currentCounts.orderedPlus,
        withdrawn: currentCounts.withdrawn,
        keep: { archive: 0, add: 0, preserve: currentCounts.total },
        regenerateCurrent: { archive: currentCounts.notOrdered, add: newInstanceCountForCurrentPeriod, preserve: currentCounts.orderedPlus },
        regenerateAllFuture: { archive: futureCounts.notOrdered, add: newInstanceCountForAllFuturePeriods, preserve: futureCounts.orderedPlus },
        migrate: {
          archive: currentCounts.total,
          add: currentPeriodObj ? 1 : 0,
          preserve: 0,
          sourceInstance: sourceInstance
            ? { period: sourceInstance.periodStart, status: sourceInstance.orderStatus, hasCode: !!sourceInstance.codeEncrypted, bookingId: sourceInstance.rupayBookingId }
            : null,
          conflicts,
        },
      },
      futurePeriods: {
        totalInstances: futureCounts.total,
        notOrdered: futureCounts.notOrdered,
        orderedPlus: futureCounts.orderedPlus,
        withdrawn: futureCounts.withdrawn,
        periodsAffected: futurePeriodObjs.length,
        keep: { archive: 0, add: 0, preserve: futureCounts.total },
        regenerateCurrent: { archive: 0, add: 0, preserve: futureCounts.total },
        regenerateAllFuture: { archive: futureCounts.notOrdered, add: newInstanceCountForAllFuturePeriods, preserve: futureCounts.orderedPlus },
        migrate: { archive: futureCounts.total, add: newInstanceCountForAllFuturePeriods, preserve: 0 },
      },
    });
  }

  // Summary totals
  const summary = {
    totalWorkspaces: affectedWorkspaces.length,
    totalCards: affectedWorkspaces.reduce((sum, w) => sum + w.cardCount, 0),
    currentPeriod: {
      keep: { archive: 0, add: 0, preserve: affectedWorkspaces.reduce((s, w) => s + w.currentPeriod.totalInstances, 0) },
      regenerateCurrent: {
        archive: affectedWorkspaces.reduce((s, w) => s + w.currentPeriod.regenerateCurrent.archive, 0),
        add: affectedWorkspaces.reduce((s, w) => s + w.currentPeriod.regenerateCurrent.add, 0),
        preserve: affectedWorkspaces.reduce((s, w) => s + w.currentPeriod.regenerateCurrent.preserve, 0),
      },
      regenerateAllFuture: {
        archive: affectedWorkspaces.reduce((s, w) => s + w.currentPeriod.regenerateAllFuture.archive, 0),
        add: affectedWorkspaces.reduce((s, w) => s + w.currentPeriod.regenerateAllFuture.add, 0),
        preserve: affectedWorkspaces.reduce((s, w) => s + w.currentPeriod.regenerateAllFuture.preserve, 0),
      },
      migrate: {
        archive: affectedWorkspaces.reduce((s, w) => s + w.currentPeriod.migrate.archive, 0),
        add: affectedWorkspaces.reduce((s, w) => s + w.currentPeriod.migrate.add, 0),
        preserve: 0,
      },
    },
    futurePeriods: {
      keep: { archive: 0, add: 0, preserve: affectedWorkspaces.reduce((s, w) => s + w.futurePeriods.totalInstances, 0) },
      regenerateCurrent: {
        archive: 0,
        add: 0,
        preserve: affectedWorkspaces.reduce((s, w) => s + w.futurePeriods.totalInstances, 0),
      },
      regenerateAllFuture: {
        archive: affectedWorkspaces.reduce((s, w) => s + w.futurePeriods.regenerateAllFuture.archive, 0),
        add: affectedWorkspaces.reduce((s, w) => s + w.futurePeriods.regenerateAllFuture.add, 0),
        preserve: affectedWorkspaces.reduce((s, w) => s + w.futurePeriods.regenerateAllFuture.preserve, 0),
      },
      migrate: {
        archive: affectedWorkspaces.reduce((s, w) => s + w.futurePeriods.migrate.archive, 0),
        add: affectedWorkspaces.reduce((s, w) => s + w.futurePeriods.migrate.add, 0),
        preserve: 0,
      },
    },
  };

  const warnings: string[] = [];
  if (hasOptions) {
    warnings.push('Benefit has options — new benefit will start with 0 options (admin must re-add)');
  }
  if (p.instanceHandling === 'migrate' && affectedWorkspaces.some((w) => w.currentPeriod.migrate.conflicts.length > 0)) {
    warnings.push('Migration mode has conflicts — multiple non-Not-Ordered instances found');
  }

  return {
    oldBenefitId: p.benefitId,
    newBenefitId: 'new-' + crypto.randomUUID().slice(0, 8), // placeholder
    oldFrequency: currentVersion.frequency,
    newFrequency: newFreq,
    effectiveFrom: p.effectiveFrom,
    affectedWorkspaces,
    summary,
    warnings,
  };
}

/**
 * EXECUTE: Performs the frequency change and handles instance migration/regeneration.
 */
export async function executeFrequencyChange(
  ctx: Ctx,
  input: z.input<typeof frequencyChangePreviewInput>,
): Promise<{ closedVersionId: string; newBenefitId: string; versionId: string; migrated: number; archived: number }> {
  await assertSystemAdmin(ctx);
  const p = frequencyChangePreviewInput.parse(input);

  // Get the benefit to know its bankCardTypeId
  const [benefit] = await ctx.db.select().from(benefits).where(eq(benefits.id, p.benefitId));
  if (!benefit) throw new NotFoundError('Benefit not found');

  // Get the current version for archive reason
  const [currentVersion] = await ctx.db
    .select()
    .from(benefitCatalogVersions)
    .where(and(eq(benefitCatalogVersions.benefitId, p.benefitId), isNull(benefitCatalogVersions.effectiveTo)));
  if (!currentVersion) throw new CatalogRuleError('Benefit has no open version');

  // First, do the catalog frequency change
  const catalogResult = await changeFrequency(ctx, {
    benefitId: p.benefitId,
    newFrequency: p.newFrequency,
    effectiveFrom: p.effectiveFrom,
  });

  const { newBenefitId } = catalogResult;
  const todayStr = ctx.today;

  let migrated = 0;
  let archived = 0;

  // Then handle instances based on mode
  if (p.instanceHandling !== 'keep') {
    // Get all cards of this bank card type across all workspaces
    const cardRows = await ctx.db
      .select({ workspaceId: cards.workspaceId, cardId: cards.id })
      .from(cards)
      .where(eq(cards.bankCardTypeId, benefit.bankCardTypeId));

    for (const { workspaceId, cardId } of cardRows) {
      if (p.instanceHandling === 'regenerate_current') {
        // Archive Not Ordered instances in current period
        const res = await ctx.db
          .update(benefitInstances)
          .set({ archived: true, archivedAt: new Date(), archivedBy: ctx.userId, archiveReason: `frequency_regenerate_current:${p.effectiveFrom}` })
          .where(
            and(
              eq(benefitInstances.workspaceId, workspaceId),
              eq(benefitInstances.cardId, cardId),
              eq(benefitInstances.benefitId, p.benefitId),
              lte(benefitInstances.periodStart, todayStr),
              gte(benefitInstances.periodEnd, todayStr),
              eq(benefitInstances.orderStatus, 'Not Ordered'),
              eq(benefitInstances.archived, false),
            ),
          )
          .returning({ id: benefitInstances.id });
        archived += res.length;

        // Trigger ensureInstances for this card to generate new instances
        // (handled by view refresh)
      } else if (p.instanceHandling === 'regenerate_all_future') {
        // Archive all future Not Ordered instances
        const res = await ctx.db
          .update(benefitInstances)
          .set({ archived: true, archivedAt: new Date(), archivedBy: ctx.userId, archiveReason: `frequency_regenerate_all_future:${p.effectiveFrom}` })
          .where(
            and(
              eq(benefitInstances.workspaceId, workspaceId),
              eq(benefitInstances.cardId, cardId),
              eq(benefitInstances.benefitId, p.benefitId),
              gte(benefitInstances.periodEnd, p.effectiveFrom),
              eq(benefitInstances.orderStatus, 'Not Ordered'),
              eq(benefitInstances.archived, false),
            ),
          )
          .returning({ id: benefitInstances.id });
        archived += res.length;
      } else if (p.instanceHandling === 'migrate') {
        // Find the non-Not-Ordered instance (if any)
        const [sourceInst] = await ctx.db
          .select({
            id: benefitInstances.id,
            bankCardTypeId: benefitInstances.bankCardTypeId,
            orderStatus: benefitInstances.orderStatus,
            soldFor: benefitInstances.soldFor,
            cashValue: benefitInstances.cashValue,
            orderDate: benefitInstances.orderDate,
            expiryDate: benefitInstances.expiryDate,
            rupayBookingId: benefitInstances.rupayBookingId,
            portalAccountId: benefitInstances.portalAccountId,
            codeEncrypted: benefitInstances.codeEncrypted,
            comments: benefitInstances.comments,
            chosenOptionId: benefitInstances.chosenOptionId,
            instanceNumber: benefitInstances.instanceNumber,
          })
          .from(benefitInstances)
          .where(
            and(
              eq(benefitInstances.workspaceId, workspaceId),
              eq(benefitInstances.cardId, cardId),
              eq(benefitInstances.benefitId, p.benefitId),
              ne(benefitInstances.orderStatus, 'Not Ordered'),
              eq(benefitInstances.archived, false),
            ),
          )
          .limit(1);

        // Archive ALL instances for this benefitId
        const allRes = await ctx.db
          .update(benefitInstances)
          .set({ archived: true, archivedAt: new Date(), archivedBy: ctx.userId, archiveReason: `frequency_migration:${currentVersion.frequency}->${p.newFrequency}` })
          .where(
            and(
              eq(benefitInstances.workspaceId, workspaceId),
              eq(benefitInstances.cardId, cardId),
              eq(benefitInstances.benefitId, p.benefitId),
              eq(benefitInstances.archived, false),
            ),
          )
          .returning({ id: benefitInstances.id });
        archived += allRes.length;

        // Create new instance for the period covering effectiveFrom under new benefitId
        if (sourceInst) {
          // Find the period for the new frequency that covers effectiveFrom
          const periods = computePeriods(Number(p.effectiveFrom.slice(0, 4)), p.newFrequency as Frequency);
          const targetPeriod = periods.find((per) => per.start <= p.effectiveFrom && per.end >= p.effectiveFrom);
          if (targetPeriod) {
            await ctx.db.insert(benefitInstances).values({
              workspaceId,
              cardId,
              bankCardTypeId: sourceInst.bankCardTypeId,
              benefitId: newBenefitId,
              generatedFromVersion: catalogResult.versionId,
              periodStart: targetPeriod.start,
              periodEnd: targetPeriod.end,
              periodLabel: targetPeriod.label,
              instanceNumber: sourceInst.instanceNumber,
              orderDeadline: targetPeriod.end,
              orderStatus: sourceInst.orderStatus,
              soldFor: sourceInst.soldFor,
              cashValue: sourceInst.cashValue,
              orderDate: sourceInst.orderDate,
              expiryDate: sourceInst.expiryDate,
              rupayBookingId: sourceInst.rupayBookingId,
              portalAccountId: sourceInst.portalAccountId,
              codeEncrypted: sourceInst.codeEncrypted,
              comments: sourceInst.comments,
              chosenOptionId: sourceInst.chosenOptionId,
            });
            migrated++;
          }
        } else {
          // No source instance - create blank Not Ordered
          const periods = computePeriods(Number(p.effectiveFrom.slice(0, 4)), p.newFrequency as Frequency);
          const targetPeriod = periods.find((per) => per.start <= p.effectiveFrom && per.end >= p.effectiveFrom);
          if (targetPeriod) {
            await ctx.db.insert(benefitInstances).values({
              workspaceId,
              cardId,
              bankCardTypeId: benefit.bankCardTypeId,
              benefitId: newBenefitId,
              generatedFromVersion: catalogResult.versionId,
              periodStart: targetPeriod.start,
              periodEnd: targetPeriod.end,
              periodLabel: targetPeriod.label,
              instanceNumber: 1,
              orderDeadline: targetPeriod.end,
              orderStatus: 'Not Ordered',
            });
            migrated++;
          }
        }
      }
    }
  }

  return { ...catalogResult, migrated, archived };
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
