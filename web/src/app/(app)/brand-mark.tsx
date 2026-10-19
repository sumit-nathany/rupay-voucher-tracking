'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useNavigationProgress } from '@/components/layout/navigation-progress';

export function BrandMark({ compact }: { compact?: boolean }) {
  const pathname = usePathname();
  const { navigatingHref, startNavigation } = useNavigationProgress();
  const isNavigatingDashboard = navigatingHref === '/';

  return (
    <Link
      href="/"
      onClick={(e) => {
        if (pathname === '/') return;
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
          return;
        }
        e.preventDefault();
        startNavigation('/');
      }}
      className="group flex items-center gap-3 outline-none"
    >
      <span
        aria-hidden
        className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-primary font-bold text-xl text-primary-foreground shadow-sm transition-transform duration-200 group-hover:scale-[1.03]"
      >
        {isNavigatingDashboard ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary-foreground" />
        ) : (
          '₹'
        )}
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className="block font-bold text-xl tracking-tight text-foreground">RuPay</span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {isNavigatingDashboard ? (
              <span className="text-primary font-bold animate-pulse">Loading...</span>
            ) : (
              'Voucher desk'
            )}
          </span>
        </span>
      )}
    </Link>
  );
}
