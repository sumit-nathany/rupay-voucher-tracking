import { Suspense } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { listCards } from '@/actions/cards';
import { listBenefitFilterOptionsAction } from '@/actions/instance-queries';
import { listHolders } from '@/actions/holders';
import { BenefitsContent, type BenefitFilters } from '@/components/benefits/benefits-content';
import { Filters, type FilterOption } from '@/components/benefits/filters';
import { PageSkeleton } from '@/components/dashboard/error-panel';
import { PeriodSelector } from '@/components/dashboard/period-selector';
import { isLifetimeScope, parseView, viewLabel } from '@/components/dashboard/view-params';
import { ContentStage } from '@/components/layout/content-stage';
import { PageHeader } from '@/components/layout/page-header';
import { formatCardLabel } from '@/domain/card-label';
import { ORDER_STATUSES } from '@/domain/instances';
import { today as istToday } from '@/lib/periods';

type Raw = string | string[] | undefined;
const first = (v: Raw) => (Array.isArray(v) ? v[0] : v) || undefined;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOptions(holderId?: string, cardId?: string): Promise<{
  holders: FilterOption[];
  cards: FilterOption[];
  benefits: FilterOption[];
}> {
  try {
    const [h, c, benefits] = await Promise.all([
      listHolders(),
      listCards(),
      listBenefitFilterOptionsAction({ holderId, cardId }),
    ]);
    const holderById = new Map(h.map((x) => [x.id, x.name]));
    return {
      holders: h.map((x) => ({ id: x.id, label: x.name })),
      cards: c.map((x) => ({
        id: x.id,
        label: formatCardLabel({
          holderName: holderById.get(x.holderId),
          cardName: x.displayName,
          lastDigits: x.lastDigits,
        }),
        holderId: x.holderId,
      })),
      benefits,
    };
  } catch (e) {
    unstable_rethrow(e);
    return { holders: [], cards: [], benefits: [] }; // filters degrade; the list itself reports its own errors
  }
}

export default async function BenefitsPage({ searchParams }: { searchParams: Promise<Record<string, Raw>> }) {
  const sp = await searchParams;
  const today = istToday();
  const view = parseView(sp, today);
  const lifetime = isLifetimeScope(sp);

  // Invalid filter values are ignored rather than erroring (decision: lenient URL parsing).
  const holder = first(sp.holder);
  const card = first(sp.card);
  const status = first(sp.status);
  const q = first(sp.q)?.trim().slice(0, 100);
  const discountsRaw = first(sp.discounts);
  const offerFilter =
    discountsRaw === '1' ? 'all' : discountsRaw === 'only' ? 'discount' : ('voucher' as const);
  const lapsedRaw = first(sp.lapsed);
  const lapsed = lapsedRaw === '1' ? '1' : lapsedRaw === '0' ? '0' : undefined;
  const benefitRaw = first(sp.benefit);
  const searchScopeRaw = first(sp.search_scope);
  const searchScope = q && searchScopeRaw === 'all' ? 'all' : 'current';
  const filters: BenefitFilters = {
    holderId: holder && UUID.test(holder) ? holder : undefined,
    cardId: card && UUID.test(card) ? card : undefined,
    benefitId: benefitRaw && UUID.test(benefitRaw) ? benefitRaw : undefined,
    status: ORDER_STATUSES.find((s) => s === status),
    search: q || undefined,
    offerFilter: offerFilter === 'voucher' ? undefined : offerFilter,
    lapsed,
    searchScope,
  };
  const filtered =
    Boolean(
      filters.holderId ||
        filters.cardId ||
        filters.benefitId ||
        filters.status ||
        filters.search ||
        filters.lapsed,
    ) ||
    offerFilter !== 'voucher' ||
    lifetime ||
    searchScope === 'all';
  const options = await loadOptions(filters.holderId, filters.cardId);

  return (
    <ContentStage className="max-w-7xl">
      <PageHeader
        eyebrow="Work queue"
        title={lifetime ? 'Lifetime' : viewLabel(view)}
        description={
          searchScope === 'all'
            ? 'Searching across all periods, holders, cards, and offer types.'
            : lifetime
              ? 'Every matching benefit across all periods — open a row for details, codes, and status.'
              : 'Every benefit instance for the period — open a row for details, codes, and status.'
        }
        actions={<PeriodSelector view={view} today={today} lifetime={lifetime} />}
      />
      <Filters holders={options.holders} cards={options.cards} benefits={options.benefits} />
      <div className="mt-10">
        <Suspense key={JSON.stringify([view, filters, lifetime, searchScope])} fallback={<PageSkeleton />}>
          <BenefitsContent
            view={view}
            filters={filters}
            filtered={filtered}
            lifetime={lifetime}
            searchScope={searchScope}
          />
        </Suspense>
      </div>
    </ContentStage>
  );
}
