'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Select } from '@/components/ui/select';
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
    const cur = defaultView(today); // current quarter, for sensible sub-period defaults
    const year = view.year;
    const q = cur.kind === 'quarter' ? cur.quarter : 1;
    const month = Number(today.slice(5, 7));
    switch (kind) {
      case 'year':
        return go({ kind, year });
      case 'half':
        return go({ kind, year, half: q <= 2 ? 1 : 2 });
      case 'quarter':
        return go({ kind, year, quarter: q });
      case 'month':
        return go({ kind, year, month });
    }
  }

  const sub =
    view.kind === 'half' ? (
      <Select
        aria-label="Half"
        value={view.half}
        onChange={(e) => go({ ...view, half: Number(e.target.value) as 1 | 2 })}
      >
        <option value={1}>H1 (Jan–Jun)</option>
        <option value={2}>H2 (Jul–Dec)</option>
      </Select>
    ) : view.kind === 'quarter' ? (
      <Select
        aria-label="Quarter"
        value={view.quarter}
        onChange={(e) => go({ ...view, quarter: Number(e.target.value) as 1 | 2 | 3 | 4 })}
      >
        {[1, 2, 3, 4].map((q) => (
          <option key={q} value={q}>
            Q{q}
          </option>
        ))}
      </Select>
    ) : view.kind === 'month' ? (
      <Select
        aria-label="Month"
        value={view.month}
        onChange={(e) => go({ ...view, month: Number(e.target.value) })}
      >
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i} value={i + 1}>
            {monthName(i + 1)}
          </option>
        ))}
      </Select>
    ) : null;

  return (
    <div className="flex flex-wrap gap-2" aria-busy={pending}>
      <Select
        aria-label="Period type"
        className="w-28"
        value={view.kind}
        onChange={(e) => changeKind(e.target.value as ViewedPeriod['kind'])}
      >
        <option value="year">Year</option>
        <option value="half">Half</option>
        <option value="quarter">Quarter</option>
        <option value="month">Month</option>
      </Select>
      <Select
        aria-label="Year"
        className="w-24"
        value={view.year}
        onChange={(e) => go({ ...view, year: Number(e.target.value) })}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </Select>
      {sub && <div className="w-36">{sub}</div>}
    </div>
  );
}
