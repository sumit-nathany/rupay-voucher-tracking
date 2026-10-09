import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  bankCardTypes,
  benefitCatalogVersions,
  benefitInstances,
  benefits,
  cardBenefitOverrides,
  cards,
} from '@/db/schema';
import type { Ctx } from '@/lib/context';
import {
  boundPeriods,
  expandViewedPeriod,
  type Frequency,
  type FrequencyPeriod,
  type ViewedPeriod,
} from '@/lib/periods';

export interface EnsureResult {
  inserted: number;
  withdrawn: number;
  restored: number;
}

interface VersionRow {
  id: string;
  benefitId: string;
  frequency: string;
  instanceCount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * Earliest version (by effective_from) of one benefit whose window overlaps the
 * period and whose frequency matches the period's. Returns null when none
 * overlaps or the chosen version has not started yet (effective_from > today).
 * Note the gate applies to the CHOSEN (earliest) version only: we do not fall
 * through to a later version that has started.
 */
export function pickVersion(
  versions: VersionRow[],
  period: FrequencyPeriod,
  todayStr: string,
): VersionRow | null {
  const overlapping = versions
    .filter(
      (v) =>
        v.frequency === period.frequency &&
        v.effectiveFrom <= period.end &&
        (v.effectiveTo === null || v.effectiveTo >= period.start),
    )
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0));
  const chosen = overlapping[0];
  if (!chosen || chosen.effectiveFrom > todayStr) return null;
  return chosen;
}

type NewInstance = typeof benefitInstances.$inferInsert;

/**
 * Ensure instances exist for the periods implied by viewing `view`, then run the
 * stateless eligibility sweep. One transaction; idempotent; workspace comes from ctx.
 */
export async function ensureInstances(ctx: Ctx, view: ViewedPeriod): Promise<EnsureResult> {
  const todayStr = ctx.today;
  const expanded = expandViewedPeriod(view, todayStr);

  return ctx.db.transaction(async (tx) => {
    // (a) active cards of active card types in this workspace
    const cardRows = (
      await tx
        .select({
          id: cards.id,
          bankCardTypeId: cards.bankCardTypeId,
          trackingFrom: cards.trackingFrom,
          cardActive: cards.active,
          typeActive: bankCardTypes.active,
        })
        .from(cards)
        .innerJoin(bankCardTypes, eq(bankCardTypes.id, cards.bankCardTypeId))
        .where(eq(cards.workspaceId, ctx.workspaceId))
    ).filter((c) => c.cardActive !== false && c.typeActive !== false);

    const values: NewInstance[] = [];

    if (cardRows.length > 0) {
      const typeIds = [...new Set(cardRows.map((c) => c.bankCardTypeId))];
      const cardIds = cardRows.map((c) => c.id);

      const versionRows = await tx
        .select({
          id: benefitCatalogVersions.id,
          benefitId: benefitCatalogVersions.benefitId,
          bankCardTypeId: benefits.bankCardTypeId,
          frequency: benefitCatalogVersions.frequency,
          instanceCount: benefitCatalogVersions.instanceCount,
          effectiveFrom: benefitCatalogVersions.effectiveFrom,
          effectiveTo: benefitCatalogVersions.effectiveTo,
        })
        .from(benefitCatalogVersions)
        .innerJoin(benefits, eq(benefits.id, benefitCatalogVersions.benefitId))
        .where(inArray(benefits.bankCardTypeId, typeIds));

      const versionsByType = new Map<string, Map<string, VersionRow[]>>();
      for (const v of versionRows) {
        const byBenefit = versionsByType.get(v.bankCardTypeId) ?? new Map<string, VersionRow[]>();
        byBenefit.set(v.benefitId, [...(byBenefit.get(v.benefitId) ?? []), v]);
        versionsByType.set(v.bankCardTypeId, byBenefit);
      }

      const overrideRows = await tx
        .select()
        .from(cardBenefitOverrides)
        .where(
          and(
            eq(cardBenefitOverrides.workspaceId, ctx.workspaceId),
            inArray(cardBenefitOverrides.cardId, cardIds),
            eq(cardBenefitOverrides.active, true),
          ),
        );

      for (const card of cardRows) {
        const periods = boundPeriods(expanded, card.trackingFrom, todayStr);
        if (periods.length === 0) continue;
        const myOverrides = overrideRows.filter((o) => o.cardId === card.id);
        const suppressed = new Set(
          myOverrides.filter((o) => o.kind === 'suppress').map((o) => o.benefitId),
        );

        const base = {
          workspaceId: ctx.workspaceId,
          cardId: card.id,
          bankCardTypeId: card.bankCardTypeId,
        };

        // (b) catalog-sourced benefits
        for (const [benefitId, versions] of versionsByType.get(card.bankCardTypeId) ?? []) {
          if (suppressed.has(benefitId)) continue;
          for (const p of periods) {
            const v = pickVersion(versions, p, todayStr);
            if (!v) continue;
            for (let n = 1; n <= v.instanceCount; n++) {
              values.push({
                ...base,
                benefitId,
                generatedFromVersion: v.id,
                periodStart: p.start,
                periodEnd: p.end,
                periodLabel: p.label,
                instanceNumber: n,
                orderDeadline: p.end,
              });
            }
          }
        }

        // active 'add' overrides: no version selection
        for (const o of myOverrides) {
          if (o.kind !== 'add' || !o.frequency || !o.instanceCount) continue;
          for (const p of periods) {
            if (p.frequency !== (o.frequency as Frequency)) continue;
            for (let n = 1; n <= o.instanceCount; n++) {
              values.push({
                ...base,
                overrideId: o.id,
                periodStart: p.start,
                periodEnd: p.end,
                periodLabel: p.label,
                instanceNumber: n,
                orderDeadline: p.end,
              });
            }
          }
        }
      }
    }

    // (c) insert, racing-safe
    let inserted = 0;
    if (values.length > 0) {
      const res = await tx
        .insert(benefitInstances)
        .values(values)
        .onConflictDoNothing()
        .returning({ id: benefitInstances.id });
      inserted = res.length;
    }

    // (d) stateless eligibility sweep, same transaction
    const { withdrawn, restored } = await sweep(tx, ctx.workspaceId, todayStr);
    return { inserted, withdrawn, restored };
  });
}

