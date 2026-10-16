'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCtx } from '@/lib/session';
import * as auto from '@/domain/automation';
import * as worker from '@/domain/automation-worker';
import * as queueDomain from '@/domain/ordering-queue';
import { getTelegramClient } from '@/lib/telegram-client';

export async function getAutomationDashboardAction() {
  const ctx = await getCtx();
  const [settings, accounts, mappings, rules, attempts, nextRunInfo, queue] = await Promise.all([
    auto.getAutomationSettings(ctx),
    auto.listPortalAccounts(ctx),
    auto.listPortalCardMappings(ctx),
    auto.listOrderingRules(ctx),
    auto.listAutomationAttempts(ctx, 30),
    auto.getNextEligibleRunTime(ctx.db, ctx.workspaceId),
    queueDomain.listOrderingQueue(ctx),
  ]);

  return {
    settings: {
      ...settings,
      workspaceId: ctx.workspaceId,
    },
    accounts,
    mappings,
    rules,
    attempts,
    nextRun: {
      eligibleNow: nextRunInfo.eligibleNow,
      nextRunAt: nextRunInfo.nextRunAt ? nextRunInfo.nextRunAt.toISOString() : null,
      accountLabel: nextRunInfo.accountLabel,
      reason: nextRunInfo.reason,
    },
    queue,
  };
}

const saveSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  whatsappPhoneNumber: z.string().optional().nullable(),
  telegramChatId: z.string().optional().nullable(),
});

export async function saveAutomationSettingsAction(input: z.infer<typeof saveSettingsSchema>) {
  const ctx = await getCtx();
  const parsed = saveSettingsSchema.parse(input);
  const result = await auto.saveAutomationSettings(ctx, parsed);
  revalidatePath('/automation');
  return result;
}

export async function listPortalAccountsAction() {
  const ctx = await getCtx();
  return auto.listPortalAccounts(ctx);
}

export async function listPortalCardMappingsAction(): Promise<auto.PortalCardMappingView[]> {
  const ctx = await getCtx();
  return auto.listPortalCardMappings(ctx);
}

const createAccountSchema = z.object({
  label: z.string().min(1, 'Label is required'),
  phoneNumber: z.string().optional().nullable(),
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
  revalidatePath('/accounts');
  return result;
}

const updateAccountSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).optional(),
  phoneNumber: z.string().optional().nullable(),
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
  revalidatePath('/accounts');
  return result;
}

export async function pausePortalAccountAction(input: { id: string }) {
  const ctx = await getCtx();
  await auto.pausePortalAccount(ctx, input.id);
  revalidatePath('/automation');
  revalidatePath('/accounts');
}

export async function resumePortalAccountAction(input: { id: string }) {
  const ctx = await getCtx();
  await auto.resumePortalAccount(ctx, input.id);
  revalidatePath('/automation');
  revalidatePath('/accounts');
}

export async function deletePortalAccountAction(input: { id: string }) {
  const ctx = await getCtx();
  await auto.deletePortalAccount(ctx, input.id);
  revalidatePath('/automation');
  revalidatePath('/accounts');
}

const saveMappingSchema = z.object({
  id: z.string().uuid().optional(),
  portalAccountId: z.string().uuid(),
  cardId: z.string().uuid(),
  portalCardId: z.string().nullable().optional(),
  portalCardbinId: z.string().nullable().optional(),
  portalCardLabel: z.string().nullable().optional(),
  paymentDetails: z
    .object({
      version: z.literal(1).default(1),
      mode: z.enum(['full', 'saved_card']).default('full'),
      cardNumber: z.string().optional(),
      expiryMonth: z.string().optional(),
      expiryYear: z.string().optional(),
      cvv: z.string().optional(),
      nameOnCard: z.string().optional(),
    })
    .nullable()
    .optional(),
  active: z.boolean().optional(),
});

export async function savePortalCardMappingAction(input: z.infer<typeof saveMappingSchema>) {
  const ctx = await getCtx();
  const parsed = saveMappingSchema.parse(input);
  await auto.savePortalCardMapping(ctx, parsed);
  revalidatePath('/automation');
  revalidatePath('/accounts');
}

