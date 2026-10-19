export function PageHeaderSkeleton() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between pb-2" aria-busy="true">
      <div className="space-y-2">
        <div className="skeleton-shimmer h-3.5 w-16 rounded" />
        <div className="skeleton-shimmer h-8 w-44 rounded-lg" />
        <div className="skeleton-shimmer h-3.5 w-72 max-w-full rounded" />
      </div>
      <div className="skeleton-shimmer h-10 w-36 rounded-lg" />
    </div>
  );
}

export function ActionQueueSkeleton() {
  return (
    <section aria-label="Loading action queue" aria-busy="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col justify-between gap-4 rounded-xl border border-border/40 bg-card/60 p-5 shadow-sm"
        >
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="skeleton-shimmer h-4 w-4 rounded shrink-0" />
              <div className="skeleton-shimmer h-4 w-28 rounded" />
            </div>
            <div className="skeleton-shimmer h-8 w-32 rounded-lg" />
            <div className="skeleton-shimmer h-3 w-48 max-w-full rounded" />
          </div>
          <div className="skeleton-shimmer h-4 w-24 rounded" />
        </div>
      ))}
    </section>
  );
}

export function RedeemedValueSkeleton() {
  return (
    <section aria-label="Loading redeemed value" aria-busy="true" className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: 2 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-xl border border-success/20 bg-success/[0.03] p-5 shadow-sm"
        >
          <div className="flex items-center gap-2">
            <div className="skeleton-shimmer h-4 w-4 rounded shrink-0" />
            <div className="skeleton-shimmer h-4 w-36 rounded" />
          </div>
          <div className="skeleton-shimmer h-8 w-36 rounded-lg" />
          <div className="skeleton-shimmer h-3 w-64 max-w-full rounded" />
          <div className="skeleton-shimmer h-4 w-28 rounded" />
        </div>
      ))}
    </section>
  );
}

export function StatusCountsSkeleton() {
  return (
    <section aria-label="Loading status mix" aria-busy="true" className="panel h-full">
      <div className="panel-header space-y-1.5">
        <div className="skeleton-shimmer h-5 w-24 rounded" />
        <div className="skeleton-shimmer h-3 w-36 rounded" />
      </div>
      <div className="panel-body space-y-4">
        <div className="skeleton-shimmer h-3 w-full rounded-full" />
        <ul className="space-y-3 pt-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-2">
                <div className="skeleton-shimmer h-2 w-2 rounded-full shrink-0" />
                <div className="skeleton-shimmer h-4 w-28 rounded" />
              </div>
              <div className="skeleton-shimmer h-4 w-8 rounded" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function HolderProgressSkeleton() {
  return (
    <section aria-label="Loading holder progress" aria-busy="true" className="panel h-full">
      <div className="panel-header space-y-1.5">
        <div className="skeleton-shimmer h-5 w-24 rounded" />
        <div className="skeleton-shimmer h-3 w-40 rounded" />
      </div>
      <div className="panel-body">
        <ul className="space-y-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i}>
              <div className="flex items-center gap-3">
                <div className="skeleton-shimmer h-9 w-9 rounded-full shrink-0" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="skeleton-shimmer h-4 w-28 rounded" />
                    <div className="skeleton-shimmer h-3 w-16 rounded" />
                  </div>
                  <div className="skeleton-shimmer h-2 w-full rounded-full" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function ExpiringSoonSkeleton() {
  return (
    <section aria-label="Loading expiring coupons" aria-busy="true" className="panel">
      <div className="panel-header flex items-start justify-between gap-3">
        <div className="space-y-1.5">
          <div className="skeleton-shimmer h-5 w-28 rounded" />
          <div className="skeleton-shimmer h-3 w-48 rounded" />
        </div>
        <div className="skeleton-shimmer h-5 w-5 rounded-full shrink-0" />
      </div>
      <div className="panel-body">
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-2.5">
              <div className="skeleton-shimmer h-3 w-20 rounded" />
              <div className="skeleton-shimmer h-4 w-44 rounded" />
              <div className="skeleton-shimmer h-3 w-32 rounded" />
              <div className="skeleton-shimmer h-5 w-24 rounded-full mt-1" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function LifetimeSkeleton() {
  return (
    <section aria-label="Loading lifetime totals" aria-busy="true" className="space-y-4">
      <div className="skeleton-shimmer h-6 w-24 rounded" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border border-success/20 bg-success/[0.03] p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="skeleton-shimmer h-4 w-4 rounded shrink-0" />
            <div className="skeleton-shimmer h-4 w-32 rounded" />
          </div>
          <div className="skeleton-shimmer h-8 w-36 rounded-lg" />
          <div className="skeleton-shimmer h-3 w-56 max-w-full rounded" />
          <div className="skeleton-shimmer h-4 w-24 rounded" />
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-destructive/25 bg-destructive/[0.03] p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="skeleton-shimmer h-4 w-4 rounded shrink-0" />
            <div className="skeleton-shimmer h-4 w-32 rounded" />
          </div>
          <div className="skeleton-shimmer h-8 w-36 rounded-lg" />
          <div className="skeleton-shimmer h-3 w-56 max-w-full rounded" />
          <div className="skeleton-shimmer h-4 w-24 rounded" />
        </div>
      </div>
    </section>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <ActionQueueSkeleton />
      <RedeemedValueSkeleton />
      <div className="grid gap-4 lg:grid-cols-2">
        <StatusCountsSkeleton />
        <HolderProgressSkeleton />
      </div>
      <ExpiringSoonSkeleton />
      <LifetimeSkeleton />
    </div>
  );
}
