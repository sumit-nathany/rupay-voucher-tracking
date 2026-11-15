import { describe, expect, it } from 'vitest';
import {
  buildClearFiltersParams,
  buildClearSearchParams,
  buildSearchScopeParams,
  getSearchEmptyCopy,
} from './search-helper';

describe('search-helper', () => {
  describe('getSearchEmptyCopy', () => {
    it('returns cross-everything discovery copy when allCount > 0 and not isAll', () => {
      const copy = getSearchEmptyCopy({
        query: 'Swiggy',
        allCount: 3,
        isAll: false,
      });

      expect(copy.title).toBe('No matches in current filters');
      expect(copy.description).toContain('Swiggy');
      expect(copy.bannerTitle).toBe('Found 3 matching benefits across everything');
      expect(copy.bannerDetail).toBeDefined();
      expect(copy.primaryActionLabel).toBe('Search across everything (3)');
    });

    it('handles singular benefit match when allCount is 1', () => {
      const copy = getSearchEmptyCopy({
        query: 'Amazon',
        allCount: 1,
        isAll: false,
      });

      expect(copy.bannerTitle).toBe('Found 1 matching benefit across everything');
      expect(copy.primaryActionLabel).toBe('Search across everything (1)');
    });

    it('suggests searching across everything when no matches found and not isAll', () => {
      const copy = getSearchEmptyCopy({
        query: 'unknown123',
        allCount: 0,
        isAll: false,
      });

      expect(copy.title).toBe('No matches found');
      expect(copy.description).toContain('unknown123');
      expect(copy.suggestionText).toContain('Try searching across everything');
      expect(copy.primaryActionLabel).toBe('Search across everything');
    });

    it('returns comprehensive empty message when isAll is true', () => {
      const copy = getSearchEmptyCopy({
        query: 'xyz',
        allCount: 0,
        isAll: true,
      });

      expect(copy.title).toBe('No matches found across everything');
      expect(copy.description).toContain('xyz');
      expect(copy.primaryActionLabel).toBe('Switch back to current filters');
    });
  });

  describe('buildSearchScopeParams', () => {
    it('sets search_scope=all while preserving existing parameters and query', () => {
      const initial = 'holder=123&q=zomato';
      const updated = buildSearchScopeParams(initial, 'all', 'zomato');
      const sp = new URLSearchParams(updated);

      expect(sp.get('search_scope')).toBe('all');
      expect(sp.get('q')).toBe('zomato');
      expect(sp.get('holder')).toBe('123');
    });

    it('removes search_scope when switching back to current', () => {
      const initial = 'holder=123&q=zomato&search_scope=all';
      const updated = buildSearchScopeParams(initial, 'current');
      const sp = new URLSearchParams(updated);

      expect(sp.has('search_scope')).toBe(false);
      expect(sp.get('q')).toBe('zomato');
      expect(sp.get('holder')).toBe('123');
    });
  });

  describe('buildClearFiltersParams', () => {
    it('removes refine filters but preserves search query and view', () => {
      const initial = 'view=2026-Q1&q=zomato&holder=h1&card=c1&status=Not+Ordered&category=Dining';
      const cleared = buildClearFiltersParams(initial);
      const sp = new URLSearchParams(cleared);

      expect(sp.get('q')).toBe('zomato');
      expect(sp.get('view')).toBe('2026-Q1');
      expect(sp.has('holder')).toBe(false);
      expect(sp.has('card')).toBe(false);
      expect(sp.has('status')).toBe(false);
      expect(sp.has('category')).toBe(false);
    });
  });

  describe('buildClearSearchParams', () => {
    it('removes q and search_scope but keeps all other filters', () => {
      const initial = 'q=test&search_scope=all&status=Ordered&holder=h1';
      const cleared = buildClearSearchParams(initial);
      const sp = new URLSearchParams(cleared);

      expect(sp.has('q')).toBe(false);
      expect(sp.has('search_scope')).toBe(false);
      expect(sp.get('status')).toBe('Ordered');
      expect(sp.get('holder')).toBe('h1');
    });
  });
});
