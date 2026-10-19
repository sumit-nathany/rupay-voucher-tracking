import { describe, expect, it } from 'vitest';
import {
  ALL_COLUMNS,
  BASE_DEFAULT_COLUMNS,
  getDefaultColumnsForContext,
  parseColumnsParam,
  resolveContextKey,
  serializeColumns,
} from './columns';

describe('Benefit table columns configuration', () => {
  it('defines BASE_DEFAULT_COLUMNS matching the currently available columns', () => {
    expect(BASE_DEFAULT_COLUMNS).toEqual(['category', 'benefit', 'card', 'value', 'status']);
    // Verify each base column is in ALL_COLUMNS
    const allIds = ALL_COLUMNS.map((c) => c.id);
    for (const id of BASE_DEFAULT_COLUMNS) {
      expect(allIds).toContain(id);
    }
  });

  describe('Contextual default columns', () => {
    it('includes RuPay Tag ID (rupayBookingId) by default when viewing Ordered benefits', () => {
      const cols = getDefaultColumnsForContext({ status: 'Ordered' });
      expect(cols).toContain('rupayBookingId');
      expect(cols).toEqual([
        'category',
        'benefit',
        'card',
        'rupayBookingId',
        'orderDate',
        'value',
        'status',
      ]);
    });

    it('includes RuPay Tag ID and Expiry Date when viewing Coupon Received benefits', () => {
      const cols = getDefaultColumnsForContext({ status: 'Coupon Received' });
      expect(cols).toContain('rupayBookingId');
      expect(cols).toContain('expiryDate');
    });

    it('includes Deadline when viewing Not Ordered benefits', () => {
      const cols = getDefaultColumnsForContext({ status: 'Not Ordered' });
      expect(cols).toContain('deadline');
    });

    it('includes Period by default in lifetime scope', () => {
      const cols = getDefaultColumnsForContext({ lifetime: true });
      expect(cols).toContain('period');
    });

    it('includes Period by default when searchScope is all', () => {
      const cols = getDefaultColumnsForContext({ searchScope: 'all' });
      expect(cols).toContain('period');
    });

    it('includes RuPay Tag ID when filtering by a specific RuPay account', () => {
      const cols = getDefaultColumnsForContext({
        portalAccountId: '3c1bf3ee-1b07-42f3-a75b-59d4c7b80a6d',
      });
      expect(cols).toContain('rupayBookingId');
    });

    it('falls back to BASE_DEFAULT_COLUMNS in standard/unfiltered views', () => {
      const cols = getDefaultColumnsForContext({});
      expect(cols).toEqual(BASE_DEFAULT_COLUMNS);
    });
  });

  describe('Context key resolution', () => {
    it('maps ordered status to ordered context', () => {
      expect(resolveContextKey({ status: 'Ordered' })).toBe('ordered');
    });

    it('maps lifetime to lifetime context', () => {
      expect(resolveContextKey({ lifetime: true })).toBe('lifetime');
    });

    it('maps empty context to default', () => {
      expect(resolveContextKey({})).toBe('default');
    });
  });

  describe('URL param parsing and serialization', () => {
    it('parses valid comma-separated columns', () => {
      const res = parseColumnsParam('category,rupayBookingId,value');
      expect(res).toEqual(['category', 'rupayBookingId', 'value']);
    });

    it('filters out invalid or malicious column identifiers', () => {
      const res = parseColumnsParam('category,invalidColumn,status,anotherBadOne');
      expect(res).toEqual(['category', 'status']);
    });

    it('returns null for null, empty or entirely invalid params', () => {
      expect(parseColumnsParam(null)).toBeNull();
      expect(parseColumnsParam('')).toBeNull();
      expect(parseColumnsParam('foo,bar')).toBeNull();
    });

    it('serializes columns to comma-separated string', () => {
      expect(serializeColumns(['category', 'card', 'value'])).toBe('category,card,value');
    });
  });
});
