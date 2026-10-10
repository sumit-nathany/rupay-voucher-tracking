import { and, eq, inArray, isNull, or, sql, desc, asc, gte } from 'drizzle-orm';
import {
  automationSettings,
  portalAccounts,
  portalCardMappings,
  orderingRules,
  orderingRuleCards,
  orderingRuleBenefits,
  orderingRuleOptionDefaults,
  portalOrderAttempts,
  cards,
  cardHolders,
  benefitInstances,
  benefitCatalogVersions,
  benefitOptions,
  bankCardTypes,
} from '@/db/schema';
import type { Ctx, Database } from '@/lib/context';
import { NotFoundError } from '@/lib/context';
import { encryptPortalCredentials } from '@/lib/portal-credentials';

// ── Types and Views ──────────────────────────────────────────────────────────

export interface PortalAccountView {
  id: string;
  workspaceId: string;
  label: string;
  status: 'connected' | 'paused' | 'credentials_expired' | 'challenge_required' | 'portal_changed' | 'needs_attention';
  hasCredentials: boolean;
  lastConfirmedOrderAt: string | null;
  lastCheckedAt: string | null;
  statusDetailCode: string | null;
  createdAt: string;
  updatedAt: string;
  mappingsCount: number;
  rulesCount: number;
}

export interface PortalCardMappingView {
  id: string;
  workspaceId: string;
  portalAccountId: string;
  cardId: string;
  cardName: string;
  holderName: string;
  last4: string | null;
  portalCardId: string;
  portalCardbinId: string | null;
  portalCardLabel: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderingRuleView {
  id: string;
  workspaceId: string;
  portalAccountId: string;
  name: string;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
  cardIds: string[];
  benefitIds: string[];
  optionDefaults: Array<{ benefitId: string; optionId: string }>;
}

export interface AttemptView {
  id: string;
  workspaceId: string;
  portalAccountId: string;
  portalAccountLabel: string;
  ruleId: string | null;
  ruleName: string | null;
  instanceId: string;
  benefitName: string;
  cardName: string;
  holderName: string;
  state: 'reserved' | 'submitting' | 'confirmed' | 'failed_pre_submit' | 'uncertain' | 'resolved_no_order' | 'cancelled';
  reservedAt: string;
  submissionStartedAt: string | null;
  finishedAt: string | null;
  bookingReference: string | null;
  failureCode: string | null;
}

export interface CandidateNomination {
  candidate: {
    instanceId: string;
    cardId: string;
    benefitId: string;
    orderDeadline: string;
    chosenOptionId: string | null;
    portalCardId: string;
    portalCardbinId: string | null;
    ruleId: string;
    rulePriority: number;
    portalAccountId: string;
  };
}

// ── Settings ────────────────────────────────────────────────────────────────

export async function getAutomationSettings(ctx: Ctx): Promise<{ enabled: boolean; updatedAt: string }> {
  const [row] = await ctx.db
    .select()
    .from(automationSettings)
    .where(eq(automationSettings.workspaceId, ctx.workspaceId));

  if (!row) {
    const [created] = await ctx.db
      .insert(automationSettings)
      .values({ workspaceId: ctx.workspaceId, enabled: false })
      .returning();
    return { enabled: created.enabled, updatedAt: created.updatedAt.toISOString() };
  }

  return { enabled: row.enabled, updatedAt: row.updatedAt.toISOString() };
}

export async function saveAutomationSettings(
  ctx: Ctx,
  input: { enabled: boolean },
): Promise<{ enabled: boolean; updatedAt: string }> {
  const [row] = await ctx.db
    .insert(automationSettings)
    .values({ workspaceId: ctx.workspaceId, enabled: input.enabled, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: automationSettings.workspaceId,
      set: { enabled: input.enabled, updatedAt: new Date() },
    })
    .returning();

  return { enabled: row.enabled, updatedAt: row.updatedAt.toISOString() };
}

// ── Portal Accounts ─────────────────────────────────────────────────────────

export async function listPortalAccounts(ctx: Ctx): Promise<PortalAccountView[]> {
  const accounts = await ctx.db
    .select()
    .from(portalAccounts)
    .where(eq(portalAccounts.workspaceId, ctx.workspaceId))
    .orderBy(asc(portalAccounts.label));

  if (accounts.length === 0) return [];

  const mappings = await ctx.db
    .select({ portalAccountId: portalCardMappings.portalAccountId, count: sql<number>`count(*)::int` })
    .from(portalCardMappings)
    .where(eq(portalCardMappings.workspaceId, ctx.workspaceId))
    .groupBy(portalCardMappings.portalAccountId);

  const rules = await ctx.db
    .select({ portalAccountId: orderingRules.portalAccountId, count: sql<number>`count(*)::int` })
    .from(orderingRules)
    .where(eq(orderingRules.workspaceId, ctx.workspaceId))
    .groupBy(orderingRules.portalAccountId);

  const mappingsMap = new Map(mappings.map((m) => [m.portalAccountId, m.count]));
  const rulesMap = new Map(rules.map((r) => [r.portalAccountId, r.count]));

  return accounts.map((a) => ({
    id: a.id,
    workspaceId: a.workspaceId,
    label: a.label,
    status: a.status as PortalAccountView['status'],
    hasCredentials: Boolean(a.credentialsEncrypted),
    lastConfirmedOrderAt: a.lastConfirmedOrderAt ? a.lastConfirmedOrderAt.toISOString() : null,
    lastCheckedAt: a.lastCheckedAt ? a.lastCheckedAt.toISOString() : null,
    statusDetailCode: a.statusDetailCode,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    mappingsCount: mappingsMap.get(a.id) ?? 0,
    rulesCount: rulesMap.get(a.id) ?? 0,
  }));
}

export async function createPortalAccount(
  ctx: Ctx,
  input: { label: string; credentials: { loginId: string; password: string; extra?: Record<string, string> } },
): Promise<PortalAccountView> {
  const label = input.label.trim();
  if (!label) throw new Error('Label cannot be empty');

  // Generate UUID in application so we can bind it to ciphertext AAD
  const accountId = crypto.randomUUID();
  const credentialsEncrypted = encryptPortalCredentials(
    { version: 1, loginId: input.credentials.loginId, password: input.credentials.password, extra: input.credentials.extra },
    accountId,
  );

  const [row] = await ctx.db
    .insert(portalAccounts)
    .values({
      id: accountId,
      workspaceId: ctx.workspaceId,
      label,
      credentialsEncrypted,
      status: 'connected',
    })
    .returning();

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    status: row.status as PortalAccountView['status'],
    hasCredentials: true,
    lastConfirmedOrderAt: null,
    lastCheckedAt: null,
    statusDetailCode: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    mappingsCount: 0,
    rulesCount: 0,
  };
}

