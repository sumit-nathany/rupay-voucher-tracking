import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  benefitCatalogVersions,
  benefitInstances,
  benefitOptions,
  benefitValueOverrides,
  cardBenefitOverrides,
  systemAdmins,
} from '@/db/schema';
import { AuthzError, NotFoundError, type Ctx } from '@/lib/context';

export class ValidationError extends Error {}

const uuid = z.string().uuid();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_REGEX.test(s);
const optionalUuid = z.preprocess(
  (val) => (typeof val === 'string' && (val.trim() === '' || val === 'null' || val === 'undefined') ? null : val),
  uuid.nullable().optional(),
);
const money = z.number().finite().min(0).max(99_999_999.99);
const toMoney = (n: number) => n.toFixed(2);
const num = (s: string | number | null | undefined): number | null => (s == null ? null : Number(s));

const upsertInput = z.object({
  benefitName: z.string().trim().min(1, 'Benefit name is required').max(500),
  customValue: money,
  benefitType: z.string().trim().max(200).nullable().optional(),
  benefitProvider: z.string().trim().max(200).nullable().optional(),
  benefitId: optionalUuid,
});

const deleteInput = z.object({
  id: optionalUuid,
  benefitName: z.string().trim().min(1).optional(),
}).refine((data) => Boolean(data.id || data.benefitName), {
  message: 'Either id or benefitName must be provided',
});

