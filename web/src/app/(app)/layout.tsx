import { LogOut } from 'lucide-react';
import { signOut } from '@/app/auth/actions';
import { Button } from '@/components/ui/button';
import { getCtx, isSystemAdmin } from '@/lib/session';
import { NavLinks } from './nav-links';

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="grid h-9 w-9 place-items-center rounded-lg bg-gold font-[family-name:var(--font-display)] text-lg font-bold text-ink"
      >
        ₹
      </span>
      <span className="leading-tight">
        <span className="block font-[family-name:var(--font-display)] text-lg font-semibold text-white">RuPay</span>
        <span className="block text-xs text-white/60">Voucher Tracker</span>
      </span>
    </div>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  const showAdmin = await isSystemAdmin(ctx.db, ctx.userId);
  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col bg-gradient-to-b from-ink to-ink-2 p-5 md:flex">
        <div className="px-1">
          <BrandMark />
        </div>
        <div className="ornament my-5" />
        <nav className="flex flex-1 flex-col gap-1" aria-label="Main">
          <NavLinks variant="sidebar" showAdmin={showAdmin} />
        </nav>
        <form action={signOut}>
          <Button type="submit" variant="ghost" className="w-full justify-start text-white/70 hover:bg-white/10 hover:text-white">
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </form>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b-2 border-gold bg-ink px-4 py-3 md:hidden">
          <BrandMark />
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" className="text-white/70 hover:bg-white/10 hover:text-white">
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </form>
        </header>
        <main className="flex-1 p-4 pb-24 md:p-10 md:pb-10">{children}</main>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t-2 border-gold bg-ink pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <NavLinks variant="tabbar" showAdmin={showAdmin} />
      </nav>
    </div>
  );
}
