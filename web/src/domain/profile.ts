import { and, eq, sql } from 'drizzle-orm';
import {
  benefitInstances,
  cardHolders,
  cards,
  portalAccounts,
  systemAdmins,
  workspaces,
} from '@/db/schema';
import type { Ctx } from '@/lib/context';

export interface UserProfileView {
  userId: string;
  email: string;
  emailConfirmedAt: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  role: 'admin' | 'member';
  isSystemAdmin: boolean;
  workspace: {
    id: string;
    name: string;
    createdAt: string | null;
  };
  stats: {
    cardsCount: number;
    holdersCount: number;
    accountsCount: number;
    activeBenefitsCount: number;
  };
}

export interface AuthMetadata {
  email?: string | null;
  emailConfirmedAt?: string | null;
  createdAt?: string | null;
  lastSignInAt?: string | null;
}

/**
 * Returns structured profile data for the active user, including workspace role,
 * system admin status, and resource metrics.
 */
export async function getProfileView(
  ctx: Ctx,
  authMeta: AuthMetadata,
): Promise<UserProfileView> {
  const [workspace] = await ctx.db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      createdAt: workspaces.createdAt,
    })
    .from(workspaces)
    .where(eq(workspaces.id, ctx.workspaceId));

  const [sysAdminRow] = await ctx.db
    .select({ id: systemAdmins.id })
    .from(systemAdmins)
    .where(eq(systemAdmins.userId, ctx.userId));

  const [cardsCountRes, holdersCountRes, accountsCountRes, benefitsCountRes] =
    await Promise.all([
      ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(cards)
        .where(eq(cards.workspaceId, ctx.workspaceId)),
      ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(cardHolders)
        .where(eq(cardHolders.workspaceId, ctx.workspaceId)),
      ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(portalAccounts)
        .where(eq(portalAccounts.workspaceId, ctx.workspaceId)),
      ctx.db
        .select({ count: sql<number>`count(*)::int` })
        .from(benefitInstances)
        .where(and(eq(benefitInstances.workspaceId, ctx.workspaceId), eq(benefitInstances.archived, false))),
    ]);

  return {
    userId: ctx.userId,
    email: authMeta.email ?? 'No email associated',
    emailConfirmedAt: authMeta.emailConfirmedAt ?? null,
    createdAt: authMeta.createdAt ?? null,
    lastSignInAt: authMeta.lastSignInAt ?? null,
    role: ctx.role,
    isSystemAdmin: Boolean(sysAdminRow),
    workspace: {
      id: ctx.workspaceId,
      name: workspace?.name ?? 'My workspace',
      createdAt: workspace?.createdAt ? workspace.createdAt.toISOString() : null,
    },
    stats: {
      cardsCount: cardsCountRes[0]?.count ?? 0,
      holdersCount: holdersCountRes[0]?.count ?? 0,
      accountsCount: accountsCountRes[0]?.count ?? 0,
      activeBenefitsCount: benefitsCountRes[0]?.count ?? 0,
    },
  };
}
