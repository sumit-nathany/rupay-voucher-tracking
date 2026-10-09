import { notFound } from 'next/navigation';
import { listCatalogForAdminAction } from '@/actions/catalog-admin';
import { CatalogAdmin } from '@/components/admin/catalog-admin';
import { ContentStage } from '@/components/layout/content-stage';
import { PageHeader } from '@/components/layout/page-header';
import { AuthzError } from '@/lib/context';

export const dynamic = 'force-dynamic';

export default async function CatalogAdminPage() {
  let data;
  try {
    data = await listCatalogForAdminAction();
  } catch (e) {
    // Not a system admin: the page does not exist for them.
    if (e instanceof AuthzError) notFound();
    throw e;
  }
  return (
    <ContentStage className="max-w-4xl">
      <PageHeader
        eyebrow="System admin"
        title="Card catalog"
        description="Variants and bank cards in the add-card picker. Edits go live immediately."
      />
      <CatalogAdmin variants={data.variants} types={data.types} benefitCountByTypeId={data.benefitCountByTypeId} />
    </ContentStage>
  );
}
