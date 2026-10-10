import { describe, expect, it } from 'vitest';
import { defaultView, isLifetimeScope, parseView, viewLabel, viewToParams } from './view-params';

describe('defaultView', () => {
  it('defaults to the calendar quarter containing today', () => {
    expect(defaultView('2026-07-10')).toEqual({ kind: 'quarter', year: 2026, quarter: 3 });
    expect(defaultView('2026-10-05')).toEqual({ kind: 'quarter', year: 2026, quarter: 4 });
  });
});

describe('parseView', () => {
  it('falls back to the current quarter when params are missing', () => {
    expect(parseView({}, '2026-07-10')).toEqual({ kind: 'quarter', year: 2026, quarter: 3 });
  });

  it('parses year-only URLs', () => {
    expect(parseView({ v: 'year', y: '2025' }, '2026-07-10')).toEqual({ kind: 'year', year: 2025 });
    expect(viewToParams({ kind: 'year', year: 2025 })).toEqual({ v: 'year', y: '2025' });
  });

  it('parses quarter and month URLs', () => {
    expect(parseView({ v: 'quarter', y: '2026', n: '3' }, '2026-07-10')).toEqual({
      kind: 'quarter',
      year: 2026,
      quarter: 3,
    });
    expect(parseView({ v: 'month', y: '2026', n: '8' }, '2026-07-10')).toEqual({
      kind: 'month',
      year: 2026,
      month: 8,
    });
  });

  it('still supports half-year URLs', () => {
    expect(parseView({ v: 'half', y: '2026', n: '2' }, '2026-07-10')).toEqual({
      kind: 'half',
      year: 2026,
      half: 2,
    });
  });
});

describe('isLifetimeScope', () => {
  it('is true only for lifetime=1', () => {
    expect(isLifetimeScope({})).toBe(false);
    expect(isLifetimeScope({ lifetime: '1' })).toBe(true);
    expect(isLifetimeScope({ lifetime: '0' })).toBe(false);
  });
});

describe('viewLabel', () => {
  it('labels year, quarter, and month views', () => {
    expect(viewLabel({ kind: 'year', year: 2026 })).toBe('2026');
    expect(viewLabel({ kind: 'quarter', year: 2026, quarter: 3 })).toBe('2026 Q3');
    expect(viewLabel({ kind: 'month', year: 2026, month: 8 })).toBe('Aug 2026');
  });
});
