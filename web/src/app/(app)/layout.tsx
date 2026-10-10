import { getCtx, isSystemAdmin } from '@/lib/session';
import { AppShell } from './app-shell';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const showAdmin = await isSystemAdmin(ctx.db, ctx.userId);
  return <AppShell showAdmin={showAdmin}>{children}</AppShell>;
}
