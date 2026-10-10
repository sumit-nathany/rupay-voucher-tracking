import Link from 'next/link';
import type { DashboardSummary } from '@/domain/instance-queries';
import type { ViewedPeriod } from '@/lib/periods';
import { benefitsStatusHref } from './benefits-link';

const ROWS: { key: keyof DashboardSummary['counts']; label: string; tone?: string }[] = [
  { key: 'Not Ordered', label: 'Not ordered', tone: 'bg-muted-foreground/40' },
  { key: 'Ordered but Coupon not received', label: 'Awaiting coupon', tone: 'bg-warning' },
  { key: 'Coupon Received', label: 'Coupon in hand', tone: 'bg-primary/60' },
  { key: 'Coupon Redeemed', label: 'Redeemed', tone: 'bg-primary' },
  { key: 'Skipped', label: 'Skipped', tone: 'bg-border' },
  { key: 'Withdrawn', label: 'Withdrawn', tone: 'bg-border' },
];

export function StatusCounts({ view, s }: { view: ViewedPeriod; s: DashboardSummary }) {
  const total = Object.values(s.counts).reduce((a, b) => a + b, 0) || 1;
  return (
    <section className="panel h-full">
      <div className="panel-header">
        <h2 className="font-semibold tracking-tight text-lg">Status mix</h2>
        <p className="text-xs text-muted-foreground">{total} instances in this view</p>
      </div>
      <div className="panel-body space-y-4">
        <div className="flex h-3 overflow-hidden rounded-full bg-muted">
          {ROWS.map((r) => {
            const n = s.counts[r.key];
            if (!n) return null;
            return (
              <Link
                key={r.key}
                href={benefitsStatusHref(view, r.key)}
                className={`${r.tone} h-full transition-opacity hover:opacity-80`}
                style={{ width: `${(n / total) * 100}%` }}
                title={`${r.label}: ${n}`}
                aria-label={`${r.label}: ${n}`}
              />
            );
          })}
        </div>
        <ul className="space-y-2.5">
          {ROWS.map((r) => (
            <li key={r.key}>
              <Link
                href={benefitsStatusHref(view, r.key)}
                className="flex items-center justify-between gap-3 rounded-md text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring -mx-2 px-2 py-1"
              >
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${r.tone}`} aria-hidden />
                  {r.label}
                </span>
                <span className="font-semibold tabular-nums">{s.counts[r.key]}</span>
              </Link>
            </li>
          ))}
          {s.lapsedCount > 0 && (
            <li>
              <Link
                href={benefitsStatusHref(view, 'Not Ordered', { lapsed: '1' })}
                className="flex items-center justify-between gap-3 rounded-md border-t border-border/60 pt-2 text-sm text-destructive transition-colors hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring -mx-2 px-2 py-1"
              >
                <span>Lapsed (in Not ordered)</span>
                <span className="font-semibold tabular-nums">{s.lapsedCount}</span>
              </Link>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