export async function deletePortalCardMappingAction(input: { id: string }) {
  const ctx = await getCtx();
  await auto.deletePortalCardMapping(ctx, input.id);
  revalidatePath('/automation');
  revalidatePath('/accounts');
}

const setCardPortalAccountsSchema = z.object({
  cardId: z.string().uuid(),
  portalAccountIds: z.array(z.string().uuid()),
});

export async function setCardPortalAccountsAction(input: z.infer<typeof setCardPortalAccountsSchema>) {
  const ctx = await getCtx();
  const parsed = setCardPortalAccountsSchema.parse(input);
  await auto.setCardPortalAccounts(ctx, parsed);
  revalidatePath('/automation');
  revalidatePath('/accounts');
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

export async function sendTestTelegramMessageAction(input?: { chatId?: string }) {
  const ctx = await getCtx();
  let chatId = input?.chatId?.trim();
  if (!chatId) {
    const settings = await auto.getAutomationSettings(ctx);
    chatId = settings.telegramChatId || undefined;
  }

  if (!chatId) {
    return { success: false, error: 'No Telegram Chat ID found. Please save your Telegram Chat ID or connect via the Telegram bot link first.' };
  }

  const tg = getTelegramClient();
  const res = await tg.sendMessage(
    chatId,
    `🎉 *RuPay Voucher Tracker*: Connection successful!\n\n` +
      `Your Telegram account is connected to your workspace. When an automated voucher order requires an OTP from your bank, you will receive the prompt directly in this chat. Just reply with the OTP to complete the booking.`,
  );

  return res;
}

export async function triggerManualOrderAction() {
  const ctx = await getCtx();
  await auto.requestManualAutomationRun(ctx);
  revalidatePath('/automation');
  return { success: true };
}

const queueFilterSchema = z.object({
  cardId: z.string().uuid().optional(),
  portalAccountId: z.string().uuid().optional(),
}).optional();

export async function listOrderingQueueAction(filter?: z.infer<typeof queueFilterSchema>) {
  const ctx = await getCtx();
  const parsed = filter ? queueFilterSchema.parse(filter) : undefined;
  return queueDomain.listOrderingQueue(ctx, parsed);
}

const populateQueueSchema = z.object({
  strategy: z.enum(['nearest_expiring', 'highest_value']).optional(),
  filter: queueFilterSchema,
});

export async function populateAndSortQueueAction(input?: z.infer<typeof populateQueueSchema>) {
  const ctx = await getCtx();
  const parsed = input ? populateQueueSchema.parse(input) : undefined;
  const result = await queueDomain.populateAndSortQueue(ctx, parsed?.strategy, parsed?.filter);
  revalidatePath('/automation');
  return result;
}

const updateQueueItemSchema = z.object({
  instanceId: z.string().uuid(),
  enabled: z.boolean().optional(),
  chosenOptionId: z.string().uuid().nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export async function updateQueueItemAction(input: z.infer<typeof updateQueueItemSchema>) {
  const ctx = await getCtx();
  const parsed = updateQueueItemSchema.parse(input);
  await queueDomain.updateQueueItem(ctx, parsed);
  revalidatePath('/automation');
}

const moveQueueItemSchema = z.object({
  instanceId: z.string().uuid(),
  direction: z.enum(['up', 'down']),
  currentInstanceIds: z.array(z.string().uuid()).optional(),
});

export async function moveQueueItemAction(input: z.infer<typeof moveQueueItemSchema>) {
  const ctx = await getCtx();
  const parsed = moveQueueItemSchema.parse(input);
  await queueDomain.moveQueueItem(ctx, parsed.instanceId, parsed.direction, parsed.currentInstanceIds);
  revalidatePath('/automation');
}

const reorderQueueSchema = z.object({
  orderedInstanceIds: z.array(z.string().uuid()),
});

export async function reorderQueueAction(input: z.infer<typeof reorderQueueSchema>) {
  const ctx = await getCtx();
  const parsed = reorderQueueSchema.parse(input);
  await queueDomain.reorderQueue(ctx, parsed.orderedInstanceIds);
  revalidatePath('/automation');
}

