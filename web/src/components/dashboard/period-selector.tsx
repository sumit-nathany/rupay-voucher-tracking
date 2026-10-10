'use client';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ViewedPeriod } from '@/lib/periods';
import { monthName, viewToParams } from './view-params';

const ALL = '__all__';

function quarterOfMonth(month: number): 1 | 2 | 3 | 4 {
  return (Math.ceil(month / 3) as 1 | 2 | 3 | 4);
}

function selectedQuarter(view: ViewedPeriod): number | null {
  if (view.kind === 'quarter') return view.quarter;
  if (view.kind === 'month') return quarterOfMonth(view.month);
  return null;
}

function selectedMonth(view: ViewedPeriod): number | null {
  return view.kind === 'month' ? view.month : null;
}

function monthsInQuarter(q: number): number[] {
  const start = (q - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

/**
 * URL-driven period selector. Preserves every other search param (filters).
 * Year is required; quarter and month are optional refinements.
 * `today` is passed from the server so the client never computes its own date.
 */
export function PeriodSelector({
  view,
  today,
  lifetime = false,
}: {
  view: ViewedPeriod;
  today: string;
  lifetime?: boolean;
}) {
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
    p.delete('lifetime');
    for (const k of ['v', 'y', 'n']) p.delete(k);
    for (const [k, v] of Object.entries(viewToParams(next))) p.set(k, v);
    start(() => router.push(`${pathname}?${p.toString()}`));
  }

  const year = view.year;
  const quarter = selectedQuarter(view);
  const month = selectedMonth(view);

  if (lifetime) {
    return (
      <div className="inline-flex w-fit max-w-full flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">All periods</span>
        <span aria-hidden>·</span>
        <span>Pick a year or quarter to leave lifetime view</span>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex w-fit max-w-full flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 transition-opacity duration-200 ${pending ? 'pointer-events-none opacity-60' : ''}`}
      aria-busy={pending}
    >
      <Select value={String(year)} onValueChange={(v) => go({ kind: 'year', year: Number(v) })}>
        <SelectTrigger aria-label="Year" className="w-auto shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={quarter == null ? ALL : String(quarter)}
        onValueChange={(v) => {
          if (v === ALL) go({ kind: 'year', year });
          else go({ kind: 'quarter', year, quarter: Number(v) as 1 | 2 | 3 | 4 });
        }}
      >
        <SelectTrigger aria-label="Quarter" className="w-auto shrink-0">
          <SelectValue placeholder="All year" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All year</SelectItem>
          {[1, 2, 3, 4].map((q) => (
            <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {quarter != null && (
        <Select
          value={month == null ? ALL : String(month)}
          onValueChange={(v) => {
            if (v === ALL) go({ kind: 'quarter', year, quarter: quarter as 1 | 2 | 3 | 4 });
            else go({ kind: 'month', year, month: Number(v) });
          }}
        >
          <SelectTrigger aria-label="Month" className="w-auto shrink-0">
            <SelectValue placeholder="All quarter" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All quarter</SelectItem>
            {monthsInQuarter(quarter).map((m) => (
              <SelectItem key={m} value={String(m)}>{monthName(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
