export interface SearchEmptyCopy {
  title: string;
  description: string;
  suggestionText?: string;
  bannerTitle?: string;
  bannerDetail?: string;
  primaryActionLabel: string;
}

/**
 * Derives user-facing text and suggestions when a search yields 0 items.
 */
export function getSearchEmptyCopy({
  query,
  allCount = 0,
  isAll = false,
}: {
  query: string;
  allCount?: number;
  isAll?: boolean;
}): SearchEmptyCopy {
  if (isAll) {
    return {
      title: 'No matches found across everything',
      description: `No benefits matched “${query}” across any period, card, or offer type.`,
      suggestionText: 'Try checking for typos, using broader keywords, or switching back to current filters.',
      primaryActionLabel: 'Switch back to current filters',
    };
  }

  if (allCount > 0) {
    return {
      title: 'No matches in current filters',
      description: `No benefits matched “${query}” within your current filter or period.`,
      bannerTitle: `Found ${allCount} matching ${allCount === 1 ? 'benefit' : 'benefits'} across everything`,
      bannerDetail: 'Matching perks exist in other entitlement periods, cards, or offer categories.',
      primaryActionLabel: `Search across everything (${allCount})`,
    };
  }

  return {
    title: 'No matches found',
    description: `No benefits matched “${query}” in the current filter or period.`,
    suggestionText:
      'You are currently searching within active filters. Try searching across everything to check all periods, cards, and voucher types.',
    primaryActionLabel: 'Search across everything',
  };
}

/**
 * Builds the URL search parameters string for switching search scope between 'all' and 'current'.
 */
export function buildSearchScopeParams(
  currentParams: string,
  targetScope: 'all' | 'current',
  query?: string,
): string {
  const p = new URLSearchParams(currentParams);
  if (targetScope === 'all') {
    p.set('search_scope', 'all');
  } else {
    p.delete('search_scope');
  }
  if (query) {
    p.set('q', query);
  }
  return p.toString();
}

/**
 * Clears active refinement filters (holder, card, category, status, etc.) while preserving search query and period.
 */
export function buildClearFiltersParams(currentParams: string): string {
  const p = new URLSearchParams(currentParams);
  const keysToRemove = [
    'holder',
    'card',
    'account',
    'portal_account',
    'category',
    'benefit',
    'status',
    'discounts',
    'lapsed',
    'group',
  ];
  for (const k of keysToRemove) {
    p.delete(k);
  }
  return p.toString();
}

/**
 * Clears search query and scope while preserving other active filters.
 */
export function buildClearSearchParams(currentParams: string): string {
  const p = new URLSearchParams(currentParams);
  p.delete('q');
  p.delete('search_scope');
  return p.toString();
}
