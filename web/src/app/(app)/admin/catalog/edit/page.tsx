import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CatalogAdmin } from '@/components/admin/catalog-admin';
import { ContentStage } from '@/components/layout/content-stage';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { loadCatalogForPage } from '../load-catalog';

export const dynamic = 'force-dynamic';

export default async function CatalogEditPage() {
  const { data, denied } = await loadCatalogForPage();
  if (denied) notFound();

  return (
    <ContentStage className="max-w-4xl">
      <PageHeader
        eyebrow="System admin"
        title="Edit card catalog"
        description="Rename variants and cards, move cards between variants, hide entries, or bulk-add from a list. Changes go live immediately."
        actions={
          <Button asChild variant="outline">
            <Link href="/admin/catalog">Back to catalog</Link>
          </Button>
        }
      />
      <CatalogAdmin
        mode="edit"
        variants={data!.variants}
        types={data!.types}
        benefitCountByTypeId={data!.benefitCountByTypeId}
      />
    </ContentStage>
  );
}