export interface BenefitValueOverrideView {
  id: string;
  workspaceId: string;
  benefitName: string;
  benefitType: string | null;
  benefitProvider: string | null;
  benefitId: string | null;
  customValue: number;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface WorkspaceDistinctBenefit {
  benefitName: string;
  benefitType: string;
  benefitProvider: string | null;
  catalogValue: number | null;
  customValue: number | null;
  effectiveValue: number;
  overrideId: string | null;
}

export async function listBenefitValueOverrides(ctx: Ctx): Promise<BenefitValueOverrideView[]> {
  const rows = await ctx.db
    .select()
    .from(benefitValueOverrides)
    .where(eq(benefitValueOverrides.workspaceId, ctx.workspaceId))
    .orderBy(asc(benefitValueOverrides.benefitName));

  return rows.map((r) => ({
    ...r,
    customValue: Number(r.customValue),
  }));
}

export async function upsertBenefitValueOverride(
  ctx: Ctx,
  input: z.infer<typeof upsertInput>,
): Promise<BenefitValueOverrideView> {
  const p = upsertInput.parse(input);
  const normalizedName = p.benefitName.trim();

  // Look for existing row in this workspace (case-insensitive trim match)
  const [existing] = await ctx.db
    .select()
    .from(benefitValueOverrides)
    .where(
      and(
        eq(benefitValueOverrides.workspaceId, ctx.workspaceId),
        sql`lower(trim(${benefitValueOverrides.benefitName})) = lower(trim(${normalizedName}))`,
      ),
    );

  if (existing) {
    const [updated] = await ctx.db
      .update(benefitValueOverrides)
      .set({
        benefitName: normalizedName,
        customValue: toMoney(p.customValue),
        benefitType: p.benefitType !== undefined ? p.benefitType : existing.benefitType,
        benefitProvider: p.benefitProvider !== undefined ? p.benefitProvider : existing.benefitProvider,
        benefitId: p.benefitId !== undefined ? p.benefitId : existing.benefitId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(benefitValueOverrides.workspaceId, ctx.workspaceId),
          eq(benefitValueOverrides.id, existing.id),
        ),
      )
      .returning();

    return {
      ...updated,
      customValue: Number(updated.customValue),
    };
  }

  const [inserted] = await ctx.db
    .insert(benefitValueOverrides)
    .values({
      workspaceId: ctx.workspaceId,
      benefitName: normalizedName,
      customValue: toMoney(p.customValue),
      benefitType: p.benefitType ?? null,
      benefitProvider: p.benefitProvider ?? null,
      benefitId: p.benefitId ?? null,
    })
    .onConflictDoUpdate({
      target: [benefitValueOverrides.workspaceId, benefitValueOverrides.benefitName],
      set: {
        customValue: toMoney(p.customValue),
        benefitType: p.benefitType ?? null,
        benefitProvider: p.benefitProvider ?? null,
        benefitId: p.benefitId ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return {
    ...inserted,
    customValue: Number(inserted.customValue),
  };
}

export async function deleteBenefitValueOverride(
  ctx: Ctx,
  input: { id?: string; benefitName?: string },
): Promise<void> {
  const p = deleteInput.parse(input);

  const whereClause = p.id
    ? and(
        eq(benefitValueOverrides.workspaceId, ctx.workspaceId),
        eq(benefitValueOverrides.id, p.id),
      )
    : and(
        eq(benefitValueOverrides.workspaceId, ctx.workspaceId),
        sql`lower(trim(${benefitValueOverrides.benefitName})) = lower(trim(${p.benefitName!}))`,
      );

  const deleted = await ctx.db
    .delete(benefitValueOverrides)
    .where(whereClause)
    .returning({ id: benefitValueOverrides.id });

  if (deleted.length === 0) {
    throw new NotFoundError('Benefit value override not found');
  }
}

export type ChangeBenefitValueScope = 'workspace' | 'all_workspaces' | 'instance';

export const changeBenefitValueInput = z.object({
  benefitName: z.string().trim().min(1, 'Benefit name is required').max(500),
  value: money,
  scope: z.enum(['workspace', 'all_workspaces', 'instance']),
  instanceId: optionalUuid,
  benefitId: optionalUuid,
  versionId: optionalUuid,
  optionId: optionalUuid,
  benefitType: z.string().trim().max(200).nullable().optional(),
  benefitProvider: z.string().trim().max(200).nullable().optional(),
  clearInstanceOverrides: z.boolean().optional().default(true),
});

export type ChangeBenefitValueInput = z.input<typeof changeBenefitValueInput>;

export interface ChangeBenefitValueResult {
  scope: ChangeBenefitValueScope;
  value: number;
  benefitName: string;
  affectedCount: number;
}

/**
 * Changes the value of a given benefit.
 * - scope 'instance': updates only the single instance's cash_value in the workspace.
 * - scope 'workspace': sets a workspace-wide valuation override and clears instance overrides.
 * - scope 'all_workspaces': STRICTLY super admin only; updates catalog versions and options across all workspaces,
 *   clearing conflicting workspace overrides so the new value applies everywhere.
 */
export async function changeBenefitValue(
  ctx: Ctx,
  input: ChangeBenefitValueInput,
): Promise<ChangeBenefitValueResult> {
  const p = changeBenefitValueInput.parse(input);
  const normalizedName = p.benefitName.trim();
  const moneyValue = toMoney(p.value);

  if (p.scope === 'instance') {
    if (!p.instanceId) {
      throw new ValidationError('instanceId is required when updating an instance value');
    }
    const [updated] = await ctx.db
      .update(benefitInstances)
      .set({
        cashValue: moneyValue,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(benefitInstances.workspaceId, ctx.workspaceId),
          eq(benefitInstances.id, p.instanceId),
          eq(benefitInstances.archived, false),
        ),
      )
      .returning({ id: benefitInstances.id });

    if (!updated) {
      throw new NotFoundError('Benefit instance not found');
    }

    return {
      scope: 'instance',
      value: p.value,
      benefitName: normalizedName,
      affectedCount: 1,
    };
  }

  if (p.scope === 'workspace') {
    await upsertBenefitValueOverride(ctx, {
      benefitName: normalizedName,
      customValue: p.value,
      benefitType: p.benefitType,
      benefitProvider: p.benefitProvider,
      benefitId: p.benefitId,
    });

    let clearedCount = 0;
    if (p.clearInstanceOverrides && p.instanceId) {
      const res = await ctx.db
        .update(benefitInstances)
        .set({ cashValue: null, updatedAt: new Date() })
        .where(
          and(
            eq(benefitInstances.workspaceId, ctx.workspaceId),
            eq(benefitInstances.id, p.instanceId),
            eq(benefitInstances.archived, false),
          ),
        )
        .returning({ id: benefitInstances.id });
      clearedCount = res.length;
    }

    return {
      scope: 'workspace',
      value: p.value,
      benefitName: normalizedName,
      affectedCount: clearedCount + 1,
    };
  }

  if (p.scope === 'all_workspaces') {
    if (!isUuid(ctx.userId)) {
      throw new AuthzError('Only super admins can change benefit values across all workspaces');
    }

    const [adminRow] = await ctx.db
      .select({ id: systemAdmins.id })
      .from(systemAdmins)
      .where(eq(systemAdmins.userId, ctx.userId));

    if (!adminRow) {
      throw new AuthzError('Only super admins can change benefit values across all workspaces');
    }

    return ctx.db.transaction(async (tx) => {
      let catalogUpdates = 0;

      if (p.optionId) {
        const optRes = await tx
          .update(benefitOptions)
          .set({ cashValue: moneyValue })
          .where(eq(benefitOptions.id, p.optionId))
          .returning({ id: benefitOptions.id });
        catalogUpdates += optRes.length;
      }

      if (p.versionId) {
        const verRes = await tx
          .update(benefitCatalogVersions)
          .set({ defaultCashValue: moneyValue })
          .where(eq(benefitCatalogVersions.id, p.versionId))
          .returning({ id: benefitCatalogVersions.id });
        catalogUpdates += verRes.length;
      }

      if (p.benefitId) {
        const benRes = await tx
          .update(benefitCatalogVersions)
          .set({ defaultCashValue: moneyValue })
          .where(eq(benefitCatalogVersions.benefitId, p.benefitId))
          .returning({ id: benefitCatalogVersions.id });
        catalogUpdates += benRes.length;
      }

      const matchingVersions = await tx
        .update(benefitCatalogVersions)
        .set({ defaultCashValue: moneyValue })
        .where(sql`lower(trim(${benefitCatalogVersions.exactBenefit})) = lower(trim(${normalizedName}))`)
        .returning({ id: benefitCatalogVersions.id });
      catalogUpdates += matchingVersions.length;

      const matchingOptions = await tx
        .update(benefitOptions)
        .set({ cashValue: moneyValue })
        .where(sql`lower(trim(${benefitOptions.offerName})) = lower(trim(${normalizedName}))`)
        .returning({ id: benefitOptions.id });
      catalogUpdates += matchingOptions.length;

      const matchingCardOverrides = await tx
        .update(cardBenefitOverrides)
        .set({ defaultCashValue: moneyValue })
        .where(sql`lower(trim(${cardBenefitOverrides.exactBenefit})) = lower(trim(${normalizedName}))`)
        .returning({ id: cardBenefitOverrides.id });
      catalogUpdates += matchingCardOverrides.length;

      // Delete workspace overrides across all workspaces so everyone gets the new catalog value
      await tx
        .delete(benefitValueOverrides)
        .where(sql`lower(trim(${benefitValueOverrides.benefitName})) = lower(trim(${normalizedName}))`);

      if (p.instanceId) {
        await tx
          .update(benefitInstances)
          .set({ cashValue: null, updatedAt: new Date() })
          .where(eq(benefitInstances.id, p.instanceId));
      }

      return {
        scope: 'all_workspaces',
        value: p.value,
        benefitName: normalizedName,
        affectedCount: catalogUpdates,
      };
    });
  }

  throw new ValidationError(`Unknown scope: ${p.scope}`);
}

/**
 * Returns distinct benefits found across instances in the workspace,
 * merged with their nominal catalog value and any workspace custom valuation.
 */
export async function listDistinctWorkspaceBenefits(ctx: Ctx): Promise<WorkspaceDistinctBenefit[]> {
  const [instanceRows, overrides] = await Promise.all([
    ctx.db
      .select({
        chosenName: benefitOptions.offerName,
        chosenProvider: benefitOptions.provider,
        chosenValue: benefitOptions.cashValue,
        overrideName: cardBenefitOverrides.exactBenefit,
        overrideType: cardBenefitOverrides.benefitType,
        overrideProvider: cardBenefitOverrides.benefitProvider,
        overrideValue: cardBenefitOverrides.defaultCashValue,
        versionName: benefitCatalogVersions.exactBenefit,
        versionType: benefitCatalogVersions.benefitType,
        versionProvider: benefitCatalogVersions.benefitProvider,
        versionValue: benefitCatalogVersions.defaultCashValue,
        fromOverride: benefitInstances.overrideId,
      })
      .from(benefitInstances)
      .leftJoin(
        benefitCatalogVersions,
        eq(benefitCatalogVersions.id, benefitInstances.generatedFromVersion),
      )
      .leftJoin(benefitOptions, eq(benefitOptions.id, benefitInstances.chosenOptionId))
      .leftJoin(
        cardBenefitOverrides,
        and(
          eq(cardBenefitOverrides.id, benefitInstances.overrideId),
          eq(cardBenefitOverrides.workspaceId, ctx.workspaceId),
        ),
      )
      .where(and(eq(benefitInstances.workspaceId, ctx.workspaceId), eq(benefitInstances.archived, false))),
    listBenefitValueOverrides(ctx),
  ]);

  const overrideByName = new Map<string, BenefitValueOverrideView>();
  for (const o of overrides) {
    overrideByName.set(o.benefitName.toLowerCase().trim(), o);
  }

  const distinct = new Map<string, WorkspaceDistinctBenefit>();

  for (const r of instanceRows) {
    const isOverride = r.fromOverride != null;
    const hasChosen = !isOverride && r.chosenName != null;

    const name = (hasChosen ? r.chosenName : isOverride ? r.overrideName : r.versionName)?.trim();
    if (!name) continue;

    const key = name.toLowerCase();
    if (distinct.has(key)) continue;

    const type = ((isOverride ? r.overrideType : r.versionType) ?? 'Benefit').trim();
    const provider = (hasChosen ? r.chosenProvider : isOverride ? r.overrideProvider : r.versionProvider)?.trim() ?? null;
    const catalogValue = num(hasChosen ? r.chosenValue ?? r.versionValue : isOverride ? r.overrideValue : r.versionValue);

    const ov = overrideByName.get(key);
    const customValue = ov ? ov.customValue : null;
    const effectiveValue = customValue ?? catalogValue ?? 0;

    distinct.set(key, {
      benefitName: name,
      benefitType: type,
      benefitProvider: provider,
      catalogValue,
      customValue,
      effectiveValue,
      overrideId: ov ? ov.id : null,
    });
  }

  return [...distinct.values()].sort((a, b) =>
    a.benefitName.localeCompare(b.benefitName, undefined, { sensitivity: 'base' }),
  );
}
