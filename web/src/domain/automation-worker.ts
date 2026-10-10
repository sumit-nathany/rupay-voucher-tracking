import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  automationSettings,
  portalAccounts,
  portalOrderAttempts,
  orderingJobRuns,
  benefitInstances,
} from '@/db/schema';
import type { Database, Ctx } from '@/lib/context';
import { NotFoundError } from '@/lib/context';
import { decryptPortalCredentials } from '@/lib/portal-credentials';
import {
  type PortalOrderClient,
  type PortalFailureCode,
  PortalOrderError,
} from '@/lib/portal-client';
import { findCandidatesForAccount, type CandidateNomination } from './automation';

export interface AutomationJobStats {
  jobRunId: string;
  accountsProcessed: number;
  ordersConfirmed: number;
  ordersFailed: number;
  status: 'completed' | 'failed';
}

/**
 * Recovers active attempts whose lease has expired.
 *  - Reserved attempts that expired before submission started are safely cancelled.
 *  - Submitting attempts that expired after submission started become uncertain,
 *    set the account to needs_attention, and require manual reconciliation.
 */
export async function recoverExpiredAttempts(db: Database, now: Date = new Date()): Promise<void> {
  // 1. Expired reserved attempts (no submission started)
  const expiredReserved = await db
    .select({ id: portalOrderAttempts.id })
    .from(portalOrderAttempts)
    .where(
      and(
        eq(portalOrderAttempts.state, 'reserved'),
        isNull(portalOrderAttempts.submissionStartedAt),
        lte(portalOrderAttempts.leaseExpiresAt, now),
      ),
    );

  if (expiredReserved.length > 0) {
    await db
      .update(portalOrderAttempts)
      .set({
        state: 'cancelled',
        failureCode: 'reservation_lease_expired',
        finishedAt: now,
      })
      .where(inArray(portalOrderAttempts.id, expiredReserved.map((r) => r.id)));
  }

  // 2. Expired submitting attempts (worker died after submit began)
  const expiredSubmitting = await db
    .select({ id: portalOrderAttempts.id, portalAccountId: portalOrderAttempts.portalAccountId })
    .from(portalOrderAttempts)
    .where(
      and(
        eq(portalOrderAttempts.state, 'submitting'),
        lte(portalOrderAttempts.leaseExpiresAt, now),
      ),
    );

  for (const exp of expiredSubmitting) {
    await db
      .update(portalOrderAttempts)
      .set({
        state: 'uncertain',
        failureCode: 'worker_lost_after_submit_started',
        finishedAt: now,
      })
      .where(eq(portalOrderAttempts.id, exp.id));

    await db
      .update(portalAccounts)
      .set({
        status: 'needs_attention',
        statusDetailCode: 'worker_lost_after_submit_started',
        updatedAt: now,
      })
      .where(eq(portalAccounts.id, exp.portalAccountId));
  }
}

/**
 * Creates a reserved attempt for the selected candidate.
 */
export async function reserveCandidate(
  db: Database,
  account: { id: string; workspaceId: string },
  candidate: CandidateNomination['candidate'],
  jobRunId?: string,
): Promise<{ id: string; instanceId: string; portalAccountId: string } | null> {
  const leaseExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min lease for login/verify
  try {
    const [row] = await db
      .insert(portalOrderAttempts)
      .values({
        jobRunId: jobRunId ?? null,
        workspaceId: account.workspaceId,
        portalAccountId: account.id,
        ruleId: candidate.ruleId,
        instanceId: candidate.instanceId,
        state: 'reserved',
        reservedAt: new Date(),
        leaseExpiresAt,
      })
      .returning();

    return { id: row.id, instanceId: row.instanceId, portalAccountId: row.portalAccountId };
  } catch {
    // Unique partial index violation or concurrency conflict
    return null;
  }
}

/**
 * Transitions attempt from reserved to submitting immediately before portal submission.
 */
