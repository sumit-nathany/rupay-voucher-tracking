'use client';
import { Gift } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatINR } from '@/components/dashboard/format';
import type { InstanceListItem } from '@/domain/instance-queries';
import { cn } from '@/lib/utils';
import { benefitLabel } from './label';
import { groupItems } from './group';
import { StatusBadge } from './status-badge';
import { useBenefitDrawer } from './use-drawer';

const GRID = 'md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,2.3fr)_6rem_12rem] md:items-center md:gap-4';

function Row({ it, onOpen }: { it: InstanceListItem; onOpen: (id: string, l?: { title: string; subtitle: string }) => void }) {
  const muted = it.status === 'Withdrawn' || it.status === 'Skipped';
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(it.id, { title: `${it.benefitType}: ${benefitLabel(it)}`, subtitle: `${it.holderName} · ${it.cardName}` })}
        className={cn(
          'block w-full px-4 py-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
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
        </span>
        <span className="hidden text-right text-sm tabular-nums md:block">{formatINR(it.value)}</span>
        <span className="mt-2 flex flex-wrap items-center gap-1.5 md:mt-0 md:justify-end">
          <StatusBadge item={it} />
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

export function BenefitList({ items }: { items: InstanceListItem[] }) {
  const { open, drawer } = useBenefitDrawer();
  const groups = groupItems(items);
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`g-${g.key}`}>
          <h2 id={`g-${g.key}`} className="mb-2 flex items-center gap-2 text-sm font-semibold">
            {g.title}
            <span className="text-xs font-normal text-muted-foreground">{g.items.length}</span>
          </h2>
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className={cn('hidden border-b bg-muted px-4 py-2 text-xs font-medium text-muted-foreground', GRID)} aria-hidden>
              <span>Category</span>
              <span>Benefit</span>
              <span>Holder / card</span>
              <span className="text-right">Value</span>
              <span className="text-right">Status</span>
            </div>
            <ul className="divide-y">
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
