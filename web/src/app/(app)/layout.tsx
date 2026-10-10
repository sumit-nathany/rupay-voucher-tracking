import { getCtx, isSystemAdmin } from '@/lib/session';
import { MobileAppChrome } from './mobile-app-chrome';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const showAdmin = await isSystemAdmin(ctx.db, ctx.userId);
  return (
    <div className="min-h-dvh flex flex-col">
      <MobileAppChrome showAdmin={showAdmin} />

      <main className="flex-1 px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:pb-10">{children}</main>
    </div>
  );
}
