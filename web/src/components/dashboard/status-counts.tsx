import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { DashboardSummary } from '@/domain/instance-queries';

const ROWS: { key: keyof DashboardSummary['counts']; label: string }[] = [
  { key: 'Not Ordered', label: 'Not ordered' },
  { key: 'Ordered but Coupon not received', label: 'Ordered, awaiting coupon' },
  { key: 'Coupon Received', label: 'Coupon received' },
  { key: 'Coupon Redeemed', label: 'Redeemed' },
  { key: 'Skipped', label: 'Skipped' },
  { key: 'Withdrawn', label: 'Withdrawn' },
];

export function StatusCounts({ s }: { s: DashboardSummary }) {
  return (
    <Card>
      <CardHeader className="pb-3 sm:pb-3">
        <CardTitle className="text-base">By status</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {ROWS.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{r.label}</dt>
              <dd className="font-medium tabular-nums">{s.counts[r.key]}</dd>
            </div>
          ))}
          {s.lapsedCount > 0 && (
            <div className="col-span-2 flex items-center justify-between gap-2 text-rani">
              <dt>Lapsed (missed, included in Not ordered)</dt>
              <dd className="font-medium tabular-nums">{s.lapsedCount}</dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
