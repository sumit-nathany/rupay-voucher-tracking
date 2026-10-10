'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Filter, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { STATUS_OPTIONS } from './statuses';

export interface FilterOption {
  id: string;
  label: string;
  holderId?: string;
}

/** URL-driven filters: holder, card, status, text search (debounced). */
export function Filters({ holders, cards }: { holders: FilterOption[]; cards: FilterOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  const holder = sp.get('holder') ?? '';
  const card = sp.get('card') ?? '';
  const status = sp.get('status') ?? '';
  const sort = sp.get('sort') ?? '';
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
  const active = holder || card || status || sort || urlSearch;

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Filter className="h-3.5 w-3.5" aria-hidden /> Refine list
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <div className="relative sm:col-span-2 lg:col-span-1">
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

        <Select
          value={holder || '__all__'}
          onValueChange={(v) => set({ holder: v === '__all__' ? '' : v, card: '' })}
        >
          <SelectTrigger aria-label="Holder" className="w-full">
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
          <SelectTrigger aria-label="Card" className="w-full">
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
          <SelectTrigger aria-label="Status" className="w-full">
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
          value={sort || 'default'}
          onValueChange={(v) => set({ sort: v === 'default' ? '' : v })}
        >
          <SelectTrigger aria-label="Sort by" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default order</SelectItem>
            <SelectItem value="value-desc">Value: high → low</SelectItem>
            <SelectItem value="value-asc">Value: low → high</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {active && (
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          onClick={() => {
            setText('');
            set({ holder: '', card: '', status: '', sort: '', q: '' });
          }}
        >
          <X className="h-3.5 w-3.5" aria-hidden /> Clear all filters
        </button>
      )}
    </div>
  );
}