export async function updatePortalAccount(
  ctx: Ctx,
  input: { id: string; label?: string; credentials?: { loginId: string; password: string; extra?: Record<string, string> } },
): Promise<PortalAccountView> {
  const [existing] = await ctx.db
    .select()
    .from(portalAccounts)
    .where(and(eq(portalAccounts.workspaceId, ctx.workspaceId), eq(portalAccounts.id, input.id)));

  if (!existing) throw new NotFoundError('Portal account not found');

  const patch: Partial<typeof portalAccounts.$inferInsert> = { updatedAt: new Date() };

  if (input.label !== undefined) {
    const l = input.label.trim();
    if (!l) throw new Error('Label cannot be empty');
    patch.label = l;
  }

  if (input.credentials) {
    patch.credentialsEncrypted = encryptPortalCredentials(
      { version: 1, loginId: input.credentials.loginId, password: input.credentials.password, extra: input.credentials.extra },
      existing.id,
    );
    // If status was credentials_expired or challenge_required, reset to connected
    if (existing.status === 'credentials_expired' || existing.status === 'challenge_required') {
      patch.status = 'connected';
      patch.statusDetailCode = null;
    }
  }

  const [row] = await ctx.db
    .update(portalAccounts)
    .set(patch)
    .where(and(eq(portalAccounts.workspaceId, ctx.workspaceId), eq(portalAccounts.id, input.id)))
    .returning();

  return {
    id: row.id,
    workspaceId: row.workspaceId,
    label: row.label,
    status: row.status as PortalAccountView['status'],
    hasCredentials: true,
    lastConfirmedOrderAt: row.lastConfirmedOrderAt ? row.lastConfirmedOrderAt.toISOString() : null,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    statusDetailCode: row.statusDetailCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    mappingsCount: 0,
    rulesCount: 0,
  };
}

