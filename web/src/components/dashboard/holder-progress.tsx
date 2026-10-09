import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { HolderProgress as HP } from '@/domain/instance-queries';

export function HolderProgress({ holders }: { holders: HP[] }) {
  return (
    <Card>
      <CardHeader className="pb-3 sm:pb-3">
        <CardTitle className="text-base">Progress by holder</CardTitle>
      </CardHeader>
      <CardContent>
        {holders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No benefits in this period.</p>
        ) : (
          <ul className="space-y-4">
            {holders.map((h) => {
              const pct = h.total === 0 ? 0 : Math.round((h.redeemed / h.total) * 100);
              return (
                <li key={h.holderId}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate font-medium">{h.holderName}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {h.redeemed} / {h.total} redeemed
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`${h.holderName} progress`}
                    aria-valuemin={0}
                    aria-valuemax={h.total}
                    aria-valuenow={h.redeemed}
                    className="h-2.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div className="h-full rounded-full bg-gradient-to-r from-gold to-teal" style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
