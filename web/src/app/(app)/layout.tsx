import { LogOut } from 'lucide-react';
import { signOut } from '@/app/auth/actions';
import { Button } from '@/components/ui/button';
import { getCtx, isSystemAdmin } from '@/lib/session';
import { BrandMark } from './brand-mark';
import { MobileAppChrome } from './mobile-app-chrome';
import { NavLinks } from './nav-links';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const showAdmin = await isSystemAdmin(ctx.db, ctx.userId);
  return (
    <div className="min-h-dvh lg:flex">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[17rem] flex-col border-r border-border bg-sidebar px-4 py-6 lg:flex">
        <BrandMark />
        <div className="my-5 h-px bg-border" />
        <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
          <p className="eyebrow mb-2 px-3 text-muted-foreground/70">Navigate</p>
          <NavLinks variant="sidebar" showAdmin={showAdmin} />
        </nav>
        <form action={signOut} className="mt-4 border-t border-border pt-4">
          <Button
            type="submit"
            variant="ghost"
            className="w-full justify-start rounded-xl text-muted-foreground"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </form>
      </aside>

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-[17rem]">
        <MobileAppChrome showAdmin={showAdmin} />

        <div className="flex-1 px-3 py-4 sm:px-5 sm:py-6 lg:px-8 lg:pb-10">{children}</div>
      </div>
    </div>
  );
}
