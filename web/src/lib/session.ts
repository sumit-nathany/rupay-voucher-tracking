/**
 * Session layer: the ONLY place a Ctx is constructed in production.
 *
 * Identity is the Supabase auth user id (never email). '@/db' and
 * 'next/headers' are imported lazily so provisionWorkspace() can be unit
 * tested against PGlite without DATABASE_URL or a Next request scope.
 */
import { createServerClient } from '@supabase/ssr';
import { eq } from 'drizzle-orm';
import { systemAdmins, workspaceMembers, workspaces } from '@/db/schema';
import { AuthzError, type Ctx, type Database } from '@/lib/context';
import { today } from '@/lib/periods';

export interface Membership {
  workspaceId: string;
  role: 'admin' | 'member';
}

async function findMembership(db: Database, userId: string): Promise<Membership | null> {
  const [m] = await db
    .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId));
  return m ? { workspaceId: m.workspaceId, role: m.role as Membership['role'] } : null;
}

class LostRace extends Error {}

/**
 * Resolve user -> workspace, creating workspace + owner membership (role
 * 'admin') in ONE transaction on first login. Idempotent and race-safe: the
 * loser of a concurrent first-login hits workspace_members.user_id UNIQUE,
 * rolls its workspace insert back (no orphan) and returns the winner's row.
 */
export async function provisionWorkspace(db: Database, userId: string): Promise<Membership> {
  const existing = await findMembership(db, userId);
  if (existing) return existing;
  try {
    return await db.transaction(async (tx) => {
      const [ws] = await tx.insert(workspaces).values({ name: 'My workspace' }).returning({ id: workspaces.id });
      const inserted = await tx
        .insert(workspaceMembers)
        .values({ workspaceId: ws.id, userId, role: 'admin' })
        .onConflictDoNothing({ target: workspaceMembers.userId })
        .returning({ workspaceId: workspaceMembers.workspaceId });
      if (inserted.length === 0) throw new LostRace(); // roll back the orphan workspace
      return { workspaceId: ws.id, role: 'admin' as const };
    });
  } catch (e) {
    if (!(e instanceof LostRace)) throw e;
    const winner = await findMembership(db, userId);
    if (!winner) throw new Error('Workspace provisioning failed');
    return winner;
  }
}

export async function isSystemAdmin(db: Database, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: systemAdmins.id }).from(systemAdmins).where(eq(systemAdmins.userId, userId));
  return !!row;
}

/** Gate for shared-catalog writes. Keyed on auth user id, never email. */
export async function requireSystemAdmin(ctx: Ctx): Promise<void> {
  if (!(await isSystemAdmin(ctx.db, ctx.userId))) throw new AuthzError('System admin only');
}

/** Cookie-bound Supabase server client (Server Actions / Route Handlers / RSC). */
export async function createSupabaseServerClient() {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: cookie writes are ignored; middleware refreshes the session.
        }
      },
    },
  });
}

/** Build the request Ctx from the Supabase session. Throws AuthzError if unauthenticated. */
export async function getCtx(): Promise<Ctx> {
  const supabase = await createSupabaseServerClient();
  // getUser() validates the JWT with Supabase Auth; getSession() would trust the cookie.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new AuthzError('Not authenticated');
  const { db } = await import('@/db');
  const m = await provisionWorkspace(db, data.user.id);
  return { userId: data.user.id, workspaceId: m.workspaceId, role: m.role, db, today: today() };
}
