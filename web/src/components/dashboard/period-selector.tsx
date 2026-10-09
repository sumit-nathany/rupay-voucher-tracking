'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ViewedPeriod } from '@/lib/periods';
import { defaultView, monthName, viewToParams } from './view-params';

/**
 * URL-driven period selector. Preserves every other search param (filters).
 * `today` is passed from the server so the client never computes its own date.
 */
export function PeriodSelector({ view, today }: { view: ViewedPeriod; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  const nowYear = Number(today.slice(0, 4));
  const years = Array.from({ length: 6 }, (_, i) => nowYear - 4 + i);
  if (!years.includes(view.year)) years.push(view.year);
  years.sort((a, b) => a - b);

  function go(next: ViewedPeriod) {
    const p = new URLSearchParams(sp.toString());
    for (const k of ['v', 'y', 'n']) p.delete(k);
    for (const [k, v] of Object.entries(viewToParams(next))) p.set(k, v);
    start(() => router.push(`${pathname}?${p.toString()}`));
  }

  function changeKind(kind: ViewedPeriod['kind']) {
    const cur = defaultView(today);
    const year = view.year;
    const q = cur.kind === 'quarter' ? cur.quarter : 1;
    const month = Number(today.slice(5, 7));
    switch (kind) {
      case 'year':    return go({ kind, year });
      case 'half':    return go({ kind, year, half: q <= 2 ? 1 : 2 });
      case 'quarter': return go({ kind, year, quarter: q });
      case 'month':   return go({ kind, year, month });
    }
  }

  const sub =
    view.kind === 'half' ? (
      <Select value={String(view.half)} onValueChange={(v) => go({ ...view, half: Number(v) as 1 | 2 })}>
        <SelectTrigger aria-label="Half" className="w-44 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">H1 (Jan–Jun)</SelectItem>
          <SelectItem value="2">H2 (Jul–Dec)</SelectItem>
        </SelectContent>
      </Select>
    ) : view.kind === 'quarter' ? (
      <Select value={String(view.quarter)} onValueChange={(v) => go({ ...view, quarter: Number(v) as 1 | 2 | 3 | 4 })}>
        <SelectTrigger aria-label="Quarter" className="w-24 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[1, 2, 3, 4].map((q) => (
            <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : view.kind === 'month' ? (
      <Select value={String(view.month)} onValueChange={(v) => go({ ...view, month: Number(v) })}>
        <SelectTrigger aria-label="Month" className="w-36 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Array.from({ length: 12 }, (_, i) => (
            <SelectItem key={i} value={String(i + 1)}>{monthName(i + 1)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : null;

  return (
    <div
      className={`inline-flex w-fit max-w-full flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 transition-opacity duration-200 ${pending ? 'pointer-events-none opacity-60' : ''}`}
      aria-busy={pending}
    >
      <Select value={view.kind} onValueChange={(v) => changeKind(v as ViewedPeriod['kind'])}>
        <SelectTrigger aria-label="Period type" className="w-28 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="year">Year</SelectItem>
          <SelectItem value="half">Half</SelectItem>
          <SelectItem value="quarter">Quarter</SelectItem>
          <SelectItem value="month">Month</SelectItem>
        </SelectContent>
      </Select>

      <Select value={String(view.year)} onValueChange={(v) => go({ ...view, year: Number(v) })}>
        <SelectTrigger aria-label="Year" className="w-24 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {sub}
    </div>
  );
}
