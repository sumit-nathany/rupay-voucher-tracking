'use server';

import { revalidatePath } from 'next/cache';
import { getCtx, isSystemAdmin } from '@/lib/session';
import * as d from '@/domain/benefit-values';

export async function changeBenefitValueAction(input: d.ChangeBenefitValueInput) {
  const ctx = await getCtx();
  const res = await d.changeBenefitValue(ctx, input);
  revalidatePath('/overrides');
  revalidatePath('/benefits');
  revalidatePath('/dashboard');
  revalidatePath('/admin/catalog');
  revalidatePath('/');
  return res;
}

export async function checkIsSystemAdminAction(): Promise<boolean> {
  const ctx = await getCtx();
  return isSystemAdmin(ctx.db, ctx.userId);
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
}) {
  const ctx = await getCtx();
  const res = await d.upsertBenefitValueOverride(ctx, input);
  revalidatePath('/overrides');
  revalidatePath('/benefits');
  revalidatePath('/dashboard');
  revalidatePath('/');
  return res;
}

export async function deleteBenefitValueOverrideAction(input: {
  id?: string;
  benefitName?: string;
}) {
  const ctx = await getCtx();
  await d.deleteBenefitValueOverride(ctx, input);
  revalidatePath('/overrides');
  revalidatePath('/benefits');
  revalidatePath('/dashboard');
  revalidatePath('/');
  return { success: true };
}

export async function listDistinctWorkspaceBenefitsAction() {
  const ctx = await getCtx();
  return d.listDistinctWorkspaceBenefits(ctx);
}
