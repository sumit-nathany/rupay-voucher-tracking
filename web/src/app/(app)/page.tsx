import { Suspense } from 'react';
import { DashboardContent } from '@/components/dashboard/dashboard-content';
import { PageSkeleton } from '@/components/dashboard/error-panel';
import { PeriodSelector } from '@/components/dashboard/period-selector';
import { parseView, viewLabel } from '@/components/dashboard/view-params';
import { today as istToday } from '@/lib/periods';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const today = istToday();
  const view = parseView(sp, today);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">Dashboard · {viewLabel(view)}</h1>
        <PeriodSelector view={view} today={today} />
      </div>
      <Suspense key={JSON.stringify(view)} fallback={<PageSkeleton />}>
        <DashboardContent view={view} today={today} />
      </Suspense>
    </div>
  );
}