export async function pausePortalAccount(ctx: Ctx, id: string): Promise<void> {
  await ctx.db
    .update(portalAccounts)
    .set({ status: 'paused', updatedAt: new Date() })
    .where(and(eq(portalAccounts.workspaceId, ctx.workspaceId), eq(portalAccounts.id, id)));
}

export async function resumePortalAccount(ctx: Ctx, id: string): Promise<void> {
  await ctx.db
    .update(portalAccounts)
    .set({ status: 'connected', updatedAt: new Date() })
    .where(and(eq(portalAccounts.workspaceId, ctx.workspaceId), eq(portalAccounts.id, id)));
}

export async function deletePortalAccount(ctx: Ctx, id: string): Promise<void> {
  await ctx.db
    .delete(portalAccounts)
    .where(and(eq(portalAccounts.workspaceId, ctx.workspaceId), eq(portalAccounts.id, id)));
}

// ── Card Mappings ───────────────────────────────────────────────────────────

export async function listPortalCardMappings(ctx: Ctx, portalAccountId?: string): Promise<PortalCardMappingView[]> {
  const query = ctx.db
    .select({
      id: portalCardMappings.id,
      workspaceId: portalCardMappings.workspaceId,
      portalAccountId: portalCardMappings.portalAccountId,
      cardId: portalCardMappings.cardId,
      cardName: bankCardTypes.displayName,
      holderName: cardHolders.name,
      last4: cards.lastDigits,
      portalCardId: portalCardMappings.portalCardId,
      portalCardbinId: portalCardMappings.portalCardbinId,
      portalCardLabel: portalCardMappings.portalCardLabel,
      active: portalCardMappings.active,
      createdAt: portalCardMappings.createdAt,
      updatedAt: portalCardMappings.updatedAt,
    })
    .from(portalCardMappings)
    .innerJoin(cards, eq(portalCardMappings.cardId, cards.id))
    .innerJoin(bankCardTypes, eq(cards.bankCardTypeId, bankCardTypes.id))
    .innerJoin(cardHolders, eq(cards.holderId, cardHolders.id))
    .where(
      and(
        eq(portalCardMappings.workspaceId, ctx.workspaceId),
        portalAccountId ? eq(portalCardMappings.portalAccountId, portalAccountId) : undefined,
      ),
    )
    .orderBy(asc(bankCardTypes.displayName));

  const rows = await query;
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    portalAccountId: r.portalAccountId,
    cardId: r.cardId,
    cardName: r.cardName,
    holderName: r.holderName,
    last4: r.last4,
    portalCardId: r.portalCardId,
    portalCardbinId: r.portalCardbinId,
    portalCardLabel: r.portalCardLabel,
    active: r.active,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function savePortalCardMapping(
  ctx: Ctx,
  input: {
    id?: string;
    portalAccountId: string;
    cardId: string;
    portalCardId: string;
    portalCardbinId?: string | null;
    portalCardLabel?: string | null;
    active?: boolean;
  },
): Promise<void> {
  // Verify card belongs to workspace
  const [c] = await ctx.db
    .select()
    .from(cards)
    .where(and(eq(cards.workspaceId, ctx.workspaceId), eq(cards.id, input.cardId)));
  if (!c) throw new NotFoundError('Card not found in workspace');

  // Verify portal account belongs to workspace
  const [acc] = await ctx.db
    .select()
    .from(portalAccounts)
    .where(and(eq(portalAccounts.workspaceId, ctx.workspaceId), eq(portalAccounts.id, input.portalAccountId)));
  if (!acc) throw new NotFoundError('Portal account not found');

  if (input.id) {
    await ctx.db
      .update(portalCardMappings)
      .set({
        portalAccountId: input.portalAccountId,
        cardId: input.cardId,
        portalCardId: input.portalCardId,
        portalCardbinId: input.portalCardbinId ?? null,
        portalCardLabel: input.portalCardLabel ?? null,
        active: input.active ?? true,
        updatedAt: new Date(),
      })
      .where(and(eq(portalCardMappings.workspaceId, ctx.workspaceId), eq(portalCardMappings.id, input.id)));
  } else {
    await ctx.db
      .insert(portalCardMappings)
      .values({
        workspaceId: ctx.workspaceId,
        portalAccountId: input.portalAccountId,
        cardId: input.cardId,
        portalCardId: input.portalCardId,
        portalCardbinId: input.portalCardbinId ?? null,
        portalCardLabel: input.portalCardLabel ?? null,
        active: input.active ?? true,
      })
      .onConflictDoUpdate({
        target: [portalCardMappings.workspaceId, portalCardMappings.cardId],
        set: {
          portalAccountId: input.portalAccountId,
          portalCardId: input.portalCardId,
          portalCardbinId: input.portalCardbinId ?? null,
          portalCardLabel: input.portalCardLabel ?? null,
          active: input.active ?? true,
          updatedAt: new Date(),
        },
      });
  }
}

export async function deletePortalCardMapping(ctx: Ctx, id: string): Promise<void> {
  await ctx.db
    .delete(portalCardMappings)
    .where(and(eq(portalCardMappings.workspaceId, ctx.workspaceId), eq(portalCardMappings.id, id)));
}

// ── Ordering Rules ──────────────────────────────────────────────────────────

export async function listOrderingRules(ctx: Ctx, portalAccountId?: string): Promise<OrderingRuleView[]> {
  const rules = await ctx.db
    .select()
    .from(orderingRules)
    .where(
      and(
        eq(orderingRules.workspaceId, ctx.workspaceId),
        portalAccountId ? eq(orderingRules.portalAccountId, portalAccountId) : undefined,
      ),
    )
    .orderBy(asc(orderingRules.priority), asc(orderingRules.createdAt));

  if (rules.length === 0) return [];

  const ruleIds = rules.map((r) => r.id);

  const ruleCards = await ctx.db
    .select()
    .from(orderingRuleCards)
    .where(inArray(orderingRuleCards.ruleId, ruleIds));

  const ruleBenefits = await ctx.db
    .select()
    .from(orderingRuleBenefits)
    .where(inArray(orderingRuleBenefits.ruleId, ruleIds));

  const ruleOptions = await ctx.db
    .select()
    .from(orderingRuleOptionDefaults)
    .where(inArray(orderingRuleOptionDefaults.ruleId, ruleIds));

  const cardsByRule = new Map<string, string[]>();
  for (const rc of ruleCards) {
    const list = cardsByRule.get(rc.ruleId) ?? [];
    list.push(rc.cardId);
    cardsByRule.set(rc.ruleId, list);
  }

  const benefitsByRule = new Map<string, string[]>();
  for (const rb of ruleBenefits) {
    const list = benefitsByRule.get(rb.ruleId) ?? [];
    list.push(rb.benefitId);
    benefitsByRule.set(rb.ruleId, list);
  }

  const optionsByRule = new Map<string, Array<{ benefitId: string; optionId: string }>>();
  for (const ro of ruleOptions) {
    const list = optionsByRule.get(ro.ruleId) ?? [];
    list.push({ benefitId: ro.benefitId, optionId: ro.optionId });
    optionsByRule.set(ro.ruleId, list);
  }

  return rules.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    portalAccountId: r.portalAccountId,
    name: r.name,
    enabled: r.enabled,
    priority: r.priority,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    cardIds: cardsByRule.get(r.id) ?? [],
    benefitIds: benefitsByRule.get(r.id) ?? [],
    optionDefaults: optionsByRule.get(r.id) ?? [],
  }));
}

