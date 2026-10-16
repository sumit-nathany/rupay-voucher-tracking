import { eq, and, gte, asc, inArray, notInArray, isNull } from 'drizzle-orm';
import type { Ctx } from '@/lib/context';
import * as schema from '@/db/schema';
import { resolveOfferKind } from '@/domain/benefit-offer-kind';
import { decryptPaymentDetails, isValidPaymentDetails } from '@/lib/card-payment-details';

export interface QueueItemView {
  id: string;
  instanceId: string;
  cardId: string;
  cardName: string;
  cardLast4: string;
  holderName: string;
  portalAccountId: string | null;
  portalAccountLabel: string | null;
  portalAccounts: Array<{ id: string; label: string }>;
  benefitType: string;
  exactBenefit: string;
  benefitProvider: string | null;
  orderDeadline: string;
  daysRemaining: number;
  cashValue: number;
  position: number;
  enabled: boolean;
  chosenOptionId: string | null;
  chosenOptionName: string | null;
  availableOptions: Array<{ id: string; provider: string; offerName: string; cashValue: number | null }>;
}

export interface QueueFilter {
  cardId?: string;
  portalAccountId?: string;
}

export type QueueSortStrategy = 'nearest_expiring' | 'highest_value';

function computeDaysRemaining(deadline: string, today: string): number {
  const dDead = new Date(`${deadline}T00:00:00Z`).getTime();
  const dToday = new Date(`${today}T00:00:00Z`).getTime();
  return Math.ceil((dDead - dToday) / (24 * 60 * 60 * 1000));
}

/**
 * Lists pending voucher benefits in the Order Queue.
 *
 * Rules:
 * 1. Shows 'Not Ordered' benefit instances where order deadline >= today.
 * 2. Scoped by cardId or portalAccountId if filter is provided.
 * 3. Strictly EXCLUDES discounts (BookMyShow, MakeMyTrip, Cleartrip, TaxSpanner, Golf, etc.).
 *    Cab services (Uber, Ola, etc.) are gift vouchers and ARE included.
 */
/**
 * Fetches raw eligible voucher candidates for the workspace before position assignment.
 */
