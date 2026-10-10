import Link from 'next/link';
import { ArrowRight, Banknote, CalendarX2 } from 'lucide-react';
import type { DashboardSummary } from '@/domain/instance-queries';
import { cn } from '@/lib/utils';
import { benefitsLifetimeStatusHref } from './benefits-link';
import { formatINR } from './format';

export function LifetimeSection({ s }: { s: DashboardSummary }) {
  const redeemedCount = s.redeemedLifetimeCount;
  const missedCount = s.missedOrderLifetimeCount;
  return (
    <section aria-labelledby="dashboard-lifetime-heading" className="space-y-4">
      <h2 id="dashboard-lifetime-heading" className="text-lg font-semibold tracking-tight text-foreground">
        Lifetime
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Link
          href={benefitsLifetimeStatusHref('Coupon Redeemed')}
          className={cn(
            'group flex flex-col gap-3 rounded-xl border border-success/30 bg-success/5 p-5 shadow-sm transition-colors hover:bg-success/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Banknote className="h-4 w-4 shrink-0 text-success" aria-hidden />
            Redeemed lifetime
          </div>
          <p className="font-semibold tracking-tight text-3xl tabular-nums text-foreground">
            {formatINR(s.redeemedLifetime)}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Coupon Redeemed value across every period in this workspace.
          </p>
          <p className="flex items-center gap-1 text-sm font-medium text-primary">
            {redeemedCount === 0
              ? 'View all redeemed'
              : `${redeemedCount} benefit${redeemedCount === 1 ? '' : 's'}`}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </p>
        </Link>
        <Link
          href={benefitsLifetimeStatusHref('Not Ordered', { lapsed: '1' })}
          className={cn(
            'group flex flex-col gap-3 rounded-xl border border-destructive/50 bg-destructive/10 p-5 shadow-sm transition-colors hover:bg-destructive/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <CalendarX2 className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
            Missed ordering
          </div>
          <p className="font-semibold tracking-tight text-3xl tabular-nums text-foreground">
            {formatINR(s.missedOrderLifetime)}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Gift vouchers never ordered after the benefit period ended — all periods, as of today.
          </p>
          <p className="flex items-center gap-1 text-sm font-medium text-primary">
            {missedCount === 0
              ? 'View missed benefits'
              : `${missedCount} benefit${missedCount === 1 ? '' : 's'}`}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </p>
        </Link>
      </div>
    </section>
  );
}
