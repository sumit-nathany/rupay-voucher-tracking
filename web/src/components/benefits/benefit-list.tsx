'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Gift } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatINR } from '@/components/dashboard/format';
import type { InstanceListItem } from '@/domain/instance-queries';
import { cn } from '@/lib/utils';
import { formatCardLabel } from '@/domain/card-label';
import { benefitLabel } from './label';
import { isLifetimeScope } from '@/components/dashboard/view-params';
import { formatDate } from '@/components/benefit-detail/helpers';
import {
  groupBenefitItems,
  parseSort,
  resolveBenefitGroupMode,
  sortBenefitItems,
} from './group';
import { StatusBadge } from './status-badge';
import { useBenefitDrawer } from './use-drawer';
import {
  ALL_COLUMNS,
  clearSavedColumnsPreference,
  getContextLabel,
  getDefaultColumnsForContext,
  loadSavedColumns,
  parseColumnsParam,
  resolveContextKey,
  saveColumnsPreference,
  type BenefitViewContext,
  type ColumnDefinition,
  type ColumnId,
} from './columns';
import { ColumnPicker } from './column-picker';

interface RowProps {
  it: InstanceListItem;
  onOpen: (id: string, l?: { title: string; subtitle: string }) => void;
  activeColumns: ColumnDefinition[];
  gridTemplate: string;
  hasCol: (id: ColumnId) => boolean;
}