async function fetchRawQueueCandidates(
  ctx: Ctx,
  filter?: QueueFilter,
): Promise<Array<{ item: QueueItemView; hasStoredPosition: boolean }>> {
  // 1. Fetch active cards in workspace
  const activeCards = await ctx.db
    .select({
      id: schema.cards.id,
      displayName: schema.cards.displayName,
      lastDigits: schema.cards.lastDigits,
      holderId: schema.cards.holderId,
    })
    .from(schema.cards)
    .where(
      and(
        eq(schema.cards.workspaceId, ctx.workspaceId),
        eq(schema.cards.active, true),
      ),
    );

  if (activeCards.length === 0) return [];

  // 2. Fetch portal mappings for all cards in workspace (only cards with valid payment details and connected portal accounts)
  const mappings = await ctx.db
    .select({
      id: schema.portalCardMappings.id,
      cardId: schema.portalCardMappings.cardId,
      portalAccountId: schema.portalAccounts.id,
      portalAccountLabel: schema.portalAccounts.label,
      mappingPaymentDetailsEncrypted: schema.portalCardMappings.paymentDetailsEncrypted,
      cardPaymentDetailsEncrypted: schema.cards.paymentDetailsEncrypted,
    })
    .from(schema.portalCardMappings)
    .innerJoin(
      schema.portalAccounts,
      eq(schema.portalCardMappings.portalAccountId, schema.portalAccounts.id),
    )
    .innerJoin(
      schema.cards,
      eq(schema.portalCardMappings.cardId, schema.cards.id),
    )
    .where(
      and(
        eq(schema.portalCardMappings.workspaceId, ctx.workspaceId),
        eq(schema.portalCardMappings.active, true),
        eq(schema.portalAccounts.status, 'connected'),
      ),
    );

  const cardToAccountsMap = new Map<string, Array<{ id: string; label: string }>>();
  const accountToCardIdsMap = new Map<string, Set<string>>();
  for (const m of mappings) {
    let hasValid = false;
    if (m.cardPaymentDetailsEncrypted) {
      try {
        const dec = decryptPaymentDetails(m.cardPaymentDetailsEncrypted, m.cardId);
        if (isValidPaymentDetails(dec)) hasValid = true;
      } catch {}
    }
    if (!hasValid && m.mappingPaymentDetailsEncrypted) {
      try {
        const dec = decryptPaymentDetails(m.mappingPaymentDetailsEncrypted, m.id);
        if (isValidPaymentDetails(dec)) hasValid = true;
      } catch {}
    }
    if (!hasValid) continue;

    const list = cardToAccountsMap.get(m.cardId) || [];
    list.push({ id: m.portalAccountId, label: m.portalAccountLabel });
    cardToAccountsMap.set(m.cardId, list);

    const cardSet = accountToCardIdsMap.get(m.portalAccountId) || new Set<string>();
    cardSet.add(m.cardId);
    accountToCardIdsMap.set(m.portalAccountId, cardSet);
  }

  // 3. Determine target card IDs based on filter
  let targetCardIds = activeCards.map((c) => c.id);

  if (filter?.portalAccountId) {
    const cardSet = accountToCardIdsMap.get(filter.portalAccountId);
    if (!cardSet || cardSet.size === 0) return [];
    targetCardIds = targetCardIds.filter((cid) => cardSet.has(cid));
  } else if (filter?.cardId) {
    targetCardIds = targetCardIds.filter((cid) => cid === filter.cardId);
  }

  if (targetCardIds.length === 0) return [];

  // 4. Fetch pending benefit instances for target cards
  const instances = await ctx.db
    .select({
      id: schema.benefitInstances.id,
      cardId: schema.benefitInstances.cardId,
      orderDeadline: schema.benefitInstances.orderDeadline,
      cashValue: schema.benefitInstances.cashValue,
      chosenOptionId: schema.benefitInstances.chosenOptionId,
      cardDisplayName: schema.cards.displayName,
      cardLastDigits: schema.cards.lastDigits,
      holderName: schema.cardHolders.name,
      // Catalog version metadata
      catBenefitType: schema.benefitCatalogVersions.benefitType,
      catExactBenefit: schema.benefitCatalogVersions.exactBenefit,
      catBenefitProvider: schema.benefitCatalogVersions.benefitProvider,
      catOfferKind: schema.benefitCatalogVersions.offerKind,
      catVersionId: schema.benefitCatalogVersions.id,
      // Override metadata
      ovBenefitType: schema.cardBenefitOverrides.benefitType,
      ovExactBenefit: schema.cardBenefitOverrides.exactBenefit,
      ovBenefitProvider: schema.cardBenefitOverrides.benefitProvider,
      ovOfferKind: schema.cardBenefitOverrides.offerKind,
      // Stored queue item details
      queueItemId: schema.orderingQueueItems.id,
      queuePosition: schema.orderingQueueItems.position,
      queueEnabled: schema.orderingQueueItems.enabled,
      queueChosenOptionId: schema.orderingQueueItems.chosenOptionId,
    })
    .from(schema.benefitInstances)
    .innerJoin(schema.cards, eq(schema.benefitInstances.cardId, schema.cards.id))
    .innerJoin(schema.cardHolders, eq(schema.cards.holderId, schema.cardHolders.id))
    .leftJoin(
      schema.benefitCatalogVersions,
      eq(schema.benefitInstances.generatedFromVersion, schema.benefitCatalogVersions.id),
    )
    .leftJoin(
      schema.cardBenefitOverrides,
      eq(schema.benefitInstances.overrideId, schema.cardBenefitOverrides.id),
    )
    .leftJoin(
      schema.orderingQueueItems,
      and(
        eq(schema.benefitInstances.workspaceId, schema.orderingQueueItems.workspaceId),
        eq(schema.benefitInstances.id, schema.orderingQueueItems.instanceId),
      ),
    )
    .where(
      and(
        eq(schema.benefitInstances.workspaceId, ctx.workspaceId),
        inArray(schema.benefitInstances.cardId, targetCardIds),
        eq(schema.benefitInstances.orderStatus, 'Not Ordered'),
        gte(schema.benefitInstances.orderDeadline, ctx.today),
        isNull(schema.benefitInstances.soldFor),
      ),
    );

  if (instances.length === 0) return [];

  // 5. Collect version IDs to fetch options for pick-one benefits
  const versionIds = Array.from(
    new Set(instances.map((i) => i.catVersionId).filter((v): v is string => Boolean(v))),
  );

  const optionsMap = new Map<
    string,
    Array<{ id: string; provider: string; offerName: string; cashValue: number | null }>
  >();

  if (versionIds.length > 0) {
    const rawOptions = await ctx.db
      .select({
        id: schema.benefitOptions.id,
        versionId: schema.benefitOptions.versionId,
        provider: schema.benefitOptions.provider,
        offerName: schema.benefitOptions.offerName,
        cashValue: schema.benefitOptions.cashValue,
      })
      .from(schema.benefitOptions)
      .where(inArray(schema.benefitOptions.versionId, versionIds))
      .orderBy(asc(schema.benefitOptions.sortOrder));

    for (const opt of rawOptions) {
      const list = optionsMap.get(opt.versionId) || [];
      list.push({
        id: opt.id,
        provider: opt.provider,
        offerName: opt.offerName,
        cashValue: opt.cashValue ? parseFloat(opt.cashValue) : null,
      });
      optionsMap.set(opt.versionId, list);
    }
  }

  // 6. Filter strictly for vouchers (exclude discounts) and format candidates
  const candidates: Array<{
    item: QueueItemView;
    hasStoredPosition: boolean;
  }> = [];

  for (const row of instances) {
    const benefitType = row.catBenefitType || row.ovBenefitType || 'Benefit';
    const exactBenefit = row.catExactBenefit || row.ovExactBenefit || '';
    const benefitProvider = row.catBenefitProvider || row.ovBenefitProvider || null;
    const storedOfferKind = (row.catOfferKind || row.ovOfferKind) as
      | 'voucher'
      | 'discount'
      | null;

    const offerKind = resolveOfferKind(storedOfferKind, benefitType, benefitProvider, exactBenefit);
    if (offerKind === 'discount') {
      // Exclude BookMyShow, MakeMyTrip, Cleartrip, TaxSpanner, Golf, etc.
      continue;
    }

    const mappedAccounts = cardToAccountsMap.get(row.cardId) || [];
    const availableOpts = (row.catVersionId ? optionsMap.get(row.catVersionId) : []) || [];
    const chosenOptId = row.queueChosenOptionId || row.chosenOptionId || (availableOpts[0]?.id ?? null);
    const chosenOptName = availableOpts.find((o) => o.id === chosenOptId)?.offerName ?? null;
    const cashVal = row.cashValue ? parseFloat(row.cashValue) : 0;
    const daysRemaining = computeDaysRemaining(row.orderDeadline, ctx.today);

    candidates.push({
      hasStoredPosition: row.queuePosition !== null && row.queuePosition !== undefined,
      item: {
        id: row.queueItemId || row.id,
        instanceId: row.id,
        cardId: row.cardId,
        cardName: row.cardDisplayName,
        cardLast4: row.cardLastDigits,
        holderName: row.holderName,
        portalAccountId: mappedAccounts[0]?.id ?? null,
        portalAccountLabel: mappedAccounts[0]?.label ?? null,
        portalAccounts: mappedAccounts,
        benefitType,
        exactBenefit,
        benefitProvider,
        orderDeadline: row.orderDeadline,
        daysRemaining,
        cashValue: cashVal,
        position: row.queuePosition ?? 0,
        enabled: row.queueEnabled ?? true,
        chosenOptionId: chosenOptId,
        chosenOptionName: chosenOptName,
        availableOptions: availableOpts,
      },
    });
  }

  return candidates;
}

