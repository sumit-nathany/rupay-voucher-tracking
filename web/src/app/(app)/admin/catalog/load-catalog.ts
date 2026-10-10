import { listCatalogForAdminAction } from '@/actions/catalog-admin';
import { AuthzError } from '@/lib/context';

export async function loadCatalogForPage() {
  try {
    return { data: await listCatalogForAdminAction(), denied: false as const };
  } catch (e) {
    if (e instanceof AuthzError) return { data: null, denied: true as const };
    throw e;
  }
}
