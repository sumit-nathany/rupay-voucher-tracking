'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCtx } from '@/lib/session';
import * as auto from '@/domain/automation';
import * as worker from '@/domain/automation-worker';

export async function getAutomationDashboardAction() {
  const ctx = await getCtx();
  const [settings, accounts, mappings, rules, attempts] = await Promise.all([
    auto.getAutomationSettings(ctx),
    auto.listPortalAccounts(ctx),
    auto.listPortalCardMappings(ctx),
    auto.listOrderingRules(ctx),
    auto.listAutomationAttempts(ctx, 30),
  ]);

  return {
    settings,
    accounts,
    mappings,
    rules,
    attempts,
  };
}

const saveSettingsSchema = z.object({
  enabled: z.boolean(),
});

export async function saveAutomationSettingsAction(input: z.infer<typeof saveSettingsSchema>) {
  const ctx = await getCtx();
  const parsed = saveSettingsSchema.parse(input);
  const result = await auto.saveAutomationSettings(ctx, parsed);
  revalidatePath('/automation');
  return result;
}

const createAccountSchema = z.object({
  label: z.string().min(1, 'Label is required'),
  credentials: z.object({
    loginId: z.string().min(1, 'Login ID is required'),
    password: z.string().min(1, 'Password is required'),
    extra: z.record(z.string(), z.string()).optional(),
  }),
});

export async function createPortalAccountAction(input: z.infer<typeof createAccountSchema>) {
  const ctx = await getCtx();
  const parsed = createAccountSchema.parse(input);
  const result = await auto.createPortalAccount(ctx, parsed);
  revalidatePath('/automation');
  return result;
}

const updateAccountSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).optional(),
  credentials: z
    .object({
      loginId: z.string().min(1),
      password: z.string().min(1),
      extra: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

export async function updatePortalAccountAction(input: z.infer<typeof updateAccountSchema>) {
  const ctx = await getCtx();
  const parsed = updateAccountSchema.parse(input);
  const result = await auto.updatePortalAccount(ctx, parsed);
  revalidatePath('/automation');
  return result;
}

export async function pausePortalAccountAction(input: { id: string }) {
  const ctx = await getCtx();
  await auto.pausePortalAccount(ctx, input.id);
  revalidatePath('/automation');
}

export async function resumePortalAccountAction(input: { id: string }) {
  const ctx = await getCtx();
  await auto.resumePortalAccount(ctx, input.id);
  revalidatePath('/automation');
}

export async function deletePortalAccountAction(input: { id: string }) {
  const ctx = await getCtx();
  await auto.deletePortalAccount(ctx, input.id);
  revalidatePath('/automation');
}

const saveMappingSchema = z.object({
  id: z.string().uuid().optional(),
  portalAccountId: z.string().uuid(),
  cardId: z.string().uuid(),
  portalCardId: z.string().min(1, 'Portal card ID is required'),
  portalCardbinId: z.string().nullable().optional(),
  portalCardLabel: z.string().nullable().optional(),
  active: z.boolean().optional(),
});

export async function savePortalCardMappingAction(input: z.infer<typeof saveMappingSchema>) {
  const ctx = await getCtx();
  const parsed = saveMappingSchema.parse(input);
  await auto.savePortalCardMapping(ctx, parsed);
  revalidatePath('/automation');
}

export async function deletePortalCardMappingAction(input: { id: string }) {
  const ctx = await getCtx();
  await auto.deletePortalCardMapping(ctx, input.id);
  revalidatePath('/automation');
}

const ruleSchema = z.object({
  portalAccountId: z.string().uuid(),
  name: z.string().min(1, 'Rule name is required'),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(1).max(100).optional(),
  cardIds: z.array(z.string().uuid()).optional(),
  benefitIds: z.array(z.string().uuid()).optional(),
  optionDefaults: z
    .array(
      z.object({
        benefitId: z.string().uuid(),
        optionId: z.string().uuid(),
      }),
    )
    .optional(),
});

export async function createOrderingRuleAction(input: z.infer<typeof ruleSchema>) {
  const ctx = await getCtx();
  const parsed = ruleSchema.parse(input);
  const result = await auto.createOrderingRule(ctx, parsed);
  revalidatePath('/automation');
  return result;
}

const updateRuleSchema = ruleSchema.partial().extend({ id: z.string().uuid() });

export async function updateOrderingRuleAction(input: z.infer<typeof updateRuleSchema>) {
  const ctx = await getCtx();
  const parsed = updateRuleSchema.parse(input);
  await auto.updateOrderingRule(ctx, parsed);
  revalidatePath('/automation');
}

export async function deleteOrderingRuleAction(input: { id: string }) {
  const ctx = await getCtx();
  await auto.deleteOrderingRule(ctx, input.id);
  revalidatePath('/automation');
}

const resolveAttemptSchema = z.object({
  attemptId: z.string().uuid(),
  resolution: z.enum(['confirmed', 'resolved_no_order']),
  bookingReference: z.string().nullable().optional(),
});

export async function resolveUncertainAttemptAction(input: z.infer<typeof resolveAttemptSchema>) {
  const ctx = await getCtx();
  const parsed = resolveAttemptSchema.parse(input);
  await worker.resolveUncertainAttempt(ctx, parsed);
  revalidatePath('/automation');
  revalidatePath('/benefits');
}
