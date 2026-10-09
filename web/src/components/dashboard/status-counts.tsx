import type { DashboardSummary } from '@/domain/instance-queries';

const ROWS: { key: keyof DashboardSummary['counts']; label: string; tone?: string }[] = [
  { key: 'Not Ordered', label: 'Not ordered', tone: 'bg-muted-foreground/40' },
  { key: 'Ordered but Coupon not received', label: 'Awaiting coupon', tone: 'bg-warning' },
  { key: 'Coupon Received', label: 'Coupon in hand', tone: 'bg-violet' },
  { key: 'Coupon Redeemed', label: 'Redeemed', tone: 'bg-teal' },
  { key: 'Skipped', label: 'Skipped', tone: 'bg-border' },
  { key: 'Withdrawn', label: 'Withdrawn', tone: 'bg-border' },
];

export function StatusCounts({ s }: { s: DashboardSummary }) {
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
              <div
                key={r.key}
                className={`${r.tone} h-full`}
                style={{ width: `${(n / total) * 100}%` }}
                title={`${r.label}: ${n}`}
              />
            );
          })}
        </div>
        <ul className="space-y-2.5">
          {ROWS.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <span className={`h-2 w-2 shrink-0 rounded-full ${r.tone}`} aria-hidden />
                {r.label}
              </span>
              <span className="font-semibold tabular-nums">{s.counts[r.key]}</span>
            </li>
          ))}
          {s.lapsedCount > 0 && (
            <li className="flex items-center justify-between gap-3 border-t border-border/60 pt-2 text-sm text-rani">
              <span>Lapsed (in Not ordered)</span>
              <span className="font-semibold tabular-nums">{s.lapsedCount}</span>
            </li>
          )}
        </ul>
      </div>
    </section>
  );
}
