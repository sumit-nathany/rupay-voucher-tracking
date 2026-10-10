import { unstable_rethrow } from 'next/navigation';
import { loadBenefitsAction } from '@/actions/instance-queries';
import { ErrorPanel } from '@/components/dashboard/error-panel';
import type { InstanceListItem } from '@/domain/instance-queries';
import type { ORDER_STATUSES } from '@/domain/instances';
import type { ViewedPeriod } from '@/lib/periods';
import { EmptyState } from '@/components/layout/empty-state';
import { BenefitList } from './benefit-list';

export type BenefitFilters = {
  holderId?: string;
  cardId?: string;
  /** Catalog benefit id or card-override id. */
  benefitId?: string;
  status?: (typeof ORDER_STATUSES)[number];
  search?: string;
  offerFilter?: 'all' | 'discount';
  /** Not Ordered only: `1` lapsed rows, `0` still in period. */
  lapsed?: '0' | '1';
};

export async function BenefitsContent({
  view,
  filters,
  filtered,
  lifetime = false,
}: {
  view: ViewedPeriod;
  filters: BenefitFilters;
  filtered: boolean;
  lifetime?: boolean;
}) {
  let items: InstanceListItem[];
  try {
    items = await loadBenefitsAction({
      view,
      ...filters,
      scope: lifetime ? 'lifetime' : undefined,
    });
  } catch (e) {
    unstable_rethrow(e);
    return <ErrorPanel message="The benefits list could not be loaded. Check the filters and try again." />;
  }

  if (items.length === 0) {
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
  return <BenefitList items={items} />;
}
