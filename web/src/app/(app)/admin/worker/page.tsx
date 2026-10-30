import { notFound } from 'next/navigation';
import { getCtx, isSystemAdmin } from '@/lib/session';
import { ContentStage } from '@/components/layout/content-stage';
import { PageHeader } from '@/components/layout/page-header';
import { CloudWorkerControl } from '@/components/admin/cloud-worker-control';
import { getCloudWorkerStatus } from '@/lib/gcp-worker-client';

export const dynamic = 'force-dynamic';

export default async function AdminWorkerPage() {
  const ctx = await getCtx();
  const isAdmin = await isSystemAdmin(ctx.db, ctx.userId);
  if (!isAdmin) {
    notFound();
  }

  const initialStatus = await getCloudWorkerStatus();

  return (
    <ContentStage className="max-w-5xl space-y-8 sm:space-y-10 p-6 sm:p-10 [.nav-unpinned_&]:max-w-6xl [.nav-unpinned_&]:2xl:max-w-7xl">
      <PageHeader
        eyebrow="System admin"
        title="Cloud Ordering Worker"
        description="Monitor Google Cloud worker status, toggle the hourly Cloud Scheduler, and trigger batch ordering jobs on demand."
      />

      <CloudWorkerControl initialStatus={initialStatus} />
    </ContentStage>
  );
}
