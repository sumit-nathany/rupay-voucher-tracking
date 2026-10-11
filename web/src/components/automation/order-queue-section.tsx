'use client';

import { useState, useTransition, useMemo, useEffect } from 'react';
import {
  Sparkles,
  Calendar,
  CreditCard,
  User,
  AlertTriangle,
  ListOrdered,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  KeyRound,
  Layers,
  CheckCircle2,
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
import type { CardOption } from './portal-card-mappings-section';
import {
  populateAndSortQueueAction,
  updateQueueItemAction,
  reorderQueueAction,
  listOrderingQueueAction,
} from '@/actions/automation';

interface OrderQueueSectionProps {
  initialQueue: QueueItemView[];
  accounts?: PortalAccountView[];
  availableCards?: CardOption[];
}

export function OrderQueueSection({
  initialQueue,
  accounts = [],
  availableCards = [],
}: OrderQueueSectionProps) {
  const [items, setItems] = useState<QueueItemView[]>(initialQueue);
  const [viewMode, setViewMode] = useState<'all' | 'account' | 'card'>('all');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [selectedCardId, setSelectedCardId] = useState<string>('all');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setItems(initialQueue);
  }, [initialQueue]);

  // Filter items based on active view mode and selection
  const displayedItems = useMemo(() => {
    if (viewMode === 'account') {
      if (selectedAccountId === 'all') {
        return items.filter((i) => i.portalAccounts.length > 0 || i.portalAccountId);
      }
      return items.filter(
        (i) =>
          i.portalAccountId === selectedAccountId ||
          i.portalAccounts.some((a) => a.id === selectedAccountId),
      );
    }
    if (viewMode === 'card') {
      if (selectedCardId === 'all') {
        return items;
      }
      return items.filter((i) => i.cardId === selectedCardId);
    }
    return items;
  }, [items, viewMode, selectedAccountId, selectedCardId]);

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
          viewMode === 'card' && selectedCardId !== 'all'
            ? { cardId: selectedCardId }
            : viewMode === 'account' && selectedAccountId !== 'all'
            ? { portalAccountId: selectedAccountId }
            : undefined;

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

  const activeCount = displayedItems.filter((i) => i.enabled).length;
  const totalValue = displayedItems
    .filter((i) => i.enabled)
    .reduce((sum, i) => sum + i.cashValue, 0);

  // Active filter label description
  const activeScopeDescription = useMemo(() => {
    if (viewMode === 'account') {
      if (selectedAccountId === 'all') return 'All Connected RuPay Accounts';
      const acc = accounts.find((a) => a.id === selectedAccountId);
      return acc ? `RuPay Account: ${acc.label}` : 'Selected RuPay Account';
    }
    if (viewMode === 'card') {
      if (selectedCardId === 'all') return 'All Cards';
      const card = availableCards.find((c) => c.id === selectedCardId);
      return card ? `Card: ${card.name} (••${card.lastDigits})` : 'Selected Card';
    }
    return 'All Workspace Voucher Benefits';
  }, [viewMode, selectedAccountId, selectedCardId, accounts, availableCards]);

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
              Order Queue
            </h2>
            <Badge variant="outline" className="text-xs font-medium">
              {activeCount} of {displayedItems.length} active
            </Badge>
            {totalValue > 0 && (
              <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold">
                ₹{Math.round(totalValue)} queued
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            View and rank vouchers scheduled for automated ordering. You can view the queue for any specific RuPay account or card, reorder vouchers, and choose category options.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 flex-wrap">
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
                  ⚡ Nearest Expiry First
                </SelectItem>
                <SelectItem value="highest_value" className="text-xs sm:text-sm">
                  💰 Highest Value First
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

      {/* Scope / Filter Bar */}
      <div className="p-4 rounded-2xl border border-border/80 bg-muted/20 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* View Mode Switcher */}
          <div className="inline-flex rounded-xl bg-background p-1 border border-border/60 shadow-xs">
            <button
              type="button"
              onClick={() => setViewMode('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                viewMode === 'all'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                <span>All Vouchers</span>
                <span className="opacity-70 text-[11px]">({items.length})</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('account')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                viewMode === 'account'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <KeyRound className="h-3.5 w-3.5" />
                <span>By RuPay Account</span>
                <span className="opacity-70 text-[11px]">({accounts.length})</span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('card')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                viewMode === 'card'
                  ? 'bg-primary text-primary-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5" />
                <span>By Card</span>
                <span className="opacity-70 text-[11px]">({availableCards.length})</span>
              </span>
            </button>
          </div>

          {/* Secondary Dropdown for specific Account or Card */}
          {viewMode === 'account' && (
            <div className="w-full sm:w-72">
              <Select
                value={selectedAccountId}
                onValueChange={setSelectedAccountId}
                disabled={isPending}
              >
                <SelectTrigger className="h-9 text-xs sm:text-sm font-medium rounded-xl border-border/80">
                  <SelectValue placeholder="Select RuPay Account..." />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="all" className="text-xs sm:text-sm">
                    All RuPay Accounts ({accounts.length})
                  </SelectItem>
                  {accounts.map((acc) => {
                    const count = items.filter(
                      (i) =>
                        i.portalAccountId === acc.id ||
                        i.portalAccounts.some((a) => a.id === acc.id),
                    ).length;
                    return (
                      <SelectItem key={acc.id} value={acc.id} className="text-xs sm:text-sm">
                        {acc.label} ({count} vouchers)
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {viewMode === 'card' && (
            <div className="w-full sm:w-80">
              <Select
                value={selectedCardId}
                onValueChange={setSelectedCardId}
                disabled={isPending}
              >
                <SelectTrigger className="h-9 text-xs sm:text-sm font-medium rounded-xl border-border/80">
                  <SelectValue placeholder="Select Card..." />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="all" className="text-xs sm:text-sm">
                    All Cards ({availableCards.length})
                  </SelectItem>
                  {availableCards.map((card) => {
                    const count = items.filter((i) => i.cardId === card.id).length;
                    return (
                      <SelectItem key={card.id} value={card.id} className="text-xs sm:text-sm">
                        {card.name} (••{card.lastDigits}) — {card.holderName} ({count})
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Current Scope Banner */}
        <div className="text-xs text-muted-foreground flex items-center justify-between pt-1 border-t border-border/40">
          <span className="font-medium text-foreground">
            {activeScopeDescription}
          </span>
          <span>
            {displayedItems.length} {displayedItems.length === 1 ? 'voucher' : 'vouchers'} in this view
          </span>
        </div>
      </div>

      {/* Queue Items List */}
      {displayedItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-12 text-center bg-muted/10">
          <ListOrdered className="h-10 w-10 text-muted-foreground/60 mb-3" />
          <p className="text-base font-semibold text-foreground">No Vouchers In This Queue</p>
          <p className="text-sm text-muted-foreground max-w-md mt-1.5">
            {viewMode === 'card'
              ? 'This card has no unclaimed voucher benefits in the current period.'
              : viewMode === 'account'
              ? 'No voucher benefits found for cards linked to this RuPay account.'
              : 'No pending voucher benefits found in this workspace.'}
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
          {displayedItems.map((item, index) => {
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
                        <Badge
                          variant="secondary"
                          className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 text-xs font-semibold px-2 py-0"
                        >
                          ₹{Math.round(item.cashValue)}
                        </Badge>
                      )}

                      {isFirst && item.enabled && (
                        <Badge className="bg-primary text-primary-foreground text-[10px] font-semibold px-1.5 py-0 uppercase tracking-wider">
                          Next to Order
                        </Badge>
                      )}

                      {!item.enabled && (
                        <Badge variant="outline" className="text-muted-foreground text-xs">
                          Skipped
                        </Badge>
                      )}
                    </div>

                    {/* Metadata tags */}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1 font-medium text-foreground/80">
                        <CreditCard className="h-3 w-3" />
                        <span>{item.cardName} (••{item.cardLast4})</span>
                      </span>

                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        <span>{item.holderName}</span>
                      </span>

                      {/* RuPay Account tag */}
                      {item.portalAccountLabel ? (
                        <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md bg-muted font-mono text-foreground/90 border border-border/40">
                          <KeyRound className="h-2.5 w-2.5 text-muted-foreground" />
                          <span>{item.portalAccountLabel}</span>
                        </span>
                      ) : (
                        <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                          Not Mapped to RuPay Account
                        </span>
                      )}

                      <span
                        className={`flex items-center gap-1 font-medium ${
                          isUrgent ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''
                        }`}
                      >
                        <Calendar className="h-3 w-3" />
                        <span>
                          Expires {item.orderDeadline} ({item.daysRemaining}d left)
                        </span>
                      </span>
                    </div>

                    {/* Pick-One Category Option Selector */}
                    {hasOptions && (
                      <div className="pt-1.5 flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-foreground/90 shrink-0 flex items-center gap-1">
                          <span>Pick Benefit Choice:</span>
                        </span>
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
                        {optionNeeded && (
                          <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            Choice required for automated ordering
                          </span>
                        )}
                        {!optionNeeded && item.chosenOptionName && (
                          <span className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Selected
                          </span>
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
        </div>
      )}
    </div>
  );
}