type Tx = Parameters<Parameters<Ctx['db']['transaction']>[0]>[0];

const ELIGIBLE = (today: string) => sql`(
  (bi.benefit_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM app.benefit_catalog_versions v
      WHERE v.benefit_id = bi.benefit_id
        AND v.effective_from <= ${today}::date
        AND (v.effective_to IS NULL OR v.effective_to >= ${today}::date))
    AND NOT EXISTS (
      SELECT 1 FROM app.card_benefit_overrides o
      WHERE o.workspace_id = bi.workspace_id AND o.card_id = bi.card_id
        AND o.kind = 'suppress' AND o.active AND o.benefit_id = bi.benefit_id))
  OR
  (bi.override_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM app.card_benefit_overrides o
      WHERE o.workspace_id = bi.workspace_id AND o.card_id = bi.card_id
        AND o.id = bi.override_id AND o.kind = 'add' AND o.active))
)`;

// pglite returns { rows }, postgres-js returns the row array itself.
function rowCount(res: unknown): number {
  const rows = Array.isArray(res) ? res : (res as { rows: unknown[] }).rows;
  return rows.length;
}

async function sweep(tx: Tx, workspaceId: string, todayStr: string) {
  const now = new Date().toISOString();
  const w = await tx.execute(sql`
    UPDATE app.benefit_instances bi
       SET order_status = 'Withdrawn', updated_at = ${now}::timestamptz
     WHERE bi.workspace_id = ${workspaceId}::uuid
       AND bi.period_end >= ${todayStr}::date
       AND bi.order_status = 'Not Ordered'
       AND NOT ${ELIGIBLE(todayStr)}
    RETURNING bi.id`);
  const r = await tx.execute(sql`
    UPDATE app.benefit_instances bi
       SET order_status = 'Not Ordered', updated_at = ${now}::timestamptz
     WHERE bi.workspace_id = ${workspaceId}::uuid
       AND bi.period_end >= ${todayStr}::date
       AND bi.order_status = 'Withdrawn'
       AND ${ELIGIBLE(todayStr)}
    RETURNING bi.id`);
  return { withdrawn: rowCount(w), restored: rowCount(r) };
}
