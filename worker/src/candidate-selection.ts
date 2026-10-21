import type { Database } from '../../web/src/lib/context';
import {
  findCandidatesForAccount,
  findCandidateFromGlobalQueue,
} from '../../web/src/domain/automation';

type PortalAccountRef = { id: string; workspaceId: string };

/**
 * Resolves the benefit to order for one portal account.
 *
 * The global ordering queue is the priority-aware mechanism: it reflects the
 * user's rule priority and their manual re-ordering of the queue. It is
 * per portal account, so asking it about a specific account is the precise
 * question. The legacy per-account rule walk is the fallback for anything the
 * queue did not nominate.
 *
 * Both the browser runner and the batch entry point use this, so the
 * plan-only preview a deployment shows is exactly what a live run would do.
 */
export async function selectCandidateForAccount(
  db: Database,
  account: PortalAccountRef,
  today: string,
  options?: { ignoreCooldown?: boolean },
): Promise<Awaited<ReturnType<typeof findCandidatesForAccount>>> {
  const ignoreCooldown = options?.ignoreCooldown ?? false;

  const scoped = await findCandidateFromGlobalQueue(db, account.workspaceId, today, {
    portalAccountId: account.id,
    ignoreCooldown,
  });
  if (scoped?.candidate) return scoped.candidate;

  return findCandidatesForAccount(db, account.id, today, { ignoreCooldown });
}
