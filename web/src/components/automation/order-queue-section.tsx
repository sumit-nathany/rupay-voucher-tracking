'use client';

import { useState, useTransition } from 'react';
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
import {
  populateAndSortQueueAction,
  updateQueueItemAction,
  moveQueueItemAction,
} from '@/actions/automation';

interface OrderQueueSectionProps {
  initialQueue: QueueItemView[];
}

export function OrderQueueSection({ initialQueue }: OrderQueueSectionProps) {
  const [items, setItems] = useState<QueueItemView[]>(initialQueue);
  const [isPending, startTransition] = useTransition();

  const handleAutoSort = (strategy: 'nearest_expiring' | 'highest_value') => {
    startTransition(async () => {
      try {
        const updated = await populateAndSortQueueAction({ strategy });
        setItems(updated);
      } catch (err) {
        console.error('Failed to sort queue:', err);
      }
    });
  };

  const handleMove = (instanceId: string, direction: 'up' | 'down') => {
    // Optimistic reorder
    const idx = items.findIndex((i) => i.instanceId === instanceId);
    if (idx !== -1) {
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx >= 0 && targetIdx < items.length) {
        const next = [...items];
        const temp = next[idx];
        next[idx] = next[targetIdx];
        next[targetIdx] = temp;
        next.forEach((item, i) => {
          item.position = i;
        });
        setItems(next);
      }
    }

    startTransition(async () => {
      try {
        await moveQueueItemAction({ instanceId, direction });
      } catch {
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

  const enabledCount = items.filter((i) => i.enabled).length;

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
              {enabledCount} of {items.length} active
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
            Voucher benefits ranked for automated daily ordering. Top eligible voucher runs every 24 hours. Discounts (BookMyShow, Cleartrip, TaxSpanner, Golf) are excluded.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 flex-wrap">
          {/* Quick Sort Dropdown */}
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
            onClick={() => handleAutoSort('nearest_expiring')}
            disabled={isPending}
            className="h-9 px-2.5 rounded-xl text-muted-foreground hover:text-foreground"
            title="Refresh Queue"
          >
            <RefreshCw className={`h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Queue Items */}
      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-12 text-center bg-muted/10">
          <ListOrdered className="h-10 w-10 text-muted-foreground/60 mb-3" />
          <p className="text-base font-semibold text-foreground">No Pending Vouchers In Queue</p>
          <p className="text-sm text-muted-foreground max-w-md mt-1.5">
            Pending vouchers appear here automatically when you have cards mapped to connected RuPay accounts with unclaimed benefits.
          </p>
          <Button
            onClick={() => handleAutoSort('nearest_expiring')}
            disabled={isPending}
            className="mt-4 gap-2 text-xs sm:text-sm font-medium rounded-xl"
          >
            <RefreshCw className="h-4 w-4" />
            Check & Populate Queue
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => {
            const isFirst = index === 0;
            const isLast = index === items.length - 1;
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
                        className="h-6 w-6 rounded-lg text-muted-foreground hover:text-foreground"
                        title="Move Up"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={isLast || isPending}
                        onClick={() => handleMove(item.instanceId, 'down')}
                        className="h-6 w-6 rounded-lg text-muted-foreground hover:text-foreground"
                        title="Move Down"
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
                  <div className="min-w-0 flex-1 space-y-1">
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
                          Next Up
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
                      <span className="flex items-center gap-1">
                        <CreditCard className="h-3 w-3" />
                        <span>{item.cardName} (••{item.cardLast4})</span>
                      </span>

                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        <span>{item.holderName}</span>
                      </span>

                      {item.portalAccountLabel && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-muted font-mono">
                          {item.portalAccountLabel}
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

                    {/* Option Selector (for Pick-One benefits) */}
                    {hasOptions && (
                      <div className="pt-1.5 flex items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground shrink-0">
                          Option:
                        </span>
                        <div className="max-w-xs">
                          <Select
                            value={item.chosenOptionId ?? ''}
                            onValueChange={(val) => handleSelectOption(item.instanceId, val)}
                            disabled={!item.enabled || isPending}
                          >
                            <SelectTrigger className="h-7 text-xs rounded-lg border-border/80">
                              <SelectValue placeholder="Select voucher option..." />
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
                          <span className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            Required for booking
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Toggle Switch */}
                <div className="flex items-center gap-3 self-end sm:self-center shrink-0 pl-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      {item.enabled ? 'Active' : 'Skip'}
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
