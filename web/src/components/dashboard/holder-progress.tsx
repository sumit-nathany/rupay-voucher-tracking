import type { HolderProgress as HP } from '@/domain/instance-queries';

export function HolderProgress({ holders }: { holders: HP[] }) {
  return (
    <section className="panel h-full">
      <div className="panel-header">
        <h2 className="font-semibold tracking-tight text-lg">By holder</h2>
        <p className="text-xs text-muted-foreground">Redeemed vs total in this period</p>
      </div>
      <div className="panel-body">
        {holders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No benefits in this period.</p>
        ) : (
          <ul className="space-y-5">
            {holders.map((h) => {
              const pct = h.total === 0 ? 0 : Math.round((h.redeemed / h.total) * 100);
              const initial = h.holderName.trim().charAt(0).toUpperCase() || '?';
              return (
                <li key={h.holderId}>
                  <div className="mb-2 flex items-center gap-3">
                    <span
                      aria-hidden
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-primary"
                    >
                      {initial}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">{h.holderName}</span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {h.redeemed}/{h.total} · {pct}%
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={`${h.holderName} progress`}
                        aria-valuemin={0}
                        aria-valuemax={h.total}
                        aria-valuenow={h.redeemed}
                        className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
                      >
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-gold via-[#f5c56a] to-teal transition-[width] duration-500 ease-out"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
