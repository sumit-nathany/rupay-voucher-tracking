import { getUserProfileAction } from '@/actions/profile';
import { ContentStage } from '@/components/layout/content-stage';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorPanel } from '@/components/dashboard/error-panel';
import { ProfileView } from '@/components/profile/profile-view';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const result = await getUserProfileAction();

  if (!result.ok || !result.data) {
    return (
      <ContentStage className="max-w-4xl">
        <PageHeader
          eyebrow="Account & Access"
          title="User Profile"
          description="View your profile details, workspace access, and update your password."
        />
        <ErrorPanel message={result.error ?? 'Could not load your profile details.'} />
      </ContentStage>
    );
  }

  return (
    <ContentStage className="max-w-5xl space-y-6 sm:space-y-8 p-6 sm:p-8 [.nav-unpinned_&]:max-w-6xl [.nav-unpinned_&]:2xl:max-w-7xl">
      <PageHeader
        eyebrow="Account & Access"
        title="User Profile"
        description="View your profile details, workspace access, and update your password."
      />
      <ProfileView initialData={result.data} />
    </ContentStage>
  );
}