function Row({ it, onOpen, activeColumns, gridTemplate, hasCol }: RowProps) {
  const muted = it.status === 'Withdrawn' || it.status === 'Skipped';
  const cardLabel = formatCardLabel({
    holderName: it.holderName,
    cardName: it.cardName,
    lastDigits: it.cardLastDigits,
  });

  return (
    <li>
      <button
        type="button"
        onClick={() =>
          onOpen(it.id, {
            title: `${it.benefitType}: ${benefitLabel(it)}`,
            subtitle: `${cardLabel}${it.rupayBookingId ? ` · Booking: ${it.rupayBookingId}` : ''}`,
          })
        }
        className={cn(
          'block w-full px-4 py-3.5 text-left transition-colors duration-200 hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
          'md:grid md:items-center md:gap-4',
          muted && 'opacity-70',
        )}
        style={{
          gridTemplateColumns: gridTemplate,
        }}
      >
        {/* Desktop grid columns */}
        {activeColumns.map((col) => {
          switch (col.id) {
            case 'category':
              return (
                <span
                  key={col.id}
                  className="hidden min-w-0 truncate text-sm text-muted-foreground md:block"
                  title={it.benefitType}
                >
                  {it.benefitType}
                </span>
              );

            case 'benefit':
              return (
                <span
                  key={col.id}
                  className={cn(
                    'hidden min-w-0 truncate text-sm font-medium md:block',
                    it.status === 'Withdrawn' && 'line-through decoration-muted-foreground/60',
                  )}
                  title={benefitLabel(it)}
                >
                  {benefitLabel(it)}
                </span>
              );

            case 'card':
              return (
                <span
                  key={col.id}
                  className="hidden min-w-0 truncate text-sm text-muted-foreground md:block"
                  title={cardLabel}
                >
                  <span>{cardLabel}</span>
                  {!hasCol('portalAccount') && it.portalAccountLabel && (
                    <span className="text-muted-foreground/75"> · {it.portalAccountLabel}</span>
                  )}
                  {!hasCol('rupayBookingId') && it.rupayBookingId && (
                    <span className="text-muted-foreground/75"> · Booking: {it.rupayBookingId}</span>
                  )}
                </span>
              );

            case 'rupayBookingId':
              return (
                <span key={col.id} className="hidden min-w-0 truncate text-xs md:block">
                  {it.rupayBookingId ? (
                    <span
                      className="inline-flex max-w-full truncate items-center rounded border border-border/70 bg-muted/80 px-1.5 py-0.5 font-mono text-xs font-semibold text-foreground"
                      title={it.rupayBookingId}
                    >
                      {it.rupayBookingId}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/40">—</span>
                  )}
                </span>
              );

            case 'portalAccount':
              return (
                <span
                  key={col.id}
                  className="hidden min-w-0 truncate text-xs text-muted-foreground md:block"
                  title={it.portalAccountLabel ?? ''}
                >
                  {it.portalAccountLabel ?? <span className="text-muted-foreground/40">—</span>}
                </span>
              );

            case 'period':
              return (
                <span
                  key={col.id}
                  className="hidden min-w-0 truncate text-xs font-medium text-muted-foreground md:block"
                >
                  {it.periodLabel}
                </span>
              );

            case 'orderDate':
              return (
                <span
                  key={col.id}
                  className="hidden min-w-0 truncate text-xs text-muted-foreground md:block"
                >
                  {formatDate(it.orderDate)}
                </span>
              );

            case 'expiryDate':
              return (
                <span
                  key={col.id}
                  className="hidden min-w-0 truncate text-xs text-muted-foreground md:block"
                >
                  {formatDate(it.expiryDate)}
                </span>
              );

            case 'deadline':
              return (
                <span
                  key={col.id}
                  className="hidden min-w-0 truncate text-xs text-muted-foreground md:block"
                >
                  {formatDate(it.orderDeadline)}
                </span>
              );

            case 'frequency':
              return (
                <span
                  key={col.id}
                  className="hidden min-w-0 truncate text-xs text-muted-foreground md:block"
                >
                  {it.frequency}
                </span>
              );

            case 'value':
              return (
                <span
                  key={col.id}
                  className="hidden text-right text-sm font-medium tabular-nums text-foreground md:block"
                >
                  {formatINR(it.value)}
                </span>
              );

            case 'status':
              return (
                <span
                  key={col.id}
                  className="hidden md:flex flex-wrap items-center justify-end gap-1.5"
                >
                  <StatusBadge item={it} />
                  {it.offerKind === 'discount' && (
                    <Badge variant="secondary" title="Discount coupon — not a standard gift voucher">
                      Discount
                    </Badge>
                  )}
                  {it.hasCode && (
                    <Badge variant="outline" className="gap-1" title="A voucher code is stored">
                      <Gift className="h-3 w-3" aria-hidden /> Code
                    </Badge>
                  )}
                </span>
              );

            case 'comments':
              return (
                <span
                  key={col.id}
                  className="hidden min-w-0 truncate text-xs text-muted-foreground md:block"
                  title={it.comments ?? ''}
                >
                  {it.comments || <span className="text-muted-foreground/40">—</span>}
                </span>
              );

            default:
              return null;
          }
        })}

        {/* Mobile card layout (< md) */}
        <div className="space-y-1.5 md:hidden">
          <div className="flex items-start justify-between gap-2">
            <span
              className={cn(
                'min-w-0 text-sm font-medium',
                it.status === 'Withdrawn' && 'line-through decoration-muted-foreground/60',
              )}
            >
              <span className="text-muted-foreground">{it.benefitType}: </span>
              {benefitLabel(it)}
            </span>
            <span className="shrink-0 text-sm font-medium tabular-nums">{formatINR(it.value)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {cardLabel}
            {it.portalAccountLabel ? ` · ${it.portalAccountLabel}` : ''}
          </div>
          {it.rupayBookingId && (
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="text-[11px] text-muted-foreground">RuPay Tag ID:</span>
              <span className="inline-flex rounded border border-border/70 bg-muted/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                {it.rupayBookingId}
              </span>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <StatusBadge item={it} />
            {it.offerKind === 'discount' && (
              <Badge variant="secondary" title="Discount coupon — not a standard gift voucher">
                Discount
              </Badge>
            )}
            {it.hasCode && (
              <Badge variant="outline" className="gap-1" title="A voucher code is stored">
                <Gift className="h-3 w-3" aria-hidden /> Code
              </Badge>
            )}
          </div>
        </div>
      </button>
    </li>
  );
}

export function BenefitList({ items }: { items: InstanceListItem[] }) {
  const { open, drawer } = useBenefitDrawer();
  const sp = useSearchParams();
  const sort = parseSort(sp.get('sort'));
  const lifetime = isLifetimeScope({ lifetime: sp.get('lifetime') ?? undefined });
  const groupMode = resolveBenefitGroupMode(sp.get('group'), lifetime);
  const statusParam = sp.get('status');
  const searchScopeParam = sp.get('search_scope');
  const portalAccountIdParam = sp.get('account') ?? sp.get('portal_account');
  const urlColsParam = sp.get('cols');

  const viewCtx: BenefitViewContext = useMemo(
    () => ({
      status: statusParam,
      lifetime,
      searchScope: searchScopeParam,
      portalAccountId: portalAccountIdParam,
    }),
    [statusParam, lifetime, searchScopeParam, portalAccountIdParam],
  );

  const defaultColumnIds = useMemo(() => getDefaultColumnsForContext(viewCtx), [viewCtx]);
  const contextLabel = useMemo(() => getContextLabel(viewCtx), [viewCtx]);
  const contextKey = useMemo(() => resolveContextKey(viewCtx), [viewCtx]);

  // Resolve active columns: URL param takes highest precedence, then localStorage, then context default
  const [activeColumnIds, setActiveColumnIds] = useState<ColumnId[]>(() => {
    const fromUrl = parseColumnsParam(urlColsParam);
    if (fromUrl) return fromUrl;
    return defaultColumnIds;
  });

  // Keep columns aligned with view changes and saved preferences
  useEffect(() => {
    const fromUrl = parseColumnsParam(urlColsParam);
    if (fromUrl) {
      setActiveColumnIds(fromUrl);
      return;
    }
    const saved = loadSavedColumns(viewCtx);
    if (saved) {
      setActiveColumnIds(saved);
    } else {
      setActiveColumnIds(defaultColumnIds);
    }
  }, [contextKey, urlColsParam, defaultColumnIds, viewCtx]);

  const activeColumnSet = useMemo(() => new Set(activeColumnIds), [activeColumnIds]);
  const hasCol = (id: ColumnId) => activeColumnSet.has(id);

  // Maintain canonical order based on ALL_COLUMNS
  const activeColumns = useMemo(
    () => ALL_COLUMNS.filter((col) => activeColumnSet.has(col.id)),
    [activeColumnSet],
  );

  const gridTemplate = useMemo(
    () => activeColumns.map((c) => c.gridWidth).join(' '),
    [activeColumns],
  );

  const minWidthPx = useMemo(
    () => Math.max(720, activeColumns.reduce((sum, c) => sum + c.minWidthPx, 0)),
    [activeColumns],
  );

  const isCustomized = useMemo(() => {
    if (activeColumnIds.length !== defaultColumnIds.length) return true;
    return activeColumnIds.some((id, idx) => id !== defaultColumnIds[idx]);
  }, [activeColumnIds, defaultColumnIds]);

  const handleToggleColumn = (id: ColumnId, enabled: boolean) => {
    const nextSet = new Set(activeColumnIds);
    if (enabled) {
      nextSet.add(id);
    } else {
      if (nextSet.size <= 1) return; // Prevent hiding all columns
      nextSet.delete(id);
    }
    const ordered = ALL_COLUMNS.filter((c) => nextSet.has(c.id)).map((c) => c.id);
    setActiveColumnIds(ordered);
    saveColumnsPreference(viewCtx, ordered);
  };

  const handleResetToDefaults = () => {
    clearSavedColumnsPreference(viewCtx);
    setActiveColumnIds(defaultColumnIds);
  };

  const groups = groupBenefitItems(items, groupMode, sort).map((g) => ({
    ...g,
    items: sortBenefitItems(g.items, sort),
  }));

  return (
    <div className="space-y-6">
      {/* Table toolbar: counts + column customization */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {items.length} {items.length === 1 ? 'benefit' : 'benefits'}
            {groups.length > 1 ? ` · ${groups.length} groups` : ''}
          </span>
          {viewCtx.status === 'Ordered' && (
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
              RuPay Tag ID included
            </span>
          )}
        </div>
        <ColumnPicker
          allColumns={ALL_COLUMNS}
          activeColumnIds={activeColumnIds}
          defaultColumnIds={defaultColumnIds}
          contextLabel={contextLabel}
          isCustomized={isCustomized}
          onToggleColumn={handleToggleColumn}
          onResetToDefaults={handleResetToDefaults}
        />
      </div>

      <div className="space-y-8">
        {groups.map((g) => (
          <section key={g.key} aria-labelledby={`g-${g.key}`}>
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-border/60 pb-2">
              <h2 id={`g-${g.key}`} className="text-base font-semibold tracking-tight text-foreground sm:text-lg">
                {g.title}
              </h2>
              <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {g.items.length}
              </span>
            </div>
            <div className="panel overflow-x-auto">
              <div
                className="hidden border-b border-border/80 bg-muted/40 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid md:items-center md:gap-4"
                style={{
                  gridTemplateColumns: gridTemplate,
                  minWidth: `${minWidthPx}px`,
                }}
                aria-hidden
              >
                {activeColumns.map((col) => (
                  <span
                    key={col.id}
                    className={cn(col.align === 'right' ? 'text-right' : 'text-left')}
                  >
                    {col.label}
                  </span>
                ))}
              </div>
              <ul className="divide-y divide-border/80" style={{ minWidth: `${minWidthPx}px` }}>
                {g.items.map((it) => (
                  <Row
                    key={it.id}
                    it={it}
                    onOpen={open}
                    activeColumns={activeColumns}
                    gridTemplate={gridTemplate}
                    hasCol={hasCol}
                  />
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
      {drawer}
    </div>
  );
}
