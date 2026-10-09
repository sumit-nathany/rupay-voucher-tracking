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
  const ctx = await getCtx();
  await ensureInstances(ctx, input.view);
  return q.listInstances(ctx, input);
}

/** Dashboard page-load: ensure instances for the view, then summarize. */
export async function loadDashboardAction(view: Parameters<typeof q.getDashboardSummary>[1]) {
  const ctx = await getCtx();
  await ensureInstances(ctx, view);
  return q.getDashboardSummary(ctx, view);
}

/** Read-only variants (no generation), e.g. for refreshing after an edit. */
export async function listInstancesAction(input: Parameters<typeof q.listInstances>[1]) {
  return q.listInstances(await getCtx(), input);
}
export async function getDashboardSummaryAction(view: Parameters<typeof q.getDashboardSummary>[1]) {
  return q.getDashboardSummary(await getCtx(), view);
}
