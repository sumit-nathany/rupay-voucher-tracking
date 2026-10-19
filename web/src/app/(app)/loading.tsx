import { ContentStage } from '@/components/layout/content-stage';
import { PageHeaderSkeleton, PageSkeleton } from '@/components/dashboard/dashboard-skeletons';

export default function Loading() {
  return (
    <ContentStage className="max-w-6xl [.nav-unpinned_&]:max-w-7xl [.nav-unpinned_&]:2xl:max-w-[1536px]">
      <PageHeaderSkeleton />
      <PageSkeleton />
    </ContentStage>
  );
}
