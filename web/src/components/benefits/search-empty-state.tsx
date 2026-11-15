'use client';

import { useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { Search, Globe, Sparkles, RotateCcw, X, FilterX, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBenefitsLoading } from './benefits-loading-provider';
import {
  buildClearFiltersParams,
  buildClearSearchParams,
  buildSearchScopeParams,
  getSearchEmptyCopy,
} from './search-helper';

export function SearchEmptyState({
  query,
  allCount = 0,
  hasOtherFilters = false,
  isAll = false,
}: {
  query: string;
  allCount?: number;
  hasOtherFilters?: boolean;
  isAll?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { startTransition: loadingStart, isPending: isGlobalPending } = useBenefitsLoading();
  const [isLocalPending, localStart] = useTransition();
  const start = loadingStart || localStart;
  const isPending = isGlobalPending || isLocalPending;

  const copy = getSearchEmptyCopy({
    query,
    allCount,
    isAll,
  });

  function handleSearchAcrossEverything() {
    const updated = buildSearchScopeParams(sp.toString(), 'all', query);
    start(() => {
      router.push(`${pathname}?${updated}`);
    });
  }

  function handleSwitchBackToCurrent() {
    const updated = buildSearchScopeParams(sp.toString(), 'current');
    start(() => {
      router.push(`${pathname}?${updated}`);
    });
  }

  function handleClearFilters() {
    const updated = buildClearFiltersParams(sp.toString());
    start(() => {
      router.push(`${pathname}?${updated}`);
    });
  }

  function handleClearSearch() {
    const updated = buildClearSearchParams(sp.toString());
    start(() => {
      router.push(`${pathname}?${updated}`);
    });
  }

  if (isAll) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/25 px-6 py-14 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground mb-4">
          <Search className="h-6 w-6" aria-hidden />
        </div>

        <p className="font-semibold tracking-tight text-xl text-foreground">
          {copy.title}
        </p>

        <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
          {copy.description}
        </p>

        {copy.suggestionText && (
          <p className="mt-2 max-w-md text-xs text-muted-foreground">
            {copy.suggestionText}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={handleSwitchBackToCurrent}
            className="gap-2"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4" aria-hidden />
            )}
            {copy.primaryActionLabel}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={handleClearSearch}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
            Clear search
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/25 px-6 py-14 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
        {allCount > 0 ? (
          <Sparkles className="h-6 w-6" aria-hidden />
        ) : (
          <Search className="h-6 w-6" aria-hidden />
        )}
      </div>

      <p className="font-semibold tracking-tight text-xl text-foreground">
        {copy.title}
      </p>

      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {copy.description}
      </p>

      {/* Suggestion / Discovery Banner */}
      {allCount > 0 && copy.bannerTitle ? (
        <div className="mt-4 flex max-w-lg items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3.5 text-left text-sm text-foreground shadow-xs">
          <Globe className="h-5 w-5 text-primary shrink-0" aria-hidden />
          <div className="flex-1">
            <p className="font-medium text-foreground">
              {copy.bannerTitle}
            </p>
            {copy.bannerDetail && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {copy.bannerDetail}
              </p>
            )}
          </div>
        </div>
      ) : copy.suggestionText ? (
        <div className="mt-4 max-w-md rounded-xl border border-border/80 bg-background/50 p-3 text-center text-xs text-muted-foreground">
          {copy.suggestionText}
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button
          type="button"
          variant={allCount > 0 ? 'default' : 'outline'}
          disabled={isPending}
          onClick={handleSearchAcrossEverything}
          className="gap-2 shadow-xs"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Globe className="h-4 w-4" aria-hidden />
          )}
          {copy.primaryActionLabel}
        </Button>

        {hasOtherFilters && (
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={handleClearFilters}
            className="gap-1.5"
          >
            <FilterX className="h-4 w-4" aria-hidden />
            Clear active filters
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          disabled={isPending}
          onClick={handleClearSearch}
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden />
          Clear search
        </Button>
      </div>
    </div>
  );
}
