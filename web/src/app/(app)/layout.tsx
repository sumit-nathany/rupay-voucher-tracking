import { getCtxAndUser, isSystemAdmin } from '@/lib/session';
import { AppShell } from './app-shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, user } = await getCtxAndUser();
  const showAdmin = await isSystemAdmin(ctx.db, ctx.userId);
  return (
    <AppShell
      showAdmin={showAdmin}
      user={{
        email: user.email ?? null,
        role: ctx.role,
        isSystemAdmin: showAdmin,
      }}
    >
      {children}
    </AppShell>
  );
}