export async function startSubmission(
  db: Database,
  attemptId: string,
): Promise<boolean> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + 2 * 60 * 1000); // 2 min bounded submit timeout

  const [attempt] = await db
    .select()
    .from(portalOrderAttempts)
    .where(eq(portalOrderAttempts.id, attemptId));

  if (!attempt || attempt.state !== 'reserved') {
    return false;
  }

  // Re-verify instance is still Not Ordered
  const [inst] = await db
    .select()
    .from(benefitInstances)
    .where(eq(benefitInstances.id, attempt.instanceId));

  if (!inst || inst.orderStatus !== 'Not Ordered') {
    await db
      .update(portalOrderAttempts)
      .set({ state: 'cancelled', failureCode: 'concurrent_change', finishedAt: now })
      .where(eq(portalOrderAttempts.id, attemptId));
    return false;
  }

  // Re-verify automation settings
  const [settings] = await db
    .select()
    .from(automationSettings)
    .where(eq(automationSettings.workspaceId, attempt.workspaceId));

  if (!settings || !settings.enabled) {
    await db
      .update(portalOrderAttempts)
      .set({ state: 'cancelled', failureCode: 'concurrent_change', finishedAt: now })
      .where(eq(portalOrderAttempts.id, attemptId));
    return false;
  }

  await db
    .update(portalOrderAttempts)
    .set({
      state: 'submitting',
      submissionStartedAt: now,
      leaseExpiresAt,
    })
    .where(eq(portalOrderAttempts.id, attemptId));

  return true;
}

/**
 * Confirms a successful portal order atomically across instances, attempts, and accounts.
 */
export async function finalizeConfirmedOrder(
  db: Database,
  attemptId: string,
  bookingReference: string,
  orderDate: string,
): Promise<void> {
  const now = new Date();
  const [attempt] = await db
    .select()
    .from(portalOrderAttempts)
    .where(eq(portalOrderAttempts.id, attemptId));

  if (!attempt) throw new Error(`Attempt ${attemptId} not found`);

  const [instance] = await db
    .select()
    .from(benefitInstances)
    .where(eq(benefitInstances.id, attempt.instanceId));

  if (!instance) throw new Error(`Instance ${attempt.instanceId} not found`);

  // Check if tracker already has a conflicting manual rupay_booking_id
  let hasConflict = false;
  let rupayBookingIdToSet = bookingReference;
  if (instance.rupayBookingId && instance.rupayBookingId.trim() !== bookingReference.trim()) {
    hasConflict = true;
    rupayBookingIdToSet = instance.rupayBookingId; // Preserve human-entered value
  }

  // Update instance status to Ordered but Coupon not received
  await db
    .update(benefitInstances)
    .set({
      orderStatus: 'Ordered but Coupon not received',
      orderDate,
      rupayBookingId: rupayBookingIdToSet,
      updatedAt: now,
    })
    .where(eq(benefitInstances.id, instance.id));

  // Update attempt
  await db
    .update(portalOrderAttempts)
    .set({
      state: 'confirmed',
      bookingReference,
      failureCode: hasConflict ? 'tracker_reference_conflict' : null,
      finishedAt: now,
    })
    .where(eq(portalOrderAttempts.id, attempt.id));

  // Update portal account
  await db
    .update(portalAccounts)
    .set({
      lastConfirmedOrderAt: now,
      lastCheckedAt: now,
      status: hasConflict ? 'needs_attention' : 'connected',
      statusDetailCode: hasConflict ? 'tracker_reference_conflict' : null,
      updatedAt: now,
    })
    .where(eq(portalAccounts.id, attempt.portalAccountId));
}

/**
 * Finalizes failed order attempt (pre-submission or post-submission/uncertain).
 */
