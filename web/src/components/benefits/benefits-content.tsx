import { unstable_rethrow } from 'next/navigation';
import { loadBenefitsAction } from '@/actions/instance-queries';
import { ErrorPanel } from '@/components/dashboard/error-panel';
import type { InstanceListItem } from '@/domain/instance-queries';
import type { ORDER_STATUSES } from '@/domain/instances';
import type { ViewedPeriod } from '@/lib/periods';
import { EmptyState } from '@/components/layout/empty-state';
import { BenefitList } from './benefit-list';
import { SearchEmptyState } from './search-empty-state';

export type BenefitFilters = {
  holderId?: string;
  cardId?: string;
  portalAccountId?: string;
  /** Catalog benefit id or card-override id. */
  benefitId?: string;
  category?: string;
  status?: (typeof ORDER_STATUSES)[number];
  search?: string;
  offerFilter?: 'all' | 'discount';
  /** Not Ordered only: `1` lapsed rows, `0` still in period. */
  lapsed?: '0' | '1';
  searchScope?: 'current' | 'all';
};

export async function BenefitsContent({
  view,
  filters,
  filtered,
  lifetime = false,
  searchScope = 'current',
  portalAccounts,
}: {
  view: ViewedPeriod;
  filters: BenefitFilters;
  filtered: boolean;
  lifetime?: boolean;
  searchScope?: 'current' | 'all';
  portalAccounts?: Array<{ id: string; label: string; phoneNumber?: string | null; status?: string }>;
}) {
  let items: InstanceListItem[];
  const isAll = (searchScope === 'all' || filters.searchScope === 'all') && Boolean(filters.search);
  try {
    items = await loadBenefitsAction({
      view,
      ...filters,
      scope: isAll ? 'all' : lifetime ? 'lifetime' : undefined,
    });
  } catch (e) {
    console.error('[BenefitsContent] failed to load benefits:', e);
    unstable_rethrow(e);
    const msg = e instanceof Error ? e.message : String(e);
    return <ErrorPanel message={`The benefits list could not be loaded: ${msg}`} />;
  }

  if (items.length === 0) {
    if (filters.search) {
      let allCount = 0;
      if (!isAll) {
        try {
          const allMatches = await loadBenefitsAction({
            view,
            search: filters.search,
            scope: 'all',
          });
          allCount = allMatches.length;
        } catch (err) {
          console.error('[BenefitsContent] failed to check all matches for search:', err);
        }
      }

      const hasOtherFilters = Boolean(
        filters.holderId ||
          filters.cardId ||
          filters.portalAccountId ||
          filters.benefitId ||
          filters.category ||
          filters.status ||
          filters.offerFilter ||
          filters.lapsed,
      );

      return (
        <SearchEmptyState
          query={filters.search}
          allCount={allCount}
          hasOtherFilters={hasOtherFilters}
          isAll={isAll}
        />
      );
    }

    return (
      <EmptyState
        title={filtered ? 'No matches' : lifetime ? 'Nothing yet' : 'Nothing in this period'}
        description={
          filtered
            ? lifetime
              ? 'Try clearing a filter or pick a single period above.'
              : 'Try clearing a filter or choosing another period.'
            : 'Add a card on the Cards page — benefits appear here automatically.'
        }
      />
    );
  }
  return <BenefitList items={items} portalAccounts={portalAccounts} />;
}