export async function createOrderingRule(
  ctx: Ctx,
  input: {
    portalAccountId: string;
    name: string;
    enabled?: boolean;
    priority?: number;
    cardIds?: string[];
    benefitIds?: string[];
    optionDefaults?: Array<{ benefitId: string; optionId: string }>;
  },
): Promise<OrderingRuleView> {
  const name = input.name.trim();
  if (!name) throw new Error('Rule name cannot be empty');

  // Verify portal account belongs to workspace
  const [acc] = await ctx.db
    .select()
    .from(portalAccounts)
    .where(and(eq(portalAccounts.workspaceId, ctx.workspaceId), eq(portalAccounts.id, input.portalAccountId)));
  if (!acc) throw new NotFoundError('Portal account not found');

  const [rule] = await ctx.db
    .insert(orderingRules)
    .values({
      workspaceId: ctx.workspaceId,
      portalAccountId: input.portalAccountId,
      name,
      enabled: input.enabled ?? true,
      priority: input.priority ?? 10,
    })
    .returning();

  if (input.cardIds && input.cardIds.length > 0) {
    await ctx.db
      .insert(orderingRuleCards)
      .values(input.cardIds.map((cid) => ({ ruleId: rule.id, cardId: cid })));
  }

  if (input.benefitIds && input.benefitIds.length > 0) {
    await ctx.db
      .insert(orderingRuleBenefits)
      .values(input.benefitIds.map((bid) => ({ ruleId: rule.id, benefitId: bid })));
  }

  if (input.optionDefaults && input.optionDefaults.length > 0) {
    await ctx.db
      .insert(orderingRuleOptionDefaults)
      .values(input.optionDefaults.map((od) => ({ ruleId: rule.id, benefitId: od.benefitId, optionId: od.optionId })));
  }

  return {
    id: rule.id,
    workspaceId: rule.workspaceId,
    portalAccountId: rule.portalAccountId,
    name: rule.name,
    enabled: rule.enabled,
    priority: rule.priority,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
    cardIds: input.cardIds ?? [],
    benefitIds: input.benefitIds ?? [],
    optionDefaults: input.optionDefaults ?? [],
  };
}

