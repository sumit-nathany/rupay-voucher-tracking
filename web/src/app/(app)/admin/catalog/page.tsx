import { notFound } from 'next/navigation';
import { listCatalogForAdminAction } from '@/actions/catalog-admin';
import { CatalogAdmin } from '@/components/admin/catalog-admin';
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
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Card catalog</h1>
        <p className="text-sm text-muted-foreground">
          The variants and cards people pick from when adding a card. Changes apply immediately, with no redeploy.
        </p>
      </div>
      <CatalogAdmin variants={data.variants} types={data.types} />
    </div>
  );
}
