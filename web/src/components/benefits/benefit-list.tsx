'use client';
import { useSearchParams } from 'next/navigation';
import { Gift } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatINR } from '@/components/dashboard/format';
import type { InstanceListItem } from '@/domain/instance-queries';
import { cn } from '@/lib/utils';
import { benefitLabel } from './label';
import { isLifetimeScope } from '@/components/dashboard/view-params';
import { type BenefitSort, groupBenefitItems, resolveBenefitGroupMode, sortBenefitItems } from './group';
import { StatusBadge } from './status-badge';
import { useBenefitDrawer } from './use-drawer';

const GRID = 'md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,2.3fr)_6rem_12rem] md:items-center md:gap-4';

function Row({ it, onOpen }: { it: InstanceListItem; onOpen: (id: string, l?: { title: string; subtitle: string }) => void }) {
  const muted = it.status === 'Withdrawn' || it.status === 'Skipped';
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(it.id, { title: `${it.benefitType}: ${benefitLabel(it)}`, subtitle: `${it.holderName} · ${it.cardName}${it.cardLastDigits ? ` ••${it.cardLastDigits}` : ''}${it.rupayBookingId ? ` · Booking: ${it.rupayBookingId}` : ''}` })}
        className={cn(
          'block w-full px-4 py-3.5 text-left transition-colors duration-200 hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          GRID,
          muted && 'opacity-70',
        )}
      >
        <span className="hidden min-w-0 truncate text-sm text-muted-foreground md:block">{it.benefitType}</span>
        <span className="flex items-start justify-between gap-2 md:block">
          <span className={cn('min-w-0 text-sm font-medium', it.status === 'Withdrawn' && 'line-through decoration-muted-foreground/60')}>
            <span className="text-muted-foreground md:hidden">{it.benefitType}: </span>
            {benefitLabel(it)}
          </span>
          <span className="shrink-0 text-sm font-medium tabular-nums md:hidden">{formatINR(it.value)}</span>
        </span>
        <span className="mt-0.5 block min-w-0 truncate text-xs text-muted-foreground md:mt-0 md:text-sm">
          {it.holderName} · {it.cardName}
          {it.cardLastDigits ? ` ••${it.cardLastDigits}` : ''}
          {it.rupayBookingId ? ` · Booking: ${it.rupayBookingId}` : ''}
        </span>
        <span className="hidden text-right text-sm tabular-nums md:block">{formatINR(it.value)}</span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5 md:mt-0 md:justify-end">
          <StatusBadge item={it} />
          {it.offerKind === 'discount' && (
            <Badge variant="secondary" title="Discount coupon — not a standard gift voucher">
              Discount
            </Badge>
          )}
          {it.hasCode && (
            <Badge variant="outline" className="gap-1" title="A voucher code is stored">
              <Gift className="h-3 w-3" aria-hidden /> Code
            </Badge>
          )}
        </span>
      </button>
    </li>
  );
}

function parseSort(raw: string | null): BenefitSort {
  if (raw === 'value-asc') return 'value-asc';
  return 'value-desc';
}

export function BenefitList({ items }: { items: InstanceListItem[] }) {
  const { open, drawer } = useBenefitDrawer();
  const sp = useSearchParams();
  const sort = parseSort(sp.get('sort'));
  const lifetime = isLifetimeScope({ lifetime: sp.get('lifetime') ?? undefined });
  const groupMode = resolveBenefitGroupMode(sp.get('group'), lifetime);
  const groups = groupBenefitItems(items, groupMode).map((g) => ({
    ...g,
    items: sortBenefitItems(g.items, sort),
  }));
  return (
    <div className="space-y-8">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`g-${g.key}`}>
          <div className="mb-3 flex items-center justify-between gap-3 border-b border-border/60 pb-2">
            <h2 id={`g-${g.key}`} className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
              {g.title}
            </h2>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
              {g.items.length}
            </span>
          </div>
          <div className="panel overflow-hidden">
            <div className={cn('hidden border-b border-border/80 bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground', GRID)} aria-hidden>
              <span>Category</span>
              <span>Benefit</span>
              <span>Holder / card</span>
              <span className="text-right">Value</span>
              <span className="text-right">Status</span>
            </div>
            <ul className="divide-y divide-border/80">
              {g.items.map((it) => (
                <Row key={it.id} it={it} onOpen={open} />
              ))}
            </ul>
          </div>
        </section>
      ))}
      {drawer}
    </div>
  );
}
