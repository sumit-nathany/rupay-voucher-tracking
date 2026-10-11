'use server';

import { revalidatePath } from 'next/cache';
import { getCtx } from '@/lib/session';
import * as d from '@/domain/benefit-values';

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