export async function updateOrderingRule(
  ctx: Ctx,
  input: {
    id: string;
    name?: string;
    enabled?: boolean;
    priority?: number;
    cardIds?: string[];
    benefitIds?: string[];
    optionDefaults?: Array<{ benefitId: string; optionId: string }>;
  },
): Promise<void> {
  const [existing] = await ctx.db
    .select()
    .from(orderingRules)
    .where(and(eq(orderingRules.workspaceId, ctx.workspaceId), eq(orderingRules.id, input.id)));
  if (!existing) throw new NotFoundError('Ordering rule not found');

  const patch: Partial<typeof orderingRules.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) throw new Error('Rule name cannot be empty');
    patch.name = n;
  }
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.priority !== undefined) patch.priority = input.priority;

  await ctx.db
    .update(orderingRules)
    .set(patch)
    .where(and(eq(orderingRules.workspaceId, ctx.workspaceId), eq(orderingRules.id, input.id)));

  if (input.cardIds !== undefined) {
    await ctx.db.delete(orderingRuleCards).where(eq(orderingRuleCards.ruleId, input.id));
    if (input.cardIds.length > 0) {
      await ctx.db
        .insert(orderingRuleCards)
        .values(input.cardIds.map((cid) => ({ ruleId: input.id, cardId: cid })));
    }
  }

  if (input.benefitIds !== undefined) {
    await ctx.db.delete(orderingRuleBenefits).where(eq(orderingRuleBenefits.ruleId, input.id));
    if (input.benefitIds.length > 0) {
      await ctx.db
        .insert(orderingRuleBenefits)
        .values(input.benefitIds.map((bid) => ({ ruleId: input.id, benefitId: bid })));
    }
  }

  if (input.optionDefaults !== undefined) {
    await ctx.db.delete(orderingRuleOptionDefaults).where(eq(orderingRuleOptionDefaults.ruleId, input.id));
    if (input.optionDefaults.length > 0) {
      await ctx.db
        .insert(orderingRuleOptionDefaults)
        .values(input.optionDefaults.map((od) => ({ ruleId: input.id, benefitId: od.benefitId, optionId: od.optionId })));
    }
  }
}

