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
  status?: (typeof ORDER_STATUSES)[number];
  search?: string;
};

export async function BenefitsContent({
  view,
  filters,
  filtered,
}: {
  view: ViewedPeriod;
  filters: BenefitFilters;
  filtered: boolean;
}) {
  let items: InstanceListItem[];
  try {
    items = await loadBenefitsAction({ view, ...filters });
  } catch (e) {
    unstable_rethrow(e);
    return <ErrorPanel message="The benefits list could not be loaded. Check the filters and try again." />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title={filtered ? 'No matches' : 'Nothing in this period'}
        description={
          filtered
            ? 'Try clearing a filter or choosing another period.'
            : 'Add a card on the Cards page — benefits appear here automatically.'
        }
      />
    );
  }
  return <BenefitList items={items} />;
}
