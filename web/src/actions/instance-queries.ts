'use server';
// Thin wrappers. Never accept a workspace id; getCtx() derives it from the session.
import { getCtx } from '@/lib/session';
import { ensureInstances } from '@/domain/generation';
import * as q from '@/domain/instance-queries';

/**
 * Page-load path: generate (idempotent, runs the withdrawal sweep) for the
 * viewed period first, then list, in one server action. No separate generate step.
 */
export async function loadBenefitsAction(input: Parameters<typeof q.listInstances>[1]) {
  try {
    const ctx = await getCtx();
    await ensureInstances(ctx, input.view);
    return await q.listInstances(ctx, input);
  } catch (err) {
    console.error('[loadBenefitsAction] failed:', err);
    throw err;
  }
}

/** Dashboard page-load: ensure instances for the view, then summarize. */
export async function loadDashboardAction(view: Parameters<typeof q.getDashboardSummary>[1]) {
  try {
    const ctx = await getCtx();
    await ensureInstances(ctx, view);
    return await q.getDashboardSummary(ctx, view);
  } catch (err) {
    console.error('[loadDashboardAction] failed:', err);
    throw err;
  }
}

/** Read-only variants (no generation), e.g. for refreshing after an edit. */
export async function listInstancesAction(input: Parameters<typeof q.listInstances>[1]) {
  return q.listInstances(await getCtx(), input);
}
export async function getDashboardSummaryAction(view: Parameters<typeof q.getDashboardSummary>[1]) {
  return q.getDashboardSummary(await getCtx(), view);
}

export async function listBenefitFilterOptionsAction(input?: Parameters<typeof q.listBenefitFilterOptions>[1]) {
  return q.listBenefitFilterOptions(await getCtx(), input);
}

export async function listCategoryFilterOptionsAction(input?: Parameters<typeof q.listCategoryFilterOptions>[1]) {
  return q.listCategoryFilterOptions(await getCtx(), input);
}
