'use client';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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
  const active = holder || card || status || urlSearch;

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Input
        type="search"
        aria-label="Search benefits"
        placeholder="Search benefit, card, holder…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="sm:col-span-2 lg:col-span-1"
      />
      <Select
        aria-label="Holder"
        value={holder}
        onChange={(e) => set({ holder: e.target.value, card: '' })}
      >
        <option value="">All holders</option>
        {holders.map((h) => (
          <option key={h.id} value={h.id}>{h.label}</option>
        ))}
      </Select>
      <Select aria-label="Card" value={card} onChange={(e) => set({ card: e.target.value })}>
        <option value="">All cards</option>
        {visibleCards.map((c) => (
          <option key={c.id} value={c.id}>{c.label}</option>
        ))}
      </Select>
      <Select aria-label="Status" value={status} onChange={(e) => set({ status: e.target.value })}>
        <option value="">All statuses</option>
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </Select>
      {active && (
        <button
          type="button"
          className="text-left text-sm text-muted-foreground underline sm:col-span-2 lg:col-span-4"
          onClick={() => {
            setText('');
            set({ holder: '', card: '', status: '', q: '' });
          }}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
