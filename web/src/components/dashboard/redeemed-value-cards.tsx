import Link from 'next/link';
import { ArrowRight, Banknote } from 'lucide-react';
import type { DashboardSummary } from '@/domain/instance-queries';
import { cn } from '@/lib/utils';
import {
  benefitsRedeemedThisQuarterHref,
  benefitsRedeemedThisYearHref,
} from './benefits-link';
import { formatINR } from './format';

const CARDS = [
  {
    key: 'redeemedThisQuarter' as const,
    countKey: 'redeemedThisQuarterCount' as const,
    title: 'Redeemed this quarter',
    href: (today: string) => benefitsRedeemedThisQuarterHref(today),
  },
  {
    key: 'redeemedThisYear' as const,
    countKey: 'redeemedThisYearCount' as const,
    title: 'Redeemed this year',
    href: (today: string) => benefitsRedeemedThisYearHref(today),
  },
];

export function RedeemedValueCards({ s, today }: { s: DashboardSummary; today: string }) {
  return (
    <section aria-label="Redeemed value" className="grid gap-4 md:grid-cols-2">
      {CARDS.map((c) => {
        const count = s[c.countKey];
        return (
          <Link
            key={c.key}
            href={c.href(today)}
            className={cn(
              'group flex flex-col gap-3 rounded-xl border border-success/30 bg-success/5 p-5 shadow-sm transition-colors hover:bg-success/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Banknote className="h-4 w-4 shrink-0 text-success" aria-hidden />
              {c.title}
            </div>
            <p className="font-semibold tracking-tight text-3xl tabular-nums text-foreground">{formatINR(s[c.key])}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Coupon Redeemed value — based on today, not the period you are viewing.
            </p>
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
