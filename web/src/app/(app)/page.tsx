import { Suspense } from 'react';
import { DashboardContent } from '@/components/dashboard/dashboard-content';
import { PageSkeleton } from '@/components/dashboard/error-panel';
import { PeriodSelector } from '@/components/dashboard/period-selector';
import { parseView, viewLabel } from '@/components/dashboard/view-params';
import { ContentStage } from '@/components/layout/content-stage';
import { PageHeader } from '@/components/layout/page-header';
import { today as istToday } from '@/lib/periods';

export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const today = istToday();
  const view = parseView(sp, today);
  return (
    <ContentStage className="max-w-6xl [.nav-unpinned_&]:max-w-7xl [.nav-unpinned_&]:2xl:max-w-[1536px]">
      <PageHeader
        eyebrow="Overview"
        title={viewLabel(view)}
        description="What needs ordering, what is in hand, and what is about to lapse."
        actions={<PeriodSelector view={view} today={today} />}
      />
      <Suspense key={JSON.stringify(view)} fallback={<PageSkeleton />}>
        <DashboardContent view={view} today={today} />
      </Suspense>
    </ContentStage>
  );
}
