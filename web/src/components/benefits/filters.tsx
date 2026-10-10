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
  categories,
}: {
  holders: FilterOption[];
  cards: FilterOption[];
  categories: FilterOption[];
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
  const category = sp.get('category') ?? sp.get('benefit') ?? '';
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
    if (urlSearch !== text.trim()) {
      setText(urlSearch);
    }
  }, [urlSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const trimmed = text.trim();
    if (!trimmed) {
      if (spRef.current.get('search_scope') || spRef.current.get('q')) {
        set({ search_scope: '', q: '' });
      }
      return;
    }
    if (trimmed === urlSearch) return;
    const t = setTimeout(() => set({ q: trimmed }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const hasSearch = Boolean(text.trim());
  const visibleCards = holder ? cards.filter((c) => c.holderId === holder) : cards;
  const lapsed = sp.get('lapsed') ?? '';
  const searchScopeRaw = sp.get('search_scope') ?? '';
  const searchScope = Boolean(urlSearch) && searchScopeRaw === 'all' ? 'all' : 'current';
  const active =
    holder ||
    card ||
    category ||
    status ||
    (sort && sort !== 'category') ||
    discounts ||
    urlSearch ||
    lapsed ||
    groupRaw ||
    (searchScope === 'all' && Boolean(urlSearch));

  /** Applied to a SelectTrigger when it has a non-default value selected. */
  const activeFilter = 'border-primary/50 bg-primary/5 text-primary font-medium';
  const base = 'w-full min-w-0 sm:w-fit sm:max-w-full';

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Filter className="h-3.5 w-3.5" aria-hidden /> Refine list
        </div>
        {searchScope === 'all' && Boolean(urlSearch) && (
          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
            Across everything
          </span>
        )}
        {active && (
          <button
            type="button"
            className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            onClick={() => {
              setText('');
              set({
                holder: '',
                card: '',
                category: '',
                benefit: '',
                status: '',
                sort: '',
                discounts: '',
                q: '',
                lapsed: '',
                group: '',
                search_scope: '',
              });
            }}
          >
            <X className="h-3.5 w-3.5" aria-hidden /> Clear all filters
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        <div
          className={`grid grid-cols-2 gap-2 sm:flex sm:min-w-0 sm:flex-1 sm:flex-wrap sm:items-center transition-opacity ${
            searchScope === 'all' && Boolean(urlSearch) ? 'opacity-60' : ''
          }`}
          title={searchScope === 'all' && Boolean(urlSearch) ? 'Filters are ignored while searching across everything' : undefined}
        >
          {/* Holder */}
          <Select
            value={holder || '__all__'}
            onValueChange={(v) => set({ holder: v === '__all__' ? '' : v, card: '' })}
          >
            <SelectTrigger aria-label="Holder" className={`${base} ${holder ? activeFilter : ''}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All holders</SelectItem>
              {holders.map((h) => (
                <SelectItem key={h.id} value={h.id}>{h.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Card */}
          <Select
            value={card || '__all__'}
            onValueChange={(v) => set({ card: v === '__all__' ? '' : v })}
          >
            <SelectTrigger aria-label="Card" className={`${base} ${card ? activeFilter : ''}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All cards</SelectItem>
              {visibleCards.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status */}
          <Select
            value={status || '__all__'}
            onValueChange={(v) => set({ status: v === '__all__' ? '' : v })}
          >
            <SelectTrigger aria-label="Status" className={`${base} ${status ? activeFilter : ''}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All statuses</SelectItem>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Category */}
          <Select
            value={category || '__all__'}
            onValueChange={(v) => set({ category: v === '__all__' ? '' : v, benefit: '' })}
          >
            <SelectTrigger aria-label="Category" className={`${base} ${category ? activeFilter : ''}`}>
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Sort */}
          <Select
            value={sort === 'value-desc' || sort === 'value-asc' ? sort : 'category'}
            onValueChange={(v) => set({ sort: v === 'category' ? '' : v })}
          >
            <SelectTrigger aria-label="Sort by" className={`${base} ${sort && sort !== 'category' ? activeFilter : ''}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="category">Order: category</SelectItem>
              <SelectItem value="value-desc">Value: high &#x2192; low</SelectItem>
              <SelectItem value="value-asc">Value: low &#x2192; high</SelectItem>
            </SelectContent>
          </Select>

          {/* Offer type */}
          <Select
            value={discounts === '1' ? 'all' : discounts === 'only' ? 'discount-only' : 'vouchers'}
            onValueChange={(v) =>
              set({ discounts: v === 'all' ? '1' : v === 'discount-only' ? 'only' : '' })
            }
          >
            <SelectTrigger aria-label="Offer type" className={`${base} ${discounts ? activeFilter : ''}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vouchers">Gift vouchers only</SelectItem>
              <SelectItem value="all">Gift Vouchers + Discount Coupons</SelectItem>
              <SelectItem value="discount-only">Discount coupons only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex w-full flex-col gap-2 border-border border-t pt-2 sm:border-t-0 sm:pt-0 sm:ml-auto sm:w-auto sm:shrink-0 sm:border-l sm:pl-4">
          {/* Row 1: Group by */}
          <Select
            value={groupMode}
            onValueChange={(v) => {
              const mode = v as BenefitGroupMode;
              set({ group: mode === groupDefault ? '' : mode });
            }}
          >
            <SelectTrigger
              aria-label="Group by"
              className={`w-fit ${groupRaw && groupMode !== groupDefault ? activeFilter : ''}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="period">Group: period</SelectItem>
              <SelectItem value="category">Group: category</SelectItem>
              <SelectItem value="card">Group: card</SelectItem>
              <SelectItem value="holder">Group: holder</SelectItem>
              <SelectItem value="benefit">Group: benefit</SelectItem>
            </SelectContent>
          </Select>

          {/* Row 2: Search input + scope */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="search"
                aria-label="Search benefits"
                placeholder={searchScope === 'all' && Boolean(urlSearch) ? 'Search everything\u2026' : 'Search\u2026'}
                value={text}
                onChange={(e) => {
                  const val = e.target.value;
                  setText(val);
                  if (!val.trim() && spRef.current.get('search_scope')) {
                    set({ search_scope: '', q: '' });
                  }
                }}
                className="pl-9 w-full"
              />
            </div>

            <Select
              value={hasSearch && searchScopeRaw === 'all' ? 'all' : 'current'}
              disabled={!hasSearch}
              onValueChange={(v) => {
                if (!text.trim()) return;
                set({
                  search_scope: v === 'all' ? 'all' : '',
                  q: text.trim(),
                });
              }}
            >
              <SelectTrigger
                aria-label="Search scope"
                disabled={!hasSearch}
                title={!hasSearch ? 'Enter search terms to search across everything' : undefined}
                className={hasSearch && searchScopeRaw === 'all' ? activeFilter : ''}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current">Current filters</SelectItem>
                <SelectItem value="all">Across everything</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
