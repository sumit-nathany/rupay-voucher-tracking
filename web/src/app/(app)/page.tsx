import { Suspense } from 'react';
import {
  ActionQueueSection,
  ExpiringSoonSection,
  HolderProgressSection,
  LifetimeSectionContainer,
  RedeemedValueSection,
  StatusCountsSection,
} from '@/components/dashboard/dashboard-content';
import {
  ActionQueueSkeleton,
  ExpiringSoonSkeleton,
  HolderProgressSkeleton,
  LifetimeSkeleton,
  RedeemedValueSkeleton,
  StatusCountsSkeleton,
} from '@/components/dashboard/dashboard-skeletons';
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
  const viewKey = JSON.stringify(view);

  return (
    <ContentStage className="max-w-6xl [.nav-unpinned_&]:max-w-7xl [.nav-unpinned_&]:2xl:max-w-[1536px]">
      <PageHeader
        eyebrow="Overview"
        title={viewLabel(view)}
        description="What needs ordering, what is in hand, and what is about to lapse."
        actions={<PeriodSelector view={view} today={today} />}
      />

      <div className="space-y-6">
        {/* Urgent Action Queue: Needs Ordering, Awaiting Coupon, Coupon to Use */}
        <Suspense key={`action-${viewKey}`} fallback={<ActionQueueSkeleton />}>
          <ActionQueueSection view={view} />
        </Suspense>

        {/* Current Quarter & Year Redeemed Values */}
        <Suspense fallback={<RedeemedValueSkeleton />}>
          <RedeemedValueSection today={today} view={view} />
        </Suspense>

        {/* Status Mix & Holder Progress Breakdown */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Suspense key={`status-${viewKey}`} fallback={<StatusCountsSkeleton />}>
            <StatusCountsSection view={view} />
          </Suspense>
          <Suspense key={`holders-${viewKey}`} fallback={<HolderProgressSkeleton />}>
            <HolderProgressSection view={view} />
          </Suspense>
        </div>

        {/* Vouchers Expiring Within 30 Days */}
        <Suspense fallback={<ExpiringSoonSkeleton />}>
          <ExpiringSoonSection today={today} view={view} />
        </Suspense>

        {/* All-Time Lifetime Performance & Missed Savings */}
        <Suspense fallback={<LifetimeSkeleton />}>
          <LifetimeSectionContainer today={today} view={view} />
        </Suspense>
      </div>
    </ContentStage>
  );
}