export async function finalizeFailedOrder(
  db: Database,
  attemptId: string,
  error: PortalOrderError | Error,
): Promise<void> {
  const now = new Date();
  const [attempt] = await db
    .select()
    .from(portalOrderAttempts)
    .where(eq(portalOrderAttempts.id, attemptId));

  if (!attempt) return;

  const isPostSubmit = error instanceof PortalOrderError ? error.isPostSubmit : attempt.state === 'submitting';
  const failureCode: PortalFailureCode = error instanceof PortalOrderError ? error.code : 'unknown';

  if (isPostSubmit) {
    // Post-submit or ambiguous outcome -> uncertain
    await db
      .update(portalOrderAttempts)
      .set({
        state: 'uncertain',
        failureCode,
        finishedAt: now,
      })
      .where(eq(portalOrderAttempts.id, attempt.id));

    await db
      .update(portalAccounts)
      .set({
        status: 'needs_attention',
        statusDetailCode: failureCode,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(eq(portalAccounts.id, attempt.portalAccountId));
  } else {
    // Pre-submit failure
    await db
      .update(portalOrderAttempts)
      .set({
        state: 'failed_pre_submit',
        failureCode,
        finishedAt: now,
      })
      .where(eq(portalOrderAttempts.id, attempt.id));

    // Update account state if challenge or credentials expired
    if (failureCode === 'credentials_expired' || failureCode === 'challenge_required' || failureCode === 'portal_changed') {
      await db
        .update(portalAccounts)
        .set({
          status: failureCode === 'portal_changed' ? 'portal_changed' : failureCode,
          statusDetailCode: failureCode,
          lastCheckedAt: now,
          updatedAt: now,
        })
        .where(eq(portalAccounts.id, attempt.portalAccountId));
    }
  }
}

/**
 * Allows the user to manually resolve an uncertain attempt after checking the portal.
 */
export async function resolveUncertainAttempt(
  ctx: Ctx,
  input: {
    attemptId: string;
    resolution: 'confirmed' | 'resolved_no_order';
    bookingReference?: string | null;
  },
): Promise<void> {
  const now = new Date();
  const [attempt] = await ctx.db
    .select()
    .from(portalOrderAttempts)
    .where(
      and(
        eq(portalOrderAttempts.workspaceId, ctx.workspaceId),
        eq(portalOrderAttempts.id, input.attemptId),
      ),
    );

  if (!attempt) throw new NotFoundError('Attempt not found');
  if (attempt.state !== 'uncertain') {
    throw new Error('Only uncertain attempts can be resolved');
  }

  if (input.resolution === 'confirmed') {
    const ref = input.bookingReference?.trim();
    if (!ref) {
      throw new Error('Booking reference is required when confirming an order');
    }

    // Set instance to Ordered but Coupon not received
    await ctx.db
      .update(benefitInstances)
      .set({
        orderStatus: 'Ordered but Coupon not received',
        orderDate: ctx.today,
        rupayBookingId: ref,
        updatedAt: now,
      })
      .where(eq(benefitInstances.id, attempt.instanceId));

    // Update attempt
    await ctx.db
      .update(portalOrderAttempts)
      .set({
        state: 'confirmed',
        bookingReference: ref,
        finishedAt: now,
      })
      .where(eq(portalOrderAttempts.id, attempt.id));

    // Update portal account confirmed timestamp
    await ctx.db
      .update(portalAccounts)
      .set({
        lastConfirmedOrderAt: now,
        lastCheckedAt: now,
        updatedAt: now,
      })
      .where(eq(portalAccounts.id, attempt.portalAccountId));
  } else {
    // resolved_no_order: leaves instance Not Ordered
    await ctx.db
      .update(portalOrderAttempts)
      .set({
        state: 'resolved_no_order',
        finishedAt: now,
      })
      .where(eq(portalOrderAttempts.id, attempt.id));
  }

  // Check if any other uncertain attempts remain on this portal account
  const remainingUncertain = await ctx.db
    .select({ count: sql<number>`count(*)::int` })
    .from(portalOrderAttempts)
    .where(
      and(
        eq(portalOrderAttempts.portalAccountId, attempt.portalAccountId),
        eq(portalOrderAttempts.state, 'uncertain'),
      ),
    );

  if (remainingUncertain[0].count === 0) {
    // Clear needs_attention
    await ctx.db
      .update(portalAccounts)
      .set({
        status: 'connected',
        statusDetailCode: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(portalAccounts.id, attempt.portalAccountId),
          eq(portalAccounts.status, 'needs_attention'),
        ),
      );
  }
}

/**
 * Top-level automated ordering execution loop.
 */
export async function runAutomationJob({
  db,
  client,
  scheduledFor = new Date(),
  today,
}: {
  db: Database;
  client: PortalOrderClient;
  scheduledFor?: Date;
  today?: string;
}): Promise<AutomationJobStats> {
  const effectiveToday = today ?? new Date().toISOString().slice(0, 10);

  // 1. Create job run record
  const [jobRun] = await db
    .insert(orderingJobRuns)
    .values({
      scheduledFor,
      startedAt: new Date(),
      status: 'running',
    })
    .returning();

  let accountsProcessed = 0;
  let ordersConfirmed = 0;
  let ordersFailed = 0;

  try {
    // 2. Recover any expired attempts
    await recoverExpiredAttempts(db);

    // 3. Find connected portal accounts
    const accounts = await db
      .select({ id: portalAccounts.id, workspaceId: portalAccounts.workspaceId, credentialsEncrypted: portalAccounts.credentialsEncrypted })
      .from(portalAccounts)
      .where(eq(portalAccounts.status, 'connected'));

    for (const acc of accounts) {
      // Find candidate for account
      const candidate = await findCandidatesForAccount(db, acc.id, effectiveToday);
      if (!candidate) continue;

      accountsProcessed++;

      // Phase 1: Reserve candidate
      const reservation = await reserveCandidate(db, acc, candidate, jobRun.id);
      if (!reservation) continue;

      try {
        // Decrypt credentials
        const creds = decryptPortalCredentials(acc.credentialsEncrypted, acc.id);

        // Portal interactions:
        // Login
        await client.login(creds);

        // Resolve card
        await client.resolveMappedCard({
          portalCardId: candidate.portalCardId,
          portalCardbinId: candidate.portalCardbinId,
        });

        // Verify offer
        const offer = await client.verifyOffer({
          portalCardId: candidate.portalCardId,
          portalCardbinId: candidate.portalCardbinId,
          offerId: candidate.chosenOptionId ?? undefined,
        });

        if (!offer.available) {
          throw new PortalOrderError('offer_unavailable', 'Offer is no longer available on portal', false);
        }

        // Phase 2: Start submission
        const canSubmit = await startSubmission(db, reservation.id);
        if (!canSubmit) {
          continue;
        }

        // Submit order
        const result = await client.submitOrder({
          portalCardId: candidate.portalCardId,
          portalCardbinId: candidate.portalCardbinId,
          offerId: candidate.chosenOptionId ?? undefined,
        });

        // Finalize confirmed order
        await finalizeConfirmedOrder(db, reservation.id, result.bookingReference, effectiveToday);
        ordersConfirmed++;
      } catch (err) {
        ordersFailed++;
        await finalizeFailedOrder(db, reservation.id, err instanceof Error ? err : new Error(String(err)));
      } finally {
        await client.close();
      }
    }

    await db
      .update(orderingJobRuns)
      .set({
        status: 'completed',
        finishedAt: new Date(),
        accountsProcessed,
        ordersConfirmed,
        ordersFailed,
      })
      .where(eq(orderingJobRuns.id, jobRun.id));

    return {
      jobRunId: jobRun.id,
      accountsProcessed,
      ordersConfirmed,
      ordersFailed,
      status: 'completed',
    };
  } catch (err) {
    await db
      .update(orderingJobRuns)
      .set({
        status: 'failed',
        finishedAt: new Date(),
        accountsProcessed,
        ordersConfirmed,
        ordersFailed,
        failureCode: err instanceof Error ? err.message : 'Unknown fatal job error',
      })
      .where(eq(orderingJobRuns.id, jobRun.id));

    return {
      jobRunId: jobRun.id,
      accountsProcessed,
      ordersConfirmed,
      ordersFailed,
      status: 'failed',
    };
  }
}
