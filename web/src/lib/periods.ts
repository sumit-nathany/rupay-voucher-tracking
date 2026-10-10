// Entitlement periods. All dates are plain 'YYYY-MM-DD' strings (lexicographic
// comparison is chronological), so no timezone-sensitive Date math is used
// except in today(), which pins the zone to Asia/Kolkata.

export type Frequency = 'Quarterly' | 'Annual' | '6 months' | 'Monthly';

export interface Period {
  start: string;
  end: string;
  label: string;
}

export interface FrequencyPeriod extends Period {
  frequency: Frequency;
}

export type ViewedPeriod =
  | { kind: 'year'; year: number }
  | { kind: 'half'; year: number; half: 1 | 2 }
  | { kind: 'quarter'; year: number; quarter: 1 | 2 | 3 | 4 }
  | { kind: 'month'; year: number; month: number }; // month 1-12

const IST_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar quarter containing `todayStr` (YYYY-MM-DD). */
export function calendarQuarterForDate(todayStr: string): ViewedPeriod & { kind: 'quarter' } {
  const year = Number(todayStr.slice(0, 4));
  const month = Number(todayStr.slice(5, 7));
  return { kind: 'quarter', year, quarter: (Math.ceil(month / 3) as 1 | 2 | 3 | 4) };
}

/** Current calendar date in Asia/Kolkata as 'YYYY-MM-DD'. `now` is injectable for tests. */
export function today(now: Date = new Date()): string {
  const parts = IST_DATE.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function monthSpan(y: number, fromM: number, toM: number, label: string): Period {
  return { start: ymd(y, fromM, 1), end: ymd(y, toM, daysInMonth(y, toM)), label };
}

export function computePeriods(year: number, frequency: Frequency): Period[] {
  switch (frequency) {
    case 'Annual':
      return [monthSpan(year, 1, 12, `${year}`)];
    case '6 months':
      return [1, 2].map((h) => monthSpan(year, h * 6 - 5, h * 6, `${year}-H${h}`));
    case 'Quarterly':
      return [1, 2, 3, 4].map((q) => monthSpan(year, q * 3 - 2, q * 3, `${year}-Q${q}`));
    case 'Monthly':
      return Array.from({ length: 12 }, (_, i) =>
        monthSpan(year, i + 1, i + 1, `${year}-${pad(i + 1)}`),
      );
    default:
      throw new Error(`Unknown frequency: ${String(frequency)}`);
  }
}

const tag = (frequency: Frequency, ps: Period[]): FrequencyPeriod[] =>
  ps.map((p) => ({ ...p, frequency }));

/**
 * Expand a viewed period into the full set of periods to generate (before
 * bounding). Quarter Q => Q, its started months, containing half, year.
 * Half/year => itself plus every nested period (quarters, months, and for a
 * year also halves) that has started. Month => the month, its quarter, half,
 * and year (the spec doesn't define month views; this is the natural superset).
 * "Started" means start <= todayStr. The viewed period itself is always included.
 */
export function expandViewedPeriod(view: ViewedPeriod, todayStr: string): FrequencyPeriod[] {
  const y = view.year;
  const started = (p: FrequencyPeriod) => p.start <= todayStr;
  const months = tag('Monthly', computePeriods(y, 'Monthly'));
  const quarters = tag('Quarterly', computePeriods(y, 'Quarterly'));
  const halves = tag('6 months', computePeriods(y, '6 months'));
  const [annual] = tag('Annual', computePeriods(y, 'Annual'));
  const inRange = (p: Period, lo: string, hi: string) => p.start >= lo && p.end <= hi;

  switch (view.kind) {
    case 'year':
      return [annual, ...halves.filter(started), ...quarters.filter(started), ...months.filter(started)];
    case 'half': {
      const self = halves[view.half - 1];
      if (!self) throw new Error(`Invalid half: ${view.half}`);
      return [
        self,
        ...quarters.filter((p) => inRange(p, self.start, self.end) && started(p)),
        ...months.filter((p) => inRange(p, self.start, self.end) && started(p)),
      ];
    }
    case 'quarter': {
      const self = quarters[view.quarter - 1];
      if (!self) throw new Error(`Invalid quarter: ${view.quarter}`);
      return [
        self,
        ...months.filter((p) => inRange(p, self.start, self.end) && started(p)),
        halves.find((h) => inRange(self, h.start, h.end))!,
        annual,
      ];
    }
    case 'month': {
      const self = months[view.month - 1];
      if (!self) throw new Error(`Invalid month: ${view.month}`);
      return [
        self,
        quarters.find((q) => inRange(self, q.start, q.end))!,
        halves.find((h) => inRange(self, h.start, h.end))!,
        annual,
      ];
    }
  }
}

/** Bounding rule: keep a period only if end >= trackingFrom AND start <= today. */
export function boundPeriods<T extends Period>(
  periods: T[],
  trackingFrom: string,
  todayStr: string,
): T[] {
  return periods.filter((p) => p.end >= trackingFrom && p.start <= todayStr);
}
