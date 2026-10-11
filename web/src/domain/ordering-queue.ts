import { eq, and, gte, asc, inArray } from 'drizzle-orm';
import type { Ctx } from '@/lib/context';
import * as schema from '@/db/schema';
import { resolveOfferKind } from '@/domain/benefit-offer-kind';

export interface QueueItemView {
  id: string;
  instanceId: string;
  cardId: string;
  cardName: string;
  cardLast4: string;
  holderName: string;
  portalAccountId: string | null;
  portalAccountLabel: string | null;
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

export type QueueSortStrategy = 'nearest_expiring' | 'highest_value';

function computeDaysRemaining(deadline: string, today: string): number {
  const dDead = new Date(`${deadline}T00:00:00Z`).getTime();
  const dToday = new Date(`${today}T00:00:00Z`).getTime();
  return Math.ceil((dDead - dToday) / (24 * 60 * 60 * 1000));
}

/**
 * Lists all pending voucher benefits in the workspace's Order Queue.
 *
 * Rules:
 * 1. Only 'Not Ordered' benefit instances whose order deadline >= today.
 * 2. Belong to an active card with payment details.
 * 3. Card is mapped to at least one active, connected RuPay portal account.
 * 4. Strictly EXCLUDES discounts (BookMyShow, MakeMyTrip, Tax, Golf, etc.).
 *    Cab services (Uber, Ola, etc.) are full gift vouchers and ARE included.
 */
export async function listOrderingQueue(ctx: Ctx): Promise<QueueItemView[]> {
  // 1. Fetch eligible cards in workspace (active + mapped to a connected portal account)
  const mappedCards = await ctx.db
    .select({
      cardId: schema.portalCardMappings.cardId,
      portalAccountId: schema.portalAccounts.id,
      portalAccountLabel: schema.portalAccounts.label,
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
        eq(schema.cards.active, true),
      ),
    );

  if (mappedCards.length === 0) return [];

  const eligibleCardIds = Array.from(new Set(mappedCards.map((m) => m.cardId)));
  const cardToAccountMap = new Map<string, { id: string; label: string }>();
  for (const m of mappedCards) {
    if (!cardToAccountMap.has(m.cardId)) {
      cardToAccountMap.set(m.cardId, { id: m.portalAccountId, label: m.portalAccountLabel });
    }
  }

  // 2. Fetch pending benefit instances for these cards
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
        inArray(schema.benefitInstances.cardId, eligibleCardIds),
        eq(schema.benefitInstances.orderStatus, 'Not Ordered'),
        gte(schema.benefitInstances.orderDeadline, ctx.today),
      ),
    );

  if (instances.length === 0) return [];

  // 3. Collect version IDs to fetch options for pick-one benefits
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

  // 4. Filter strictly for vouchers (exclude discounts) and format candidates
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
      // Exclude BookMyShow, MakeMyTrip, Tax, Golf, etc.
      continue;
    }

    const account = cardToAccountMap.get(row.cardId);
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
        portalAccountId: account?.id ?? null,
        portalAccountLabel: account?.label ?? null,
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

  // 5. Sort candidates:
  // - If item has stored position, sort by position ASC.
  // - If no stored position, sort by nearest deadline first, then highest value first.
  candidates.sort((a, b) => {
    if (a.hasStoredPosition && b.hasStoredPosition) {
      if (a.item.position !== b.item.position) {
        return a.item.position - b.item.position;
      }
    } else if (a.hasStoredPosition && !b.hasStoredPosition) {
      return -1;
    } else if (!a.hasStoredPosition && b.hasStoredPosition) {
      return 1;
    }

    // Default smart sort: Nearest expiring first, then highest cash value
    if (a.item.orderDeadline !== b.item.orderDeadline) {
      return a.item.orderDeadline.localeCompare(b.item.orderDeadline);
    }
    if (a.item.cashValue !== b.item.cashValue) {
      return b.item.cashValue - a.item.cashValue;
    }
    return a.item.instanceId.localeCompare(b.item.instanceId);
  });

  // Assign normalized 1-based sequential positions for UI presentation
  return candidates.map((c, idx) => ({
    ...c.item,
    position: idx + 1,
  }));
}

/**
 * Populates and sorts the Order Queue dynamically.
 *
 * Strategies:
 * - 'nearest_expiring' (Default): order_deadline ASC, then cash_value DESC
 * - 'highest_value': cash_value DESC, then order_deadline ASC
 */
export async function populateAndSortQueue(
  ctx: Ctx,
  strategy: QueueSortStrategy = 'nearest_expiring',
): Promise<QueueItemView[]> {
  const current = await listOrderingQueue(ctx);
  if (current.length === 0) return [];

  // Sort based on requested strategy
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
  // First ensure row exists in orderingQueueItems
  await ctx.db
    .insert(schema.orderingQueueItems)
    .values({
      workspaceId: ctx.workspaceId,
      instanceId: input.instanceId,
      position: input.position ?? 0,
      enabled: input.enabled ?? true,
      chosenOptionId: input.chosenOptionId ?? null,
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
 * Moves an item up or down in the Order Queue.
 */
export async function moveQueueItem(
  ctx: Ctx,
  instanceId: string,
  direction: 'up' | 'down',
): Promise<QueueItemView[]> {
  const queue = await listOrderingQueue(ctx);
  const index = queue.findIndex((item) => item.instanceId === instanceId);
  if (index === -1) return queue;

  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (targetIndex < 0 || targetIndex >= queue.length) return queue;

  // Swap in array
  const temp = queue[index];
  queue[index] = queue[targetIndex];
  queue[targetIndex] = temp;

  // Persist updated positions
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    item.position = i + 1;
    await updateQueueItem(ctx, {
      instanceId: item.instanceId,
      position: item.position,
      enabled: item.enabled,
      chosenOptionId: item.chosenOptionId,
    });
  }

  return queue;
}
