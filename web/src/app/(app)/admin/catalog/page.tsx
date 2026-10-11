import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { CatalogAdmin } from '@/components/admin/catalog-admin';
import { ContentStage } from '@/components/layout/content-stage';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { loadCatalogForPage } from './load-catalog';

export const dynamic = 'force-dynamic';

export default async function CatalogAdminPage() {
  const { data, denied } = await loadCatalogForPage();
  if (denied) notFound();

  return (
    <ContentStage className="max-w-4xl [.nav-unpinned_&]:max-w-5xl">
      <PageHeader
        eyebrow="System admin"
        title="Card catalog"
        description="Browse variants, bank cards, and catalog benefits. Use edit mode to change what appears in the add-card picker."
        actions={
          <Button asChild>
            <Link href="/admin/catalog/edit">
              <Pencil className="h-4 w-4" aria-hidden /> Edit catalog
            </Link>
          </Button>
        }
      />
      <CatalogAdmin
        mode="view"
        variants={data!.variants}
        types={data!.types}
        benefitCountByTypeId={data!.benefitCountByTypeId}
      />
    </ContentStage>
  );
}
