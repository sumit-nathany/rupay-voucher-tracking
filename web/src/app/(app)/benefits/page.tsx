import { Suspense } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { listCards } from '@/actions/cards';
import { listHolders } from '@/actions/holders';
import { BenefitsContent, type BenefitFilters } from '@/components/benefits/benefits-content';
import { Filters, type FilterOption } from '@/components/benefits/filters';
import { PageSkeleton } from '@/components/dashboard/error-panel';
import { PeriodSelector } from '@/components/dashboard/period-selector';
import { parseView, viewLabel } from '@/components/dashboard/view-params';
import { ORDER_STATUSES } from '@/domain/instances';
import { today as istToday } from '@/lib/periods';

type Raw = string | string[] | undefined;
const first = (v: Raw) => (Array.isArray(v) ? v[0] : v) || undefined;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadOptions(): Promise<{ holders: FilterOption[]; cards: FilterOption[] }> {
  try {
    const [h, c] = await Promise.all([listHolders(), listCards()]);
    return {
      holders: h.map((x) => ({ id: x.id, label: x.name })),
      cards: c.map((x) => ({
        id: x.id,
        label: x.lastDigits ? `${x.displayName} ••${x.lastDigits}` : x.displayName,
        holderId: x.holderId,
      })),
    };
  } catch (e) {
    unstable_rethrow(e);
    return { holders: [], cards: [] }; // filters degrade; the list itself reports its own errors
  }
}

export default async function BenefitsPage({ searchParams }: { searchParams: Promise<Record<string, Raw>> }) {
  const sp = await searchParams;
  const today = istToday();
  const view = parseView(sp, today);

  // Invalid filter values are ignored rather than erroring (decision: lenient URL parsing).
  const holder = first(sp.holder);
  const card = first(sp.card);
  const status = first(sp.status);
  const q = first(sp.q)?.trim().slice(0, 100);
  const filters: BenefitFilters = {
    holderId: holder && UUID.test(holder) ? holder : undefined,
    cardId: card && UUID.test(card) ? card : undefined,
    status: ORDER_STATUSES.find((s) => s === status),
    search: q || undefined,
  };
  const filtered = Object.values(filters).some(Boolean);
  const options = await loadOptions();

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold">Benefits · {viewLabel(view)}</h1>
        <PeriodSelector view={view} today={today} />
      </div>
      <Filters holders={options.holders} cards={options.cards} />
      <Suspense key={JSON.stringify([view, filters])} fallback={<PageSkeleton />}>
        <BenefitsContent view={view} filters={filters} filtered={filtered} />
      </Suspense>
    </div>
  );
}
