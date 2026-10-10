import { calendarQuarterForDate, today, type ViewedPeriod } from '@/lib/periods';

// URL contract: ?v=year|half|quarter|month &y=<year> &n=<half|quarter|month number>.
// Invalid/missing params fall back to the calendar quarter containing today (IST).

export function defaultView(todayStr: string = today()): ViewedPeriod {
  return calendarQuarterForDate(todayStr);
}

type Raw = string | string[] | undefined;
const first = (v: Raw) => (Array.isArray(v) ? v[0] : v);

/** Benefits list across every period in the workspace (`?lifetime=1`). */
export function isLifetimeScope(sp: Record<string, Raw>): boolean {
  return first(sp.lifetime) === '1';
}

export function parseView(sp: Record<string, Raw>, todayStr: string = today()): ViewedPeriod {
  const fallback = defaultView(todayStr);
  const kind = first(sp.v);
  const year = Number(first(sp.y));
  const n = Number(first(sp.n));
  if (!kind) return fallback;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return fallback;
  switch (kind) {
    case 'year':
      return { kind, year };
    case 'half':
      return n === 1 || n === 2 ? { kind, year, half: n } : fallback;
    case 'quarter':
      return n >= 1 && n <= 4 && Number.isInteger(n)
        ? { kind, year, quarter: n as 1 | 2 | 3 | 4 }
        : fallback;
    case 'month':
      return Number.isInteger(n) && n >= 1 && n <= 12 ? { kind, year, month: n } : fallback;
    default:
      return fallback;
  }
}

export function viewToParams(view: ViewedPeriod): Record<string, string> {
  switch (view.kind) {
    case 'year':
      return { v: 'year', y: String(view.year) };
    case 'half':
      return { v: 'half', y: String(view.year), n: String(view.half) };
    case 'quarter':
      return { v: 'quarter', y: String(view.year), n: String(view.quarter) };
    case 'month':
      return { v: 'month', y: String(view.year), n: String(view.month) };
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (m: number) => MONTHS[m - 1] ?? String(m);

export function viewLabel(view: ViewedPeriod): string {
  switch (view.kind) {
    case 'year':
      return `${view.year}`;
    case 'half':
      return `${view.year} H${view.half}`;
    case 'quarter':
      return `${view.year} Q${view.quarter}`;
    case 'month':
      return `${monthName(view.month)} ${view.year}`;
  }
}
