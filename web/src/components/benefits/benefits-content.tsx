import { unstable_rethrow } from 'next/navigation';
import { loadBenefitsAction } from '@/actions/instance-queries';
import { ErrorPanel } from '@/components/dashboard/error-panel';
import type { InstanceListItem } from '@/domain/instance-queries';
import type { ORDER_STATUSES } from '@/domain/instances';
import type { ViewedPeriod } from '@/lib/periods';
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
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="font-medium">{filtered ? 'No benefits match these filters' : 'No benefits in this period'}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtered
            ? 'Try clearing a filter or choosing another period.'
            : 'Add a card on the Cards page; its benefits appear here automatically.'}
        </p>
      </div>
    );
  }
  return <BenefitList items={items} />;
}