/**
 * Automatically synchronizes the workspace's Global Ordering Queue:
 * 1. Discovers all eligible pending voucher instances matching criteria.
 * 2. Cleans up stale entries from ordering_queue_items (e.g. ordered/expired).
 * 3. Preserves user-assigned positions for existing items.
 * 4. Appends newly discovered eligible instances sequentially using default smart sort
 *    (Nearest Expiring First, then Highest Value First).
 * 5. Automatically writes all items and positions to ordering_queue_items so that the
 *    database is always 100% up to date without requiring manual clicks.
 */
export async function syncGlobalOrderingQueue(ctx: Ctx): Promise<QueueItemView[]> {
  const candidates = await fetchRawQueueCandidates(ctx);

  if (candidates.length === 0) {
    // Clean up any remaining queue items in workspace since no instances are eligible
    await ctx.db
      .delete(schema.orderingQueueItems)
      .where(eq(schema.orderingQueueItems.workspaceId, ctx.workspaceId));
    return [];
  }

  // 1. Clean up stale items in ordering_queue_items that no longer exist in eligible candidates
  const validInstanceIds = candidates.map((c) => c.item.instanceId);
  await ctx.db
    .delete(schema.orderingQueueItems)
    .where(
      and(
        eq(schema.orderingQueueItems.workspaceId, ctx.workspaceId),
        notInArray(schema.orderingQueueItems.instanceId, validInstanceIds),
      ),
    );

  // 2. Separate into existing items (with user-defined / stored position) and new items
  const existing = candidates.filter((c) => c.hasStoredPosition);
  const newItems = candidates.filter((c) => !c.hasStoredPosition);

  // Sort new items by default smart criteria: Nearest Expiring First, then Highest Value First
  newItems.sort((a, b) => {
    if (a.item.orderDeadline !== b.item.orderDeadline) {
      return a.item.orderDeadline.localeCompare(b.item.orderDeadline);
    }
    if (a.item.cashValue !== b.item.cashValue) {
      return b.item.cashValue - a.item.cashValue;
    }
    return a.item.instanceId.localeCompare(b.item.instanceId);
  });

  let allOrdered: Array<{ item: QueueItemView; hasStoredPosition: boolean }>;

  if (existing.length === 0) {
    // Initial run: all items sorted by default smart criteria
    allOrdered = newItems;
  } else {
    // Preserve existing items' relative order
    existing.sort((a, b) => a.item.position - b.item.position);
    // Append new items at the end
    allOrdered = [...existing, ...newItems];
  }

  // 3. Assign sequential positions 1..N and persist to database
  const result: QueueItemView[] = [];

  for (let idx = 0; idx < allOrdered.length; idx++) {
    const c = allOrdered[idx];
    const newPos = idx + 1;
    const posChanged = c.item.position !== newPos || !c.hasStoredPosition;

    c.item.position = newPos;

    if (posChanged) {
      await ctx.db
        .insert(schema.orderingQueueItems)
        .values({
          workspaceId: ctx.workspaceId,
          instanceId: c.item.instanceId,
          position: newPos,
          enabled: c.item.enabled,
          chosenOptionId: c.item.chosenOptionId,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [schema.orderingQueueItems.workspaceId, schema.orderingQueueItems.instanceId],
          set: {
            position: newPos,
            updatedAt: new Date(),
          },
        });
    }

    result.push(c.item);
  }

  return result;
}

