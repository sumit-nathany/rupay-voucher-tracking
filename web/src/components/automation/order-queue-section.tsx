'use client';

import { useState, useTransition, useMemo, useEffect } from 'react';
import {
  Calendar,
  CreditCard,
  AlertTriangle,
  ListOrdered,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  ArrowUpToLine,
  KeyRound,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertCircle,
  X,
  ArrowUpDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { QueueItemView } from '@/domain/ordering-queue';
import type { PortalAccountView } from '@/domain/automation';
import type { CardOption } from './mapping-dialogs';
import {
  populateAndSortQueueAction,
  updateQueueItemAction,
  reorderQueueAction,
  moveQueueItemToTopAction,
  listOrderingQueueAction,
} from '@/actions/automation';

const DEFAULT_PAGE_SIZE = 5;

interface OrderQueueSectionProps {
  initialQueue: QueueItemView[];
  accounts?: PortalAccountView[];
  cards?: CardOption[];
}

export function OrderQueueSection({
  initialQueue,
  accounts = [],
  cards = [],
}: OrderQueueSectionProps) {
  const [items, setItems] = useState<QueueItemView[]>(initialQueue);

  // Compile unique cards from queue items and available cards
  const cardSummaries = useMemo(() => {
    const cardMap = new Map<
      string,
      {
        id: string;
        name: string;
        last4: string;
        holderName: string;
        count: number;
        totalCashValue: number;
      }
    >();

    for (const item of items) {
      const existing = cardMap.get(item.cardId);
      if (existing) {
        existing.count += 1;
        existing.totalCashValue += item.cashValue;
      } else {
        cardMap.set(item.cardId, {
          id: item.cardId,
          name: item.cardName,
          last4: item.cardLast4,
          holderName: item.holderName,
          count: 1,
          totalCashValue: item.cashValue,
        });
      }
    }

    // Also include registered cards with 0 pending vouchers so user can inspect them
    for (const c of cards) {
      if (!cardMap.has(c.id)) {
        cardMap.set(c.id, {
          id: c.id,
          name: c.name,
          last4: c.lastDigits ?? '••••',
          holderName: c.holderName,
          count: 0,
          totalCashValue: 0,
        });
      }
    }

    return Array.from(cardMap.values());
  }, [items, cards]);

  // Default view is on a card basis: select the first card with benefits, or 'all'
  const [selectedCardId, setSelectedCardId] = useState<string>(() => {
    const firstWithBenefits = cardSummaries.find((c) => c.count > 0);
    return firstWithBenefits?.id ?? cardSummaries[0]?.id ?? 'all';
  });

  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState<number>(DEFAULT_PAGE_SIZE);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setItems(initialQueue);
  }, [initialQueue]);

  useEffect(() => {
    setVisibleCount(DEFAULT_PAGE_SIZE);
  }, [selectedCardId, selectedAccountId]);

  // If selected card is no longer valid, fallback to first available card with benefits
  useEffect(() => {
    if (selectedCardId !== 'all' && !cardSummaries.some((c) => c.id === selectedCardId)) {
      const firstWithBenefits = cardSummaries.find((c) => c.count > 0);
      setSelectedCardId(firstWithBenefits?.id ?? 'all');
    }
  }, [cardSummaries, selectedCardId]);

  // Filter items based on selected Card (primary) and RuPay account (secondary)
  const displayedItems = useMemo(() => {
    let result = items;
    if (selectedCardId !== 'all') {
      result = result.filter((i) => i.cardId === selectedCardId);
    }
    if (selectedAccountId !== 'all') {
      result = result.filter(
        (i) =>
          i.portalAccountId === selectedAccountId ||
          i.portalAccounts.some((a) => a.id === selectedAccountId),
      );
    }
    return result;
  }, [items, selectedCardId, selectedAccountId]);

  const activeCardSummary = useMemo(() => {
    if (selectedCardId === 'all') return null;
    return cardSummaries.find((c) => c.id === selectedCardId) ?? null;
  }, [cardSummaries, selectedCardId]);

  const visibleItems = useMemo(() => {
    return displayedItems.slice(0, visibleCount);
  }, [displayedItems, visibleCount]);

  const handleRefresh = () => {
    startTransition(async () => {
      try {
        const fresh = await listOrderingQueueAction();
        setItems(fresh);
      } catch (err) {
        console.error('Failed to refresh queue:', err);
      }
    });
  };

  const handleAutoSort = (strategy: 'nearest_expiring' | 'highest_value') => {
    startTransition(async () => {
      try {
        // Auto-sort operates on the global queue so rank ordering remains clean
        await populateAndSortQueueAction({ strategy });
        const fresh = await listOrderingQueueAction();
        setItems(fresh);
      } catch (err) {
        console.error('Failed to sort queue:', err);
      }
    });
  };

  const handleMoveToTop = (instanceId: string) => {
    const target = items.find((i) => i.instanceId === instanceId);
    if (!target || target.position === 1) return;

    // Optimistically promote target to index 0 of global list
    const others = items.filter((i) => i.instanceId !== instanceId);
    const nextAll = [target, ...others].map((item, i) => ({
      ...item,
      position: i + 1,
    }));

    setItems(nextAll);

    startTransition(async () => {
      try {
        await moveQueueItemToTopAction({ instanceId });
      } catch (err) {
        console.error('Failed to move item to top:', err);
        setItems(initialQueue);
      }
    });
  };

  const handleMove = (instanceId: string, direction: 'up' | 'down') => {
    const dispIdx = displayedItems.findIndex((i) => i.instanceId === instanceId);
    if (dispIdx === -1) return;

    const targetDispIdx = direction === 'up' ? dispIdx - 1 : dispIdx + 1;
    if (targetDispIdx < 0 || targetDispIdx >= displayedItems.length) return;

    // Expand visibleCount if moving an item down past current visible threshold so it stays in view
    if (targetDispIdx >= visibleCount) {
      setVisibleCount(targetDispIdx + 1);
    }

    const currentItem = displayedItems[dispIdx];
    const targetItem = displayedItems[targetDispIdx];

    // Reorder within the full global array
    const globalWithoutCurrent = items.filter((i) => i.instanceId !== currentItem.instanceId);
    const targetGlobalIdx = globalWithoutCurrent.findIndex((i) => i.instanceId === targetItem.instanceId);
    if (targetGlobalIdx === -1) return;

    const insertIdx = direction === 'up' ? targetGlobalIdx : targetGlobalIdx + 1;
    const nextAllRaw = [...globalWithoutCurrent];
    nextAllRaw.splice(insertIdx, 0, currentItem);

    const nextAll = nextAllRaw.map((item, i) => ({
      ...item,
      position: i + 1,
    }));

    setItems(nextAll);

    startTransition(async () => {
      try {
        await reorderQueueAction({
          orderedInstanceIds: nextAll.map((d) => d.instanceId),
        });
      } catch (err) {
        console.error('Failed to reorder queue:', err);
        setItems(initialQueue);
      }
    });
  };

  const handleToggleEnabled = (instanceId: string, enabled: boolean) => {
    setItems((prev) =>
      prev.map((i) => (i.instanceId === instanceId ? { ...i, enabled } : i)),
    );

    startTransition(async () => {
      try {
        await updateQueueItemAction({ instanceId, enabled });
      } catch {
        setItems(initialQueue);
      }
    });
  };

  const handleSelectOption = (instanceId: string, chosenOptionId: string) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.instanceId !== instanceId) return i;
        const opt = i.availableOptions.find((o) => o.id === chosenOptionId);
        return {
          ...i,
          chosenOptionId,
          chosenOptionName: opt ? `${opt.provider} - ${opt.offerName}` : i.chosenOptionName,
        };
      }),
    );

    startTransition(async () => {
      try {
        await updateQueueItemAction({ instanceId, chosenOptionId });
      } catch {
        setItems(initialQueue);
      }
    });
  };

  const handleSelectAccount = (instanceId: string, portalAccountId: string | null) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.instanceId !== instanceId) return i;
        const matched = i.portalAccounts.find((a) => a.id === portalAccountId);
        const suggested = i.suggestedAccounts.find((a) => a.accountId === portalAccountId);
        const nextSuggested = i.suggestedAccounts.map((s) => ({
          ...s,
          isChosen: Boolean(portalAccountId && s.accountId === portalAccountId),
        }));
        return {
          ...i,
          portalAccountId,
          portalAccountLabel: matched?.label ?? suggested?.accountLabel ?? null,
          chosenPortalAccountId: portalAccountId,
          suggestedAccounts: nextSuggested,
        };
      }),
    );

    startTransition(async () => {
      try {
        await updateQueueItemAction({ instanceId, portalAccountId });
      } catch (err) {
        console.error('Failed to update queue item account:', err);
        setItems(initialQueue);
      }
    });
  };

  const totalValue = displayedItems
    .filter((i) => i.enabled)
    .reduce((sum, i) => sum + i.cashValue, 0);

  return (
    <div className="space-y-5">
      {/* 1. Header: Section title, description & stats */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Order Queue
            </h2>
            <Badge variant="secondary" className="text-xs font-semibold px-2 py-0.5">
              {displayedItems.length} {displayedItems.length === 1 ? 'voucher' : 'vouchers'}
            </Badge>
            {totalValue > 0 && (
              <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold px-2 py-0.5">
                ₹{Math.round(totalValue)} queued
              </Badge>
            )}
          </div>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed max-w-2xl">
            The worker orders these vouchers top-to-bottom, one per account every 24h. Reorder, skip, or pick a benefit option.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isPending}
          className="h-8 px-2.5 text-xs font-medium gap-1.5 rounded-lg border-border/80 self-start shrink-0 cursor-pointer hover:bg-accent"
          title="Refresh Queue"
        >
          <RefreshCw className={cn('h-3.5 w-3.5 text-muted-foreground', isPending && 'animate-spin')} />
          <span>Refresh</span>
        </Button>
      </div>

      {/* 2. Dedicated Filter & Sort Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-2 sm:p-2.5 rounded-xl border border-border/70 bg-muted/30">
        {/* Left: Filters */}
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          {/* Card Filter */}
          <Select
            value={selectedCardId}
            onValueChange={setSelectedCardId}
            disabled={isPending}
          >
            <SelectTrigger
              className={cn(
                'h-8 text-xs font-medium rounded-lg gap-2 border-border/80 bg-background shadow-2xs hover:bg-accent/50 cursor-pointer',
                selectedCardId !== 'all'
                  ? 'border-primary/50 bg-primary/5 text-primary font-semibold'
                  : 'text-foreground'
              )}
            >
              <CreditCard className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <SelectValue placeholder="All Cards" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all" className="text-xs">
                All Cards ({items.length})
              </SelectItem>
              {cardSummaries.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">
                  {c.name} ••{c.last4} · {c.holderName} ({c.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Account Filter */}
          <Select
            value={selectedAccountId}
            onValueChange={setSelectedAccountId}
            disabled={isPending}
          >
            <SelectTrigger
              className={cn(
                'h-8 text-xs font-medium rounded-lg gap-2 border-border/80 bg-background shadow-2xs hover:bg-accent/50 cursor-pointer',
                selectedAccountId !== 'all'
                  ? 'border-primary/50 bg-primary/5 text-primary font-semibold'
                  : 'text-foreground'
              )}
            >
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <SelectValue placeholder="All Accounts" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all" className="text-xs">
                All Accounts
              </SelectItem>
              {accounts.map((acc) => {
                const count = items.filter(
                  (i) =>
                    i.portalAccountId === acc.id ||
                    i.portalAccounts.some((a) => a.id === acc.id),
                ).length;
                return (
                  <SelectItem key={acc.id} value={acc.id} className="text-xs">
                    {acc.label} ({count})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          {/* Reset Filters (when any filter is active) */}
          {(selectedCardId !== 'all' || selectedAccountId !== 'all') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedCardId('all');
                setSelectedAccountId('all');
              }}
              className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground gap-1 rounded-lg cursor-pointer"
              title="Clear all active filters"
            >
              <X className="h-3 w-3" />
              <span>Clear filters</span>
            </Button>
          )}
        </div>

        {/* Right: Sort */}
        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <Select
            defaultValue="nearest_expiring"
            onValueChange={(v) => handleAutoSort(v as 'nearest_expiring' | 'highest_value')}
            disabled={isPending}
          >
            <SelectTrigger className="h-8 min-w-[175px] text-xs font-medium rounded-lg gap-2 border-border/80 bg-background shadow-2xs hover:bg-accent/50 cursor-pointer">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <SelectValue placeholder="Sort..." />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="nearest_expiring" className="text-xs">
                Nearest Expiry First
              </SelectItem>
              <SelectItem value="highest_value" className="text-xs">
                Highest Value First
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Queue Items List */}
      {displayedItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-12 text-center bg-muted/10">
          <ListOrdered className="h-10 w-10 text-muted-foreground/60 mb-3" />
          <p className="text-base font-semibold text-foreground">No Vouchers In This Queue</p>
          <p className="text-sm text-muted-foreground max-w-md mt-1.5">
            {selectedCardId !== 'all'
              ? `No pending voucher benefits found for ${activeCardSummary?.name ?? 'this card'}.`
              : selectedAccountId === 'all'
              ? 'No pending voucher benefits found in this workspace.'
              : 'No voucher benefits found for cards linked to this RuPay account.'}
          </p>
          <div className="flex items-center gap-2 mt-4 flex-wrap justify-center">
            {selectedCardId !== 'all' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedCardId('all')}
                className="gap-2 text-xs sm:text-sm font-medium rounded-xl"
              >
                <CreditCard className="h-4 w-4" />
                View All Cards
              </Button>
            )}
            <Button
              onClick={() => handleAutoSort('nearest_expiring')}
              disabled={isPending}
              className="gap-2 text-xs sm:text-sm font-medium rounded-xl"
            >
              <RefreshCw className="h-4 w-4" />
              Check & Auto-Sort Queue
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleItems.map((item, index) => {
            const isFirstInDisplay = index === 0;
            const isLastInDisplay = index === displayedItems.length - 1;
            const isGlobalFirst = item.position === 1;
            const isUrgent = item.daysRemaining <= 7;
            const hasOptions = item.availableOptions.length > 0;
            const optionNeeded = hasOptions && !item.chosenOptionId;

            // Mapped accounts for this card
            const mappedAccounts = (item.suggestedAccounts || []).filter((a) => a.isMapped);

            // Active/selected redemption account
            const activeAccount = item.chosenPortalAccountId
              ? item.suggestedAccounts?.find((a) => a.accountId === item.chosenPortalAccountId)
              : item.suggestedAccounts?.find((a) => a.isRecommended) ||
                mappedAccounts.find((a) => a.isEligible) ||
                mappedAccounts[0] ||
                null;

            // Status badge for the active redemption account
            let activeStatusBadge = null;
            if (!activeAccount) {
              activeStatusBadge = (
                <Badge
                  variant="outline"
                  className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1 text-xs font-medium"
                >
                  <AlertTriangle className="h-3 w-3" /> No account mapped
                </Badge>
              );
            } else if (activeAccount.status === 'ready') {
              activeStatusBadge = (
                <Badge
                  variant="outline"
                  className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 gap-1 text-xs font-medium"
                >
                  <CheckCircle2 className="h-3 w-3" /> Ready
                </Badge>
              );
            } else if (activeAccount.status === 'cooldown') {
              activeStatusBadge = (
                <Badge
                  variant="outline"
                  className="border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400 gap-1 text-xs font-medium"
                >
                  <Clock className="h-3 w-3" /> 24h Cooldown
                </Badge>
              );
            } else if (activeAccount.status === 'conflict') {
              activeStatusBadge = (
                <Badge
                  variant="outline"
                  className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1 text-xs font-medium"
                >
                  <AlertTriangle className="h-3 w-3" /> Used this period
                </Badge>
              );
            } else if (activeAccount.status === 'missing_details') {
              activeStatusBadge = (
                <Badge
                  variant="outline"
                  className="border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400 gap-1 text-xs font-medium"
                >
                  <AlertCircle className="h-3 w-3" /> Missing CVV
                </Badge>
              );
            } else {
              activeStatusBadge = (
                <Badge variant="outline" className="text-muted-foreground gap-1 text-xs font-medium">
                  {activeAccount.status}
                </Badge>
              );
            }

            return (
              <div
                key={item.instanceId}
                className={cn(
                  'relative flex flex-col gap-3 p-4 sm:p-5 rounded-2xl border transition-all shadow-xs',
                  item.enabled
                    ? isGlobalFirst
                      ? 'bg-primary/[0.03] border-primary/40 ring-1 ring-primary/20'
                      : 'bg-card border-border/80 hover:border-border'
                    : 'bg-muted/20 border-dashed border-border/60 opacity-60'
                )}
              >
                {/* Row 1: Position, Benefit Details, and Active Switch */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {/* Position Badge & Controls */}
                    <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                      <div className="flex flex-col items-center justify-center -space-y-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isGlobalFirst || isPending}
                          onClick={() => handleMoveToTop(item.instanceId)}
                          className="h-5 w-5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 disabled:opacity-20 cursor-pointer"
                          title="Move to top (#1)"
                        >
                          <ArrowUpToLine className="h-3 w-3" />
                        </Button>
                        <div className="flex items-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={isFirstInDisplay || isPending}
                            onClick={() => handleMove(item.instanceId, 'up')}
                            className="h-5 w-5 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer"
                            title="Move up"
                          >
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={isLastInDisplay || isPending}
                            onClick={() => handleMove(item.instanceId, 'down')}
                            className="h-5 w-5 rounded-md text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer"
                            title="Move down"
                          >
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>

                      <div
                        className={cn(
                          'flex items-center justify-center h-8 min-w-8 px-2 rounded-xl font-bold text-xs sm:text-sm tracking-tight',
                          isGlobalFirst && item.enabled
                            ? 'bg-primary text-primary-foreground shadow-2xs'
                            : 'bg-muted text-muted-foreground'
                        )}
                        title={`Queue position #${item.position}`}
                      >
                        #{item.position}
                      </div>
                    </div>

                    {/* Benefit Details & Title */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {item.benefitType && (
                          <Badge variant="outline" className="text-xs font-semibold shrink-0 bg-muted/40">
                            {item.benefitType}
                          </Badge>
                        )}

                        <span className="font-semibold text-sm sm:text-base text-foreground truncate">
                          {item.benefitProvider
                            ? `${item.benefitProvider} - ${item.exactBenefit}`
                            : item.exactBenefit}
                        </span>

                        {item.cashValue > 0 && (
                          <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md shrink-0">
                            ₹{Math.round(item.cashValue)}
                          </span>
                        )}
                      </div>

                      {/* Card & Expiry Meta Line */}
                      <div className="flex items-center gap-x-3 gap-y-1 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1 font-medium text-foreground/80">
                          <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{item.cardName} ••{item.cardLast4} · {item.holderName}</span>
                        </span>

                        <span
                          className={cn(
                            'flex items-center gap-1',
                            isUrgent ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''
                          )}
                        >
                          <Calendar className="h-3.5 w-3.5" />
                          <span>
                            Expires {item.orderDeadline} ({item.daysRemaining}d left)
                          </span>
                        </span>

                        {!item.enabled && (
                          <Badge variant="outline" className="text-[10px] text-muted-foreground py-0">
                            Skipped
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Toggle Active Switch (Top Right) */}
                  <div className="flex items-center gap-2 shrink-0 pt-0.5">
                    <span className="text-xs text-muted-foreground hidden sm:inline font-medium">
                      {item.enabled ? 'Active' : 'Skipped'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={item.enabled}
                      disabled={isPending}
                      onClick={() => handleToggleEnabled(item.instanceId, !item.enabled)}
                      className={cn(
                        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        item.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
                      )}
                      title={item.enabled ? 'Click to skip this voucher' : 'Click to enable this voucher in queue'}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-2xs ring-0 transition duration-200 ease-in-out',
                          item.enabled ? 'translate-x-5' : 'translate-x-0'
                        )}
                      />
                    </button>
                  </div>
                </div>

                {/* Row 2: Actions & Redemption Controls (Clean, Compact, No Clutter) */}
                <div className="pt-2.5 border-t border-border/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap">
                  {/* Pick-One Category Option Selector */}
                  {hasOptions ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground font-medium shrink-0">Offer:</span>
                      <div className="min-w-[210px] max-w-sm">
                        <Select
                          value={item.chosenOptionId ?? ''}
                          onValueChange={(val) => handleSelectOption(item.instanceId, val)}
                          disabled={!item.enabled || isPending}
                        >
                          <SelectTrigger
                            className="h-8 text-xs rounded-xl border-border/80 bg-background font-medium"
                            aria-label={`Pick ${item.benefitType || 'benefit'} option`}
                          >
                            <SelectValue placeholder={`Pick ${item.benefitType || 'benefit'} option...`} />
                          </SelectTrigger>
                          <SelectContent className="rounded-xl">
                            {item.availableOptions.map((opt) => (
                              <SelectItem key={opt.id} value={opt.id} className="text-xs">
                                {opt.provider} - {opt.offerName}
                                {opt.cashValue ? ` (₹${Math.round(opt.cashValue)})` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {optionNeeded ? (
                        <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          Choice required
                        </span>
                      ) : (
                        item.chosenOptionName && (
                          <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3 w-3" />
                            Selected
                          </span>
                        )
                      )}
                    </div>
                  ) : <div />}

                  {/* RuPay Account Redemption Selector */}
                  <div className="flex items-center gap-2 flex-wrap ml-auto sm:ml-0">
                    <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5 shrink-0">
                      <KeyRound className="h-3.5 w-3.5 text-primary" />
                      Redeem with:
                    </span>

                    <select
                      value={item.chosenPortalAccountId || ''}
                      onChange={(e) => handleSelectAccount(item.instanceId, e.target.value || null)}
                      className="h-8 text-xs rounded-xl border border-input bg-background px-2.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-medium"
                    >
                      <option value="">
                        Auto-select ({activeAccount?.accountLabel || 'First eligible'})
                      </option>
                      {mappedAccounts.map((acc) => {
                        const statusLabel =
                          acc.status === 'ready'
                            ? 'Ready'
                            : acc.status === 'cooldown'
                            ? '24h Cooldown'
                            : acc.status === 'conflict'
                            ? 'Used this period'
                            : acc.status === 'missing_details'
                            ? 'Missing CVV'
                            : acc.status;
                        return (
                          <option key={acc.accountId} value={acc.accountId}>
                            {acc.accountLabel} ({statusLabel})
                          </option>
                        );
                      })}
                    </select>

                    {item.chosenPortalAccountId && (
                      <Badge variant="outline" className="text-[10px] bg-primary/10 text-primary border-primary/20 shrink-0 font-medium">
                        Explicit
                      </Badge>
                    )}

                    {activeStatusBadge}

                    {mappedAccounts.length > 1 && (
                      <span className="text-[11px] text-muted-foreground/70 hidden md:inline">
                        ({mappedAccounts.length} mapped)
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {displayedItems.length > DEFAULT_PAGE_SIZE && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 px-1 border-t border-border/40">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{Math.min(visibleCount, displayedItems.length)}</span> of{' '}
                <span className="font-semibold text-foreground">{displayedItems.length}</span> vouchers in queue
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                {visibleCount < displayedItems.length && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setVisibleCount((prev) => Math.min(prev + DEFAULT_PAGE_SIZE, displayedItems.length))}
                    className="h-8 px-3 rounded-xl text-xs font-medium gap-1.5 cursor-pointer border-border/80"
                  >
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    Show 5 more
                  </Button>
                )}
                {displayedItems.length - visibleCount > DEFAULT_PAGE_SIZE && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisibleCount(displayedItems.length)}
                    className="h-8 px-3 rounded-xl text-xs text-muted-foreground hover:text-foreground font-medium cursor-pointer"
                  >
                    Show all ({displayedItems.length})
                  </Button>
                )}
                {visibleCount > DEFAULT_PAGE_SIZE && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setVisibleCount(DEFAULT_PAGE_SIZE)}
                    className="h-8 px-3 rounded-xl text-xs text-muted-foreground hover:text-foreground font-medium gap-1 cursor-pointer"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                    Show less
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
