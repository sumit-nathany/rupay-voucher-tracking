'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Filter, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { isLifetimeScope } from '@/components/dashboard/view-params';
import {
  defaultBenefitGroupMode,
  parseBenefitGroupMode,
  type BenefitGroupMode,
} from './group';
import { STATUS_OPTIONS } from './statuses';

export interface FilterOption {
  id: string;
  label: string;
  holderId?: string;
}

/** URL-driven filters: holder, card, status, text search (debounced). */
export function Filters({
  holders,
  cards,
  benefits,
}: {
  holders: FilterOption[];
  cards: FilterOption[];
  benefits: FilterOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  const holder = sp.get('holder') ?? '';
  const card = sp.get('card') ?? '';
  const status = sp.get('status') ?? '';
  const sort = sp.get('sort') ?? '';
  const discounts = sp.get('discounts') ?? '';
  const benefit = sp.get('benefit') ?? '';
  const lifetime = isLifetimeScope({ lifetime: sp.get('lifetime') ?? undefined });
  const groupRaw = sp.get('group');
  const groupMode = parseBenefitGroupMode(groupRaw) ?? defaultBenefitGroupMode(lifetime);
  const groupDefault = defaultBenefitGroupMode(lifetime);
  const urlSearch = sp.get('q') ?? '';
  const [text, setText] = useState(urlSearch);
  const spRef = useRef(sp);
  spRef.current = sp;

  function set(changes: Record<string, string>) {
    const p = new URLSearchParams(spRef.current.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    start(() => router.push(`${pathname}?${p.toString()}`));
  }

  useEffect(() => {
    if (text.trim() === urlSearch) return;
    const t = setTimeout(() => set({ q: text.trim() }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const visibleCards = holder ? cards.filter((c) => c.holderId === holder) : cards;
  const lapsed = sp.get('lapsed') ?? '';
  const active =
    holder ||
    card ||
    benefit ||
    status ||
    sort === 'value-asc' ||
    discounts ||
    urlSearch ||
    lapsed ||
    groupRaw;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Filter className="h-3.5 w-3.5" aria-hidden /> Refine list
        </div>
        {active && (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            onClick={() => {
              setText('');
              set({
                holder: '',
                card: '',
                benefit: '',
                status: '',
                sort: '',
                discounts: '',
                q: '',
                lapsed: '',
                group: '',
              });
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Clear all filters
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <Select
            value={holder || '__all__'}
            onValueChange={(v) => set({ holder: v === '__all__' ? '' : v, card: '' })}
          >
            <SelectTrigger aria-label="Holder" className="w-fit max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All holders</SelectItem>
              {holders.map((h) => (
                <SelectItem key={h.id} value={h.id}>{h.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={card || '__all__'}
            onValueChange={(v) => set({ card: v === '__all__' ? '' : v })}
          >
            <SelectTrigger aria-label="Card" className="w-fit max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All cards</SelectItem>
              {visibleCards.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={status || '__all__'}
            onValueChange={(v) => set({ status: v === '__all__' ? '' : v })}
          >
            <SelectTrigger aria-label="Status" className="w-fit max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={benefit || '__all__'}
            onValueChange={(v) => set({ benefit: v === '__all__' ? '' : v })}
          >
            <SelectTrigger aria-label="Benefit" className="w-fit max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All benefits</SelectItem>
              {benefits.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={sort === 'value-asc' ? 'value-asc' : 'value-desc'}
            onValueChange={(v) => set({ sort: v === 'value-desc' ? '' : v })}
          >
            <SelectTrigger aria-label="Sort by" className="w-fit max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="value-desc">Value: high → low</SelectItem>
              <SelectItem value="value-asc">Value: low → high</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={discounts === '1' ? 'all' : discounts === 'only' ? 'discount-only' : 'vouchers'}
            onValueChange={(v) =>
              set({ discounts: v === 'all' ? '1' : v === 'discount-only' ? 'only' : '' })
            }
          >
            <SelectTrigger aria-label="Offer type" className="w-fit max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vouchers">Gift vouchers only</SelectItem>
              <SelectItem value="all">Gift Vouchers + Discount Coupons</SelectItem>
              <SelectItem value="discount-only">Discount coupons only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="ml-auto flex w-full shrink-0 flex-wrap items-center gap-2 border-border pl-0 sm:w-auto sm:border-l sm:pl-4 justify-end sm:justify-start">
          <Select
            value={groupMode}
            onValueChange={(v) => {
              const mode = v as BenefitGroupMode;
              set({ group: mode === groupDefault ? '' : mode });
            }}
          >
            <SelectTrigger aria-label="Group by" className="w-fit max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="period">Group: period</SelectItem>
              <SelectItem value="card">Group: card</SelectItem>
              <SelectItem value="holder">Group: holder</SelectItem>
              <SelectItem value="benefit">Group: benefit</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative w-44 max-w-full shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              aria-label="Search benefits"
              placeholder="Search…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