/**
 * Lists pending voucher benefits in the Order Queue.
 * Automatically synchronizes with the database so positions are persisted and up to date.
 */
export async function listOrderingQueue(
  ctx: Ctx,
  filter?: QueueFilter,
): Promise<QueueItemView[]> {
  const all = await syncGlobalOrderingQueue(ctx);

  if (!filter || (!filter.cardId && !filter.portalAccountId)) {
    return all;
  }

  return all.filter((i) => {
    if (filter.cardId && i.cardId !== filter.cardId) return false;
    if (filter.portalAccountId) {
      const matches =
        i.portalAccountId === filter.portalAccountId ||
        i.portalAccounts.some((a) => a.id === filter.portalAccountId);
      if (!matches) return false;
    }
    return true;
  });
}

/**
 * Populates and sorts the Order Queue dynamically with an explicit strategy.
 *
 * Strategies:
 * - 'nearest_expiring' (Default): order_deadline ASC, then cash_value DESC
 * - 'highest_value': cash_value DESC, then order_deadline ASC
 */
export async function populateAndSortQueue(
  ctx: Ctx,
  strategy: QueueSortStrategy = 'nearest_expiring',
  filter?: QueueFilter,
): Promise<QueueItemView[]> {
  // Sync first to ensure all eligible instances are present
  await syncGlobalOrderingQueue(ctx);
  const current = await listOrderingQueue(ctx, filter);
  if (current.length === 0) return [];

  current.sort((a, b) => {
    if (strategy === 'nearest_expiring') {
      if (a.orderDeadline !== b.orderDeadline) {
        return a.orderDeadline.localeCompare(b.orderDeadline);
      }
      if (a.cashValue !== b.cashValue) {
        return b.cashValue - a.cashValue;
      }
    } else {
      if (a.cashValue !== b.cashValue) {
        return b.cashValue - a.cashValue;
      }
      if (a.orderDeadline !== b.orderDeadline) {
        return a.orderDeadline.localeCompare(b.orderDeadline);
      }
    }
    return a.instanceId.localeCompare(b.instanceId);
  });

  // Persist sequential positions in ordering_queue_items
  for (let idx = 0; idx < current.length; idx++) {
    const item = current[idx];
    const newPos = idx + 1;
    item.position = newPos;

    await ctx.db
      .insert(schema.orderingQueueItems)
      .values({
        workspaceId: ctx.workspaceId,
        instanceId: item.instanceId,
        position: newPos,
        enabled: item.enabled,
        chosenOptionId: item.chosenOptionId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.orderingQueueItems.workspaceId, schema.orderingQueueItems.instanceId],
        set: {
          position: newPos,
          updatedAt: new Date(),
        },
      });
  }

  return current;
}