export async function deleteOrderingRule(ctx: Ctx, id: string): Promise<void> {
  await ctx.db
    .delete(orderingRules)
    .where(and(eq(orderingRules.workspaceId, ctx.workspaceId), eq(orderingRules.id, id)));
}

// ── Attempts & History ──────────────────────────────────────────────────────

export async function listAutomationAttempts(ctx: Ctx, limit = 50): Promise<AttemptView[]> {
  const rows = await ctx.db
    .select({
      id: portalOrderAttempts.id,
      workspaceId: portalOrderAttempts.workspaceId,
      portalAccountId: portalOrderAttempts.portalAccountId,
      portalAccountLabel: portalAccounts.label,
      ruleId: portalOrderAttempts.ruleId,
      ruleName: orderingRules.name,
      instanceId: portalOrderAttempts.instanceId,
      benefitName: benefitCatalogVersions.benefitType,
      cardName: bankCardTypes.displayName,
      holderName: cardHolders.name,
      state: portalOrderAttempts.state,
      reservedAt: portalOrderAttempts.reservedAt,
      submissionStartedAt: portalOrderAttempts.submissionStartedAt,
      finishedAt: portalOrderAttempts.finishedAt,
      bookingReference: portalOrderAttempts.bookingReference,
      failureCode: portalOrderAttempts.failureCode,
    })
    .from(portalOrderAttempts)
    .innerJoin(portalAccounts, eq(portalOrderAttempts.portalAccountId, portalAccounts.id))
    .leftJoin(orderingRules, eq(portalOrderAttempts.ruleId, orderingRules.id))
    .innerJoin(benefitInstances, eq(portalOrderAttempts.instanceId, benefitInstances.id))
    .innerJoin(cards, eq(benefitInstances.cardId, cards.id))
    .innerJoin(bankCardTypes, eq(cards.bankCardTypeId, bankCardTypes.id))
    .innerJoin(cardHolders, eq(cards.holderId, cardHolders.id))
    .leftJoin(benefitCatalogVersions, eq(benefitInstances.generatedFromVersion, benefitCatalogVersions.id))
    .where(eq(portalOrderAttempts.workspaceId, ctx.workspaceId))
    .orderBy(desc(portalOrderAttempts.reservedAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    portalAccountId: r.portalAccountId,
    portalAccountLabel: r.portalAccountLabel,
    ruleId: r.ruleId,
    ruleName: r.ruleName,
    instanceId: r.instanceId,
    benefitName: r.benefitName ?? 'Custom Benefit',
    cardName: r.cardName,
    holderName: r.holderName,
    state: r.state as AttemptView['state'],
    reservedAt: r.reservedAt.toISOString(),
    submissionStartedAt: r.submissionStartedAt ? r.submissionStartedAt.toISOString() : null,
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
    bookingReference: r.bookingReference,
    failureCode: r.failureCode,
  }));
}

// ── Candidate Nomination Query ──────────────────────────────────────────────

/**
 * Find the top candidate for each eligible portal account in the given workspace
 * or across all workspaces (for worker execution).
 */
