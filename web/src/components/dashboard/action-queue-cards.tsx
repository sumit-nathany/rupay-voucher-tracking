import Link from 'next/link';
import { ArrowRight, Clock, Package, Ticket } from 'lucide-react';
import type { DashboardSummary } from '@/domain/instance-queries';
import type { ViewedPeriod } from '@/lib/periods';
import { cn } from '@/lib/utils';
import { benefitsStatusHref } from './benefits-link';
import { formatINR } from './format';

const CARDS = [
  {
    key: 'needOrder' as const,
    status: 'Not Ordered' as const,
    lapsed: '0' as const,
    countKey: 'needOrderCount' as const,
    title: 'Needs ordering',
    description: 'Place these benefits before the order deadline.',
    icon: Package,
    accent: 'border-destructive/25 bg-destructive/[0.06] hover:bg-destructive/10',
    iconClass: 'text-destructive',
  },
  {
    key: 'awaitingCoupon' as const,
    status: 'Ordered but Coupon not received' as const,
    countKey: 'awaitingCouponCount' as const,
    title: 'Awaiting coupon',
    description: 'Ordered — waiting for the voucher from the bank.',
    icon: Clock,
    accent: 'border-warning/40 bg-warning/5 hover:bg-warning/10',
    iconClass: 'text-warning',
  },
  {
    key: 'couponToUse' as const,
    status: 'Coupon Received' as const,
    countKey: 'couponToUseCount' as const,
    title: 'Coupon in hand',
    description: 'Received but not redeemed yet — use before expiry.',
    icon: Ticket,
    accent: 'border-primary/25 bg-card hover:bg-muted/50',
    iconClass: 'text-primary',
  },
];

export function ActionQueueCards({ view, s }: { view: ViewedPeriod; s: DashboardSummary }) {
  return (
    <section aria-label="Action queue" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {CARDS.map((c) => {
        const value = s.actionValues[c.key];
        const count = s.actionValues[c.countKey];
        const Icon = c.icon;
        return (
          <Link
            key={c.key}
            href={benefitsStatusHref(view, c.status, 'lapsed' in c && c.lapsed ? { lapsed: c.lapsed } : undefined)}
            className={cn(
              'group flex cursor-pointer flex-col justify-between gap-4 rounded-xl border p-5 shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              c.accent,
            )}
          >
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Icon className={cn('h-4 w-4 shrink-0', c.iconClass)} aria-hidden />
                {c.title}
              </div>
              <p className="font-semibold tracking-tight text-3xl tabular-nums text-foreground">{formatINR(value)}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">{c.description}</p>
            </div>
            <p className="flex items-center gap-1 text-sm font-medium text-primary">
              {count === 0 ? 'View benefits' : `${count} benefit${count === 1 ? '' : 's'}`}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </p>
          </Link>
        );
      })}
    </section>
  );
}