/**
 * Updates an item in the Order Queue (enable/disable, choose option, or update position).
 */
export async function updateQueueItem(
  ctx: Ctx,
  input: {
    instanceId: string;
    enabled?: boolean;
    chosenOptionId?: string | null;
    position?: number;
  },
): Promise<void> {
  let defaultOptionId: string | null = input.chosenOptionId ?? null;
  if (input.chosenOptionId === undefined) {
    const [inst] = await ctx.db
      .select({ chosenOptionId: schema.benefitInstances.chosenOptionId })
      .from(schema.benefitInstances)
      .where(
        and(
          eq(schema.benefitInstances.workspaceId, ctx.workspaceId),
          eq(schema.benefitInstances.id, input.instanceId),
        ),
      );
    if (inst?.chosenOptionId) {
      defaultOptionId = inst.chosenOptionId;
    }
  }

  await ctx.db
    .insert(schema.orderingQueueItems)
    .values({
      workspaceId: ctx.workspaceId,
      instanceId: input.instanceId,
      position: input.position ?? 0,
      enabled: input.enabled ?? true,
      chosenOptionId: defaultOptionId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [schema.orderingQueueItems.workspaceId, schema.orderingQueueItems.instanceId],
      set: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.chosenOptionId !== undefined ? { chosenOptionId: input.chosenOptionId } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
        updatedAt: new Date(),
      },
    });

  // Also sync chosenOptionId to benefit_instances so instance record stays consistent
  if (input.chosenOptionId !== undefined) {
    await ctx.db
      .update(schema.benefitInstances)
      .set({ chosenOptionId: input.chosenOptionId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.benefitInstances.workspaceId, ctx.workspaceId),
          eq(schema.benefitInstances.id, input.instanceId),
        ),
      );
  }
}

/**
 * Reorders a list of instance IDs in explicit order.
 */
export async function reorderQueue(
  ctx: Ctx,
  orderedInstanceIds: string[],
): Promise<void> {
  for (let idx = 0; idx < orderedInstanceIds.length; idx++) {
    const instId = orderedInstanceIds[idx];
    await updateQueueItem(ctx, {
      instanceId: instId,
      position: idx + 1,
    });
  }
}

/**
 * Moves an item up or down in the Order Queue.
 */
export async function moveQueueItem(
  ctx: Ctx,
  instanceId: string,
  direction: 'up' | 'down',
  currentInstanceIds?: string[],
): Promise<QueueItemView[]> {
  const ids = currentInstanceIds ?? (await listOrderingQueue(ctx)).map((i) => i.instanceId);
  const index = ids.indexOf(instanceId);
  if (index === -1) return listOrderingQueue(ctx);

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= ids.length) return listOrderingQueue(ctx);

  const nextIds = [...ids];
  const temp = nextIds[index];
  nextIds[index] = nextIds[targetIndex];
  nextIds[targetIndex] = temp;

  await reorderQueue(ctx, nextIds);
  return listOrderingQueue(ctx);
}