export async function findCandidatesForAccount(
  db: Database,
  portalAccountId: string,
  today: string,
): Promise<CandidateNomination['candidate'] | null> {
  // 1. Verify account is connected and not paused
  const [account] = await db
    .select()
    .from(portalAccounts)
    .where(eq(portalAccounts.id, portalAccountId));

  if (!account || account.status !== 'connected') return null;

  // 2. Verify workspace has automation enabled
  const [settings] = await db
    .select()
    .from(automationSettings)
    .where(eq(automationSettings.workspaceId, account.workspaceId));

  if (!settings || !settings.enabled) return null;

  // 3. 24-Hour limit check:
  // Account must NOT have an attempt with submission_started_at within last 24 hours
  // in confirmed, uncertain, or resolved_no_order states
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentAttempts = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(portalOrderAttempts)
    .where(
      and(
        eq(portalOrderAttempts.portalAccountId, portalAccountId),
        gte(portalOrderAttempts.submissionStartedAt, twentyFourHoursAgo),
        inArray(portalOrderAttempts.state, ['confirmed', 'uncertain', 'resolved_no_order']),
      ),
    );

  if (recentAttempts[0].count > 0) return null;

  // Also check for any active in-flight attempt
  const activeAttempts = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(portalOrderAttempts)
    .where(
      and(
        eq(portalOrderAttempts.portalAccountId, portalAccountId),
        inArray(portalOrderAttempts.state, ['reserved', 'submitting']),
      ),
    );

  if (activeAttempts[0].count > 0) return null;

  // 4. Fetch active card mappings for this account
  const mappings = await db
    .select({
      cardId: portalCardMappings.cardId,
      portalCardId: portalCardMappings.portalCardId,
      portalCardbinId: portalCardMappings.portalCardbinId,
    })
    .from(portalCardMappings)
    .innerJoin(cards, eq(portalCardMappings.cardId, cards.id))
    .where(
      and(
        eq(portalCardMappings.portalAccountId, portalAccountId),
        eq(portalCardMappings.active, true),
        or(isNull(cards.inactiveFrom), gte(cards.inactiveFrom, today)),
      ),
    );

  if (mappings.length === 0) return null;

  const cardMap = new Map(mappings.map((m) => [m.cardId, m]));
  const mappedCardIds = Array.from(cardMap.keys());

  // 5. Fetch enabled rules for this account
  const rules = await db
    .select()
    .from(orderingRules)
    .where(and(eq(orderingRules.portalAccountId, portalAccountId), eq(orderingRules.enabled, true)))
    .orderBy(asc(orderingRules.priority), asc(orderingRules.createdAt));

  if (rules.length === 0) return null;

  const ruleIds = rules.map((r) => r.id);
  const ruleCards = await db.select().from(orderingRuleCards).where(inArray(orderingRuleCards.ruleId, ruleIds));
  const ruleBenefits = await db.select().from(orderingRuleBenefits).where(inArray(orderingRuleBenefits.ruleId, ruleIds));
  const ruleOptions = await db.select().from(orderingRuleOptionDefaults).where(inArray(orderingRuleOptionDefaults.ruleId, ruleIds));

  const ruleCardsMap = new Map<string, Set<string>>();
  for (const rc of ruleCards) {
    const s = ruleCardsMap.get(rc.ruleId) ?? new Set<string>();
    s.add(rc.cardId);
    ruleCardsMap.set(rc.ruleId, s);
  }

  const ruleBenefitsMap = new Map<string, Set<string>>();
  for (const rb of ruleBenefits) {
    const s = ruleBenefitsMap.get(rb.ruleId) ?? new Set<string>();
    s.add(rb.benefitId);
    ruleBenefitsMap.set(rb.ruleId, s);
  }

  const ruleOptionsMap = new Map<string, Map<string, string>>();
  for (const ro of ruleOptions) {
    const m = ruleOptionsMap.get(ro.ruleId) ?? new Map<string, string>();
    m.set(ro.benefitId, ro.optionId);
    ruleOptionsMap.set(ro.ruleId, m);
  }

  // 6. Find eligible instances for mapped cards
  // Must be:
  // - Not Ordered
  // - orderDeadline >= today
  // - not withdrawn, not skipped, not sold
  // - not already in an active/confirmed/uncertain attempt
  const instances = await db
    .select({
      id: benefitInstances.id,
      cardId: benefitInstances.cardId,
      benefitId: benefitInstances.benefitId,
      orderDeadline: benefitInstances.orderDeadline,
      chosenOptionId: benefitInstances.chosenOptionId,
      generatedFromVersion: benefitInstances.generatedFromVersion,
    })
    .from(benefitInstances)
    .where(
      and(
        eq(benefitInstances.workspaceId, account.workspaceId),
        inArray(benefitInstances.cardId, mappedCardIds),
        eq(benefitInstances.orderStatus, 'Not Ordered'),
        gte(benefitInstances.orderDeadline, today),
        isNull(benefitInstances.soldFor),
      ),
    );

  if (instances.length === 0) return null;

  // Exclude instances with blocking attempts
  const instanceIds = instances.map((i) => i.id);
  const blockingAttempts = await db
    .select({ instanceId: portalOrderAttempts.instanceId })
    .from(portalOrderAttempts)
    .where(
      and(
        inArray(portalOrderAttempts.instanceId, instanceIds),
        inArray(portalOrderAttempts.state, ['reserved', 'submitting', 'confirmed', 'uncertain']),
      ),
    );
  const blockedSet = new Set(blockingAttempts.map((b) => b.instanceId));

  const eligibleCandidates: Array<{
    candidate: CandidateNomination['candidate'];
    sortKey: { priority: number; deadline: string; id: string };
  }> = [];

  for (const inst of instances) {
    if (blockedSet.has(inst.id)) continue;
    if (!inst.benefitId) continue; // Custom benefit overrides without catalog benefit id skipped for automated portal

    const mapping = cardMap.get(inst.cardId);
    if (!mapping) continue;

    // Check which enabled rules match this instance
    for (const rule of rules) {
      const allowedCards = ruleCardsMap.get(rule.id);
      if (allowedCards && allowedCards.size > 0 && !allowedCards.has(inst.cardId)) {
        continue;
      }

      const allowedBenefits = ruleBenefitsMap.get(rule.id);
      if (allowedBenefits && allowedBenefits.size > 0 && !allowedBenefits.has(inst.benefitId)) {
        continue;
      }

      // Check pick-one option requirements:
      // If the catalog version has options, the rule must have a valid default option
      let chosenOpt = inst.chosenOptionId;
      if (!chosenOpt && inst.generatedFromVersion) {
        const defaultOpt = ruleOptionsMap.get(rule.id)?.get(inst.benefitId);
        if (defaultOpt) {
          // Verify defaultOpt belongs to generatedFromVersion
          const [validOption] = await db
            .select()
            .from(benefitOptions)
            .where(
              and(
                eq(benefitOptions.versionId, inst.generatedFromVersion),
                eq(benefitOptions.id, defaultOpt),
              ),
            );
          if (validOption) {
            chosenOpt = defaultOpt;
          }
        }
      }

      // Check if this catalog version is a pick-one category
      if (inst.generatedFromVersion) {
        const opts = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(benefitOptions)
          .where(eq(benefitOptions.versionId, inst.generatedFromVersion));
        if (opts[0].count > 1 && !chosenOpt) {
          // Pick-one requires an option default. If none is configured or valid, skip candidate.
          continue;
        }
      }

      eligibleCandidates.push({
        candidate: {
          instanceId: inst.id,
          cardId: inst.cardId,
          benefitId: inst.benefitId,
          orderDeadline: inst.orderDeadline,
          chosenOptionId: chosenOpt,
          portalCardId: mapping.portalCardId,
          portalCardbinId: mapping.portalCardbinId,
          ruleId: rule.id,
          rulePriority: rule.priority,
          portalAccountId,
        },
        sortKey: {
          priority: rule.priority,
          deadline: inst.orderDeadline,
          id: inst.id,
        },
      });

      // Match highest priority rule for this instance and move to next instance
      break;
    }
  }

  if (eligibleCandidates.length === 0) return null;

  // Sort candidates by:
  // 1. rule priority (asc)
  // 2. order deadline (asc)
  // 3. instance id (asc)
  eligibleCandidates.sort((a, b) => {
    if (a.sortKey.priority !== b.sortKey.priority) {
      return a.sortKey.priority - b.sortKey.priority;
    }
    if (a.sortKey.deadline !== b.sortKey.deadline) {
      return a.sortKey.deadline.localeCompare(b.sortKey.deadline);
    }
    return a.sortKey.id.localeCompare(b.sortKey.id);
  });

  return eligibleCandidates[0].candidate;
}
