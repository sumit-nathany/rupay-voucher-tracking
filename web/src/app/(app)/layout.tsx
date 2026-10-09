import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { signOut } from '@/app/auth/actions';
import { Button } from '@/components/ui/button';
import { getCtx, isSystemAdmin } from '@/lib/session';
import { NavLinks } from './nav-links';

function BrandMark({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-3 outline-none">
      <span
        aria-hidden
        className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-primary font-bold text-xl text-primary-foreground shadow-sm transition-transform duration-200 group-hover:scale-[1.03]"
      >
        ₹
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block font-bold text-xl tracking-tight text-foreground">RuPay</span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Voucher desk</span>
        </span>
      )}
    </Link>
  );
}

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
        {/* Mobile header */}
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur-xl lg:hidden">
          <BrandMark compact />
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
              <LogOut className="h-4 w-4" />
            </Button>
          </form>
        </header>

        <div className="flex-1 px-3 py-4 pb-24 sm:px-5 sm:py-6 lg:px-8 lg:pb-10">{children}</div>
      </div>

      {/* Mobile tab bar */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background/95 px-1 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 4px)' }}
      >
        <NavLinks variant="tabbar" showAdmin={showAdmin} />
      </nav>
    </div>
  );
}
