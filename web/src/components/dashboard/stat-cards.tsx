import Link from 'next/link';
import { ArrowRight, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DashboardSummary } from '@/domain/instance-queries';
import { formatINR } from './format';

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold tracking-tight text-2xl tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function StatCards({ s }: { s: DashboardSummary }) {
  const attention = s.counts['Not Ordered'] + s.counts['Coupon Received'];
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* Primary metric card — emerald accent */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8 lg:col-span-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex h-full flex-col justify-between gap-6">
          <div>
            <p className="eyebrow text-muted-foreground">Outstanding value</p>
            <p className="mt-2 font-semibold tracking-tight text-4xl tabular-nums text-foreground sm:text-5xl">
              {formatINR(s.outstandingValue)}
            </p>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">Benefits not yet used or sold — your open pipeline.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-foreground">
              <TrendingUp className="h-3.5 w-3.5 text-primary" aria-hidden />
              {attention} need attention this period
            </div>
            <Button asChild size="sm" className="rounded-full">
              <Link href="/benefits">
                Review benefits <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:col-span-5">
        <MiniStat label="Ordered" value={formatINR(s.orderedValue)} sub="In progress or done" />
        <MiniStat label="Redeemed" value={formatINR(s.redeemedValue)} />
        <MiniStat label="Sold" value={formatINR(s.soldValue)} sub="Proceeds" />
        <MiniStat
          label="Lapsed"
          value={formatINR(s.lapsedValue)}
          sub={s.lapsedCount > 0 ? `${s.lapsedCount} missed` : undefined}
        />
      </div>
    </div>
  );
}
