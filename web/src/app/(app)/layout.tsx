import Link from 'next/link';
import { LogOut, Sparkles } from 'lucide-react';
import { signOut } from '@/app/auth/actions';
import { Button } from '@/components/ui/button';
import { getCtx, isSystemAdmin } from '@/lib/session';
import { NavLinks } from './nav-links';

function BrandMark({ compact }: { compact?: boolean }) {
  return (
    <Link href="/" className="group flex items-center gap-3 outline-none">
      <span
        aria-hidden
        className="relative grid h-11 w-11 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-gold via-[#f5c56a] to-[#e8941a] font-bold text-2xl text-ink shadow-[0_12px_28px_-10px_rgba(232,148,26,0.9)] transition-transform duration-200 group-hover:scale-[1.03]"
      >
        ₹
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block font-bold text-2xl tracking-tight text-white">RuPay</span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">Voucher desk</span>
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
      <aside className="app-sidebar fixed inset-y-0 left-0 z-50 hidden w-[17.5rem] flex-col px-5 py-6 lg:flex">
        <BrandMark />
        <p className="mt-6 flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs leading-relaxed text-white/65">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold" aria-hidden />
          Order on time, use before expiry — one place for every card and holder.
        </p>
        <div className="ornament my-6" />
        <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
          <p className="eyebrow mb-2 px-3 text-white/40">Navigate</p>
          <NavLinks variant="sidebar" showAdmin={showAdmin} />
        </nav>
        <form action={signOut} className="mt-4 border-t border-white/10 pt-4">
          <Button
            type="submit"
            variant="ghost"
            className="w-full justify-start rounded-xl text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </form>
      </aside>

      <div className="app-canvas flex min-w-0 flex-1 flex-col lg:pl-[17.5rem]">
        <header className="sticky top-0 z-40 flex items-center justify-between border-b border-white/10 bg-ink/90 px-4 py-3 backdrop-blur-xl lg:hidden">
          <BrandMark compact />
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" className="text-white/70 hover:bg-white/10 hover:text-white">
              <LogOut className="h-4 w-4" />
            </Button>
          </form>
        </header>

        <div className="flex-1 px-3 py-4 pb-24 sm:px-5 sm:py-6 lg:px-8 lg:pb-10">{children}</div>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-ink/95 px-1 backdrop-blur-xl lg:hidden"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 4px)' }}
      >
        <NavLinks variant="tabbar" showAdmin={showAdmin} />
      </nav>
    </div>
  );
}
