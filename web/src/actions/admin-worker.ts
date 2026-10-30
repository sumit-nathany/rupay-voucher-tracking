'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCtx, requireSystemAdmin, isSystemAdmin } from '@/lib/session';
import {
  getCloudWorkerStatus,
  setCloudSchedulerState,
  triggerCloudRunJob,
  type CloudWorkerStatus,
} from '@/lib/gcp-worker-client';

export async function getAdminWorkerStatusAction(): Promise<CloudWorkerStatus & { isSuperAdmin: boolean }> {
  const ctx = await getCtx();
  const isAdmin = await isSystemAdmin(ctx.db, ctx.userId);
  if (!isAdmin) {
    throw new Error('Unauthorized: Super Admin access required');
  }

  const status = await getCloudWorkerStatus();
  return {
    ...status,
    isSuperAdmin: true,
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
