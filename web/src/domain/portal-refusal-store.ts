import { eq } from 'drizzle-orm';
import { benefitInstances } from '@/db/schema';
import type { Database } from '@/lib/context';
import type { PortalRefusalCode, PortalRefusalSource } from './portal-refusal';

/**
 * Persistence for a portal refusal.
 *
 * Unscoped on purpose: the worker holds the database handle and the instance
 * id it just attempted, and the instance id is unique. The web-facing
 * dismissal path is workspace-scoped and lives in `domain/instances.ts`.
 */

export interface PortalRefusalInput {
  instanceId: string;
  code: PortalRefusalCode;
  source: PortalRefusalSource;
  /** The portal's own wording, for diagnosis. Bounded. */
  detail?: string | null;
}

/** Detail is shown in the UI, so it is kept short and single-line. */
const MAX_DETAIL = 500;

function sanitiseDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const flat = detail.replace(/\s+/g, ' ').trim();
  if (!flat) return null;
  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL - 1)}…` : flat;
}

/**
 * Records that the portal or the bank refused this benefit for this card.
 *
 * The instance's `orderStatus` is deliberately left alone: the benefit was
 * never ordered, so it stays `Not Ordered`. The refusal is what explains why,
 * and it is what excludes the instance from automatic ordering.
 */
export async function recordPortalRefusal(
  db: Database,
  input: PortalRefusalInput,
): Promise<void> {
  await db
    .update(benefitInstances)
    .set({
      portalRefusal: input.code,
      portalRefusalSource: input.source,
      portalRefusalDetail: sanitiseDetail(input.detail),
      portalRefusalAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(benefitInstances.id, input.instanceId));
}

/** Clears a refusal so the instance becomes eligible for ordering again. */
export async function clearPortalRefusal(db: Database, instanceId: string): Promise<void> {
  await db
    .update(benefitInstances)
    .set({
      portalRefusal: null,
      portalRefusalSource: null,
      portalRefusalDetail: null,
      portalRefusalAt: null,
      updatedAt: new Date(),
    })
    .where(eq(benefitInstances.id, instanceId));
}
