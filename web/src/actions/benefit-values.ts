'use server';

import { revalidatePath } from 'next/cache';
import { getCtx, isSystemAdmin } from '@/lib/session';
import * as d from '@/domain/benefit-values';

export interface ActionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function changeBenefitValueAction(
  input: d.ChangeBenefitValueInput,
): Promise<ActionResult<d.ChangeBenefitValueResult>> {
  try {
    const ctx = await getCtx();
    const res = await d.changeBenefitValue(ctx, input);
    revalidatePath('/overrides');
    revalidatePath('/benefits');
    revalidatePath('/dashboard');
    revalidatePath('/admin/catalog');
    revalidatePath('/');
    return { success: true, data: res };
  } catch (err: unknown) {
    console.error('[changeBenefitValueAction]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Could not save benefit valuation',
    };
  }
}

export async function checkIsSystemAdminAction(): Promise<boolean> {
  try {
    const ctx = await getCtx();
    return await isSystemAdmin(ctx.db, ctx.userId);
  } catch {
    return false;
  }
}

export async function listBenefitValueOverridesAction() {
  const ctx = await getCtx();
  return d.listBenefitValueOverrides(ctx);
}

export async function upsertBenefitValueOverrideAction(input: {
  benefitName: string;
  customValue: number;
  benefitType?: string | null;
  benefitProvider?: string | null;
  benefitId?: string | null;
}): Promise<ActionResult<d.BenefitValueOverrideView>> {
  try {
    const ctx = await getCtx();
    const res = await d.upsertBenefitValueOverride(ctx, input);
    revalidatePath('/overrides');
    revalidatePath('/benefits');
    revalidatePath('/dashboard');
    revalidatePath('/');
    return { success: true, data: res };
  } catch (err: unknown) {
    console.error('[upsertBenefitValueOverrideAction]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Could not save benefit valuation',
    };
  }
}

export async function deleteBenefitValueOverrideAction(input: {
  id?: string;
  benefitName?: string;
}): Promise<ActionResult<void>> {
  try {
    const ctx = await getCtx();
    await d.deleteBenefitValueOverride(ctx, input);
    revalidatePath('/overrides');
    revalidatePath('/benefits');
    revalidatePath('/dashboard');
    revalidatePath('/');
    return { success: true };
  } catch (err: unknown) {
    console.error('[deleteBenefitValueOverrideAction]', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Could not delete benefit valuation override',
    };
  }
}

export async function listDistinctWorkspaceBenefitsAction() {
  const ctx = await getCtx();
  return d.listDistinctWorkspaceBenefits(ctx);
}
