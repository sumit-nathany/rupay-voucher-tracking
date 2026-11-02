'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getCtx, requireSystemAdmin, isSystemAdmin } from '@/lib/session';
import { automationSettings } from '@/db/schema';
import * as auto from '@/domain/automation';
import {
  getCloudWorkerStatus,
  setCloudSchedulerState,
  triggerCloudRunJob,
  type CloudWorkerStatus,
} from '@/lib/gcp-worker-client';

export interface AdminWorkerStatusResponse extends CloudWorkerStatus {
  isSuperAdmin: boolean;
  workspaceAutomationEnabled: boolean;
}

export async function getAdminWorkerStatusAction(): Promise<AdminWorkerStatusResponse> {
  const ctx = await getCtx();
  const isAdmin = await isSystemAdmin(ctx.db, ctx.userId);
  if (!isAdmin) {
    throw new Error('Unauthorized: Super Admin access required');
  }

  const [status, [settings]] = await Promise.all([
    getCloudWorkerStatus(),
    ctx.db
      .select({ enabled: automationSettings.enabled })
      .from(automationSettings)
      .where(eq(automationSettings.workspaceId, ctx.workspaceId)),
  ]);

  return {
    ...status,
    isSuperAdmin: true,
    workspaceAutomationEnabled: settings?.enabled ?? false,
  };
}

const toggleSchedulerSchema = z.object({
  enable: z.boolean(),
});

export async function toggleAdminWorkerSchedulerAction(input: z.infer<typeof toggleSchedulerSchema>) {
  const ctx = await getCtx();
  await requireSystemAdmin(ctx);

  const parsed = toggleSchedulerSchema.parse(input);
  const result = await setCloudSchedulerState(parsed.enable ? 'enable' : 'disable');

  revalidatePath('/admin/worker');
  revalidatePath('/automation');
  return result;
}

export async function triggerAdminWorkerRunAction() {
  const ctx = await getCtx();
  await requireSystemAdmin(ctx);

  const result = await triggerCloudRunJob();

  revalidatePath('/admin/worker');
  revalidatePath('/automation');
  return result;
}

const toggleWorkspaceAutomationSchema = z.object({
  enable: z.boolean(),
});

export async function toggleAdminWorkspaceAutomationAction(input: z.infer<typeof toggleWorkspaceAutomationSchema>) {
  const ctx = await getCtx();
  await requireSystemAdmin(ctx);

  const parsed = toggleWorkspaceAutomationSchema.parse(input);
  await auto.saveAutomationSettings(ctx, { enabled: parsed.enable });

  revalidatePath('/admin/worker');
  revalidatePath('/automation');
  return { success: true, enabled: parsed.enable };
}
