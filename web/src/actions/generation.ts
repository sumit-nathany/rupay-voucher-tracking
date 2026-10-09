'use server';

import { z } from 'zod';
import { getCtx } from '@/lib/session'; // provided by the session-layer agent; returns Ctx
import { ensureInstances } from '@/domain/generation';

const viewSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('year'), year: z.number().int().min(2000).max(2100) }),
  z.object({
    kind: z.literal('half'),
    year: z.number().int().min(2000).max(2100),
    half: z.union([z.literal(1), z.literal(2)]),
  }),
  z.object({
    kind: z.literal('quarter'),
    year: z.number().int().min(2000).max(2100),
    quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  }),
  z.object({
    kind: z.literal('month'),
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
  }),
]);

export async function ensureInstancesAction(view: unknown) {
  const parsed = viewSchema.parse(view);
  const ctx = await getCtx();
  return ensureInstances(ctx, parsed);
}
