import { describe, expect, it } from 'vitest';
import { boundPeriods, computePeriods, expandViewedPeriod, today } from './periods';

const labels = (ps: { label: string }[]) => ps.map((p) => p.label);

describe('today()', () => {
  it('uses IST, not UTC, across the midnight boundary', () => {
    expect(today(new Date('2026-09-30T18:29:59Z'))).toBe('2026-09-30');
    expect(today(new Date('2026-09-30T18:30:00Z'))).toBe('2026-10-01');
    expect(today(new Date('2026-09-30T19:00:00Z'))).toBe('2026-10-01');
  });
  it('rolls the year at IST midnight', () => {
    expect(today(new Date('2026-12-31T19:00:00Z'))).toBe('2027-01-01');
  });
  it('defaults to the real clock with a valid format', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('computePeriods', () => {
  it('Quarterly', () => {
    expect(computePeriods(2026, 'Quarterly')).toEqual([
      { start: '2026-01-01', end: '2026-03-31', label: '2026-Q1' },
      { start: '2026-04-01', end: '2026-06-30', label: '2026-Q2' },
      { start: '2026-07-01', end: '2026-09-30', label: '2026-Q3' },
      { start: '2026-10-01', end: '2026-12-31', label: '2026-Q4' },
    ]);
  });
  it('Annual', () => {
    expect(computePeriods(2026, 'Annual')).toEqual([
      { start: '2026-01-01', end: '2026-12-31', label: '2026' },
    ]);
  });
  it('6 months', () => {
    expect(computePeriods(2026, '6 months')).toEqual([
      { start: '2026-01-01', end: '2026-06-30', label: '2026-H1' },
      { start: '2026-07-01', end: '2026-12-31', label: '2026-H2' },
    ]);
  });
  it('Monthly: 12 periods, correct month ends', () => {
    const m = computePeriods(2026, 'Monthly');
    expect(m).toHaveLength(12);
    expect(m[6]).toEqual({ start: '2026-07-01', end: '2026-07-31', label: '2026-07' });
    expect(m[8].end).toBe('2026-09-30');
    expect(m[1].end).toBe('2026-02-28');
  });
  it('handles leap-year February', () => {
    expect(computePeriods(2028, 'Monthly')[1].end).toBe('2028-02-29');
    expect(computePeriods(2100, 'Monthly')[1].end).toBe('2100-02-28');
    expect(computePeriods(2000, 'Monthly')[1].end).toBe('2000-02-29');
  });
  it('periods are contiguous and cover the year', () => {
    for (const f of ['Quarterly', 'Annual', '6 months', 'Monthly'] as const) {
      const ps = computePeriods(2028, f);
      expect(ps[0].start).toBe('2028-01-01');
      expect(ps[ps.length - 1].end).toBe('2028-12-31');
    }
  });
});

describe('expandViewedPeriod', () => {
  it('quarter: itself, started months, half, year', () => {
    const r = expandViewedPeriod({ kind: 'quarter', year: 2026, quarter: 3 }, '2026-08-15');
    expect(labels(r)).toEqual(['2026-Q3', '2026-07', '2026-08', '2026-H2', '2026']);
  });
  it('quarter: future months excluded, Q still included', () => {
    const r = expandViewedPeriod({ kind: 'quarter', year: 2026, quarter: 4 }, '2026-10-09');
    expect(labels(r)).toEqual(['2026-Q4', '2026-10', '2026-H2', '2026']);
  });
  it('year: all started nested periods plus itself', () => {
    const r = expandViewedPeriod({ kind: 'year', year: 2026 }, '2026-05-10');
    expect(labels(r)).toEqual([
      '2026', '2026-H1', '2026-Q1', '2026-Q2',
      '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
    ]);
  });
  it('half: itself plus started quarters and months within it', () => {
    const r = expandViewedPeriod({ kind: 'half', year: 2026, half: 2 }, '2026-10-09');
    expect(labels(r)).toEqual(['2026-H2', '2026-Q3', '2026-Q4', '2026-07', '2026-08', '2026-09', '2026-10']);
  });
  it('month: month, quarter, half, year', () => {
    const r = expandViewedPeriod({ kind: 'month', year: 2026, month: 2 }, '2026-09-01');
    expect(labels(r)).toEqual(['2026-02', '2026-Q1', '2026-H1', '2026']);
  });
  it('tags each period with its frequency', () => {
    const r = expandViewedPeriod({ kind: 'quarter', year: 2026, quarter: 1 }, '2026-01-15');
    expect(r.map((p) => p.frequency)).toEqual(['Quarterly', 'Monthly', '6 months', 'Annual']);
  });
});

describe('boundPeriods', () => {
  const t = '2026-10-09';
  it('card tracked from mid-February still gets that year annual and Q1', () => {
    const view = expandViewedPeriod({ kind: 'year', year: 2026 }, t);
    const kept = labels(boundPeriods(view, '2026-02-15', t));
    expect(kept).toContain('2026');
    expect(kept).toContain('2026-Q1');
    expect(kept).toContain('2026-H1');
    expect(kept).toContain('2026-02');
    expect(kept).toContain('2026-03');
    expect(kept).not.toContain('2026-01');
  });
  it('excludes periods ending before trackingFrom (boundary inclusive)', () => {
    const ps = computePeriods(2026, 'Monthly');
    expect(boundPeriods(ps, '2026-02-28', '2026-12-31')[0].label).toBe('2026-02');
    expect(boundPeriods(ps, '2026-03-01', '2026-12-31')[0].label).toBe('2026-03');
  });
  it('excludes periods starting after today (boundary inclusive)', () => {
    const ps = computePeriods(2026, 'Quarterly');
    expect(labels(boundPeriods(ps, '2026-01-01', '2026-10-01'))).toEqual([
      '2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4',
    ]);
    expect(labels(boundPeriods(ps, '2026-01-01', '2026-09-30'))).toEqual([
      '2026-Q1', '2026-Q2', '2026-Q3',
    ]);
  });
});
