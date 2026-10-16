'use client';

import { useState, useTransition, useMemo, useEffect } from 'react';
import {
  Sparkles,
  Calendar,
  CreditCard,
  AlertTriangle,
  ListOrdered,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  KeyRound,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
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
import type { QueueItemView } from '@/domain/ordering-queue';
import type { PortalAccountView } from '@/domain/automation';
import {
  populateAndSortQueueAction,
  updateQueueItemAction,
  reorderQueueAction,
  listOrderingQueueAction,
} from '@/actions/automation';

const DEFAULT_PAGE_SIZE = 5;

interface OrderQueueSectionProps {
  initialQueue: QueueItemView[];
  accounts?: PortalAccountView[];
}

export function OrderQueueSection({
  initialQueue,
  accounts = [],
}: OrderQueueSectionProps) {
  const [items, setItems] = useState<QueueItemView[]>(initialQueue);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [visibleCount, setVisibleCount] = useState<number>(DEFAULT_PAGE_SIZE);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setItems(initialQueue);
  }, [initialQueue]);

  useEffect(() => {
    setVisibleCount(DEFAULT_PAGE_SIZE);
  }, [selectedAccountId]);

  // Filter items based on the selected RuPay account scope
  const displayedItems = useMemo(() => {
    if (selectedAccountId === 'all') return items;
    return items.filter(
      (i) =>
        i.portalAccountId === selectedAccountId ||
        i.portalAccounts.some((a) => a.id === selectedAccountId),
    );
  }, [items, selectedAccountId]);

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
        const filter =
          selectedAccountId !== 'all' ? { portalAccountId: selectedAccountId } : undefined;

        await populateAndSortQueueAction({ strategy, filter });
        const fresh = await listOrderingQueueAction();
        setItems(fresh);
      } catch (err) {
        console.error('Failed to sort queue:', err);
      }
    });
  };

  const handleMove = (instanceId: string, direction: 'up' | 'down') => {
    const idx = displayedItems.findIndex((i) => i.instanceId === instanceId);
    if (idx === -1) return;

    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= displayedItems.length) return;

    // Expand visibleCount if moving an item down past current visible threshold so it stays in view
    if (targetIdx >= visibleCount) {
      setVisibleCount(targetIdx + 1);
    }

    // Optimistically reorder displayed items
    const reorderedDisplayed = [...displayedItems];
    const temp = reorderedDisplayed[idx];
    reorderedDisplayed[idx] = reorderedDisplayed[targetIdx];
    reorderedDisplayed[targetIdx] = temp;

    // Build the updated global items array
    const displayedIdSet = new Set(reorderedDisplayed.map((d) => d.instanceId));
    const nonDisplayed = items.filter((i) => !displayedIdSet.has(i.instanceId));
    const nextAll = [...reorderedDisplayed, ...nonDisplayed].map((item, i) => ({
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

  const totalValue = displayedItems
    .filter((i) => i.enabled)
    .reduce((sum, i) => sum + i.cashValue, 0);

  return (
    <div className="space-y-5">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Order Queue
            </h2>
            {totalValue > 0 && (
              <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
                ₹{Math.round(totalValue)} queued
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            The worker orders these vouchers top-to-bottom, one per account every 24h. Reorder, skip, or pick a benefit option.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 flex-wrap">
          {/* Scope: All / per RuPay account */}
          <div className="w-56">
            <Select
              value={selectedAccountId}
              onValueChange={setSelectedAccountId}
              disabled={isPending}
            >
              <SelectTrigger className="h-9 text-xs sm:text-sm font-medium rounded-xl gap-2 border-border/80">
                <KeyRound className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <SelectValue placeholder="Scope..." />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="all" className="text-xs sm:text-sm">
                  All Accounts ({items.length} vouchers)
                </SelectItem>
                {accounts.map((acc) => {
                  const count = items.filter(
                    (i) =>
                      i.portalAccountId === acc.id ||
                      i.portalAccounts.some((a) => a.id === acc.id),
                  ).length;
                  return (
                    <SelectItem key={acc.id} value={acc.id} className="text-xs sm:text-sm">
                      {acc.label} ({count})
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Quick Auto-Sort */}
          <div className="w-52">
            <Select
              defaultValue="nearest_expiring"
              onValueChange={(v) => handleAutoSort(v as 'nearest_expiring' | 'highest_value')}
              disabled={isPending}
            >
              <SelectTrigger className="h-9 text-xs sm:text-sm font-medium rounded-xl gap-2 border-border/80">
                <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />
                <SelectValue placeholder="Auto-Sort..." />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="nearest_expiring" className="text-xs sm:text-sm">
                  Nearest Expiry First
                </SelectItem>
                <SelectItem value="highest_value" className="text-xs sm:text-sm">
                  Highest Value First
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isPending}
            className="h-9 px-2.5 rounded-xl text-muted-foreground hover:text-foreground"
            title="Refresh Queue"
          >
            <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Queue Items List */}
      {displayedItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-12 text-center bg-muted/10">
          <ListOrdered className="h-10 w-10 text-muted-foreground/60 mb-3" />
          <p className="text-base font-semibold text-foreground">No Vouchers In This Queue</p>
          <p className="text-sm text-muted-foreground max-w-md mt-1.5">
            {selectedAccountId === 'all'
              ? 'No pending voucher benefits found in this workspace.'
              : 'No voucher benefits found for cards linked to this RuPay account.'}
          </p>
          <Button
            onClick={() => handleAutoSort('nearest_expiring')}
            disabled={isPending}
            className="mt-4 gap-2 text-xs sm:text-sm font-medium rounded-xl"
          >
            <RefreshCw className="h-4 w-4" />
            Check & Auto-Sort Queue
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleItems.map((item, index) => {
            const isFirst = index === 0;
            const isLast = index === displayedItems.length - 1;
            const isUrgent = item.daysRemaining <= 7;
            const hasOptions = item.availableOptions.length > 0;
            const optionNeeded = hasOptions && !item.chosenOptionId;

            return (
              <div
                key={item.instanceId}
                className={`relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl border transition-all ${
                  item.enabled
                    ? isFirst
                      ? 'bg-primary/5 border-primary/30 shadow-xs ring-1 ring-primary/20'
                      : 'bg-card border-border/80 hover:border-border shadow-xs'
                    : 'bg-muted/30 border-dashed border-border/60 opacity-60'
                }`}
              >
                {/* Left: Reorder Controls + Rank + Info */}
                <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                  {/* Position Badge & Reorder Arrows */}
                  <div className="flex flex-col sm:flex-row items-center gap-1 shrink-0">
                    <div className="flex flex-col items-center justify-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={isFirst || isPending}
                        onClick={() => handleMove(item.instanceId, 'up')}
                        className="h-6 w-6 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer disabled:cursor-not-allowed"
                        title="Move Up in Queue"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={isLast || isPending}
                        onClick={() => handleMove(item.instanceId, 'down')}
                        className="h-6 w-6 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer disabled:cursor-not-allowed"
                        title="Move Down in Queue"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div
                      className={`flex items-center justify-center h-8 w-8 rounded-xl font-bold text-xs sm:text-sm ${
                        isFirst && item.enabled
                          ? 'bg-primary text-primary-foreground shadow-xs'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      #{index + 1}
                    </div>
                  </div>

                  {/* Details */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm sm:text-base text-foreground truncate">
                        {item.benefitProvider
                          ? `${item.benefitProvider} - ${item.exactBenefit}`
                          : item.exactBenefit}
                      </span>

                      {item.cashValue > 0 && (
                        <span className="text-xs sm:text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                          ₹{Math.round(item.cashValue)}
                        </span>
                      )}
                    </div>

                    {/* Metadata: one quiet line */}
                    <div className="flex items-center gap-x-3 gap-y-1 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <CreditCard className="h-3 w-3" />
                        <span>{item.cardName} ••{item.cardLast4} · {item.holderName}</span>
                      </span>

                      {item.portalAccountLabel ? (
                        <span className="flex items-center gap-1">
                          <KeyRound className="h-3 w-3" />
                          <span>{item.portalAccountLabel}</span>
                        </span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          Not mapped to a RuPay account
                        </span>
                      )}

                      <span
                        className={`flex items-center gap-1 ${
                          isUrgent ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''
                        }`}
                      >
                        <Calendar className="h-3 w-3" />
                        <span>
                          Expires {item.orderDeadline} ({item.daysRemaining}d)
                        </span>
                      </span>

                      {!item.enabled && (
                        <span className="font-medium text-muted-foreground/70">Skipped</span>
                      )}
                    </div>

                    {/* Pick-One Category Option Selector */}
                    {hasOptions && (
                      <div className="pt-1 flex items-center gap-2 flex-wrap">
                        <div className="min-w-[240px] max-w-sm">
                          <Select
                            value={item.chosenOptionId ?? ''}
                            onValueChange={(val) => handleSelectOption(item.instanceId, val)}
                            disabled={!item.enabled || isPending}
                          >
                            <SelectTrigger className="h-8 text-xs rounded-xl border-border/80 bg-background font-medium">
                              <SelectValue placeholder="Pick benefit option..." />
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
                    )}
                  </div>
                </div>

                {/* Right: Toggle Active / Skip */}
                <div className="flex items-center gap-3 self-end sm:self-center shrink-0 pl-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground hidden sm:inline font-medium">
                      {item.enabled ? 'Active' : 'Skipped'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={item.enabled}
                      disabled={isPending}
                      onClick={() => handleToggleEnabled(item.instanceId, !item.enabled)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                        item.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
                      }`}
                      title={item.enabled ? 'Click to skip this voucher' : 'Click to enable this voucher in queue'}
                    >
                      <span
                        aria-hidden="true"
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                          item.enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
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
