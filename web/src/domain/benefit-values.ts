import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  benefitCatalogVersions,
  benefitInstances,
  benefitOptions,
  benefitValueOverrides,
  cardBenefitOverrides,
} from '@/db/schema';
import { NotFoundError, type Ctx } from '@/lib/context';

const uuid = z.string().uuid();
const money = z.number().finite().min(0).max(99_999_999.99);
const toMoney = (n: number) => n.toFixed(2);
const num = (s: string | number | null | undefined): number | null => (s == null ? null : Number(s));

const upsertInput = z.object({
  benefitName: z.string().trim().min(1, 'Benefit name is required').max(500),
  customValue: money,
  benefitType: z.string().trim().max(200).nullable().optional(),
  benefitProvider: z.string().trim().max(200).nullable().optional(),
  benefitId: uuid.nullable().optional(),
});

const deleteInput = z.object({
  id: uuid.optional(),
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
