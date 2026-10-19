'use client';
import { Columns3, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ColumnDefinition, ColumnId } from './columns';

export interface ColumnPickerProps {
  allColumns: ColumnDefinition[];
  activeColumnIds: ColumnId[];
  defaultColumnIds: ColumnId[];
  contextLabel: string;
  isCustomized: boolean;
  onToggleColumn: (id: ColumnId, enabled: boolean) => void;
  onResetToDefaults: () => void;
}

export function ColumnPicker({
  allColumns,
  activeColumnIds,
  defaultColumnIds,
  contextLabel,
  isCustomized,
  onToggleColumn,
  onResetToDefaults,
}: ColumnPickerProps) {
  const activeSet = new Set(activeColumnIds);
  const defaultSet = new Set(defaultColumnIds);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-8 gap-1.5 text-xs font-medium transition-colors',
            isCustomized && 'border-primary/50 bg-primary/5 text-primary',
          )}
          aria-label="Customize table columns"
        >
          <Columns3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span>Columns</span>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
            {activeColumnIds.length}
          </span>
          {isCustomized && (
            <span className="h-1.5 w-1.5 rounded-full bg-primary" title="Columns customized for this view" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 p-0 shadow-lg">
        <div className="border-b border-border p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Table Columns
            </h4>
            {isCustomized && (
              <button
                type="button"
                onClick={onResetToDefaults}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                <RotateCcw className="h-3 w-3" aria-hidden /> Reset to default
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground leading-snug">
            {contextLabel}
          </p>
        </div>

        <div className="max-h-[340px] overflow-y-auto divide-y divide-border/40 p-1">
          {allColumns.map((col) => {
            const isChecked = activeSet.has(col.id);
            const isDefault = defaultSet.has(col.id);
            const isOnlyOne = isChecked && activeColumnIds.length === 1;

            return (
              <label
                key={col.id}
                className={cn(
                  'flex items-start gap-2.5 p-2 rounded-md transition-colors cursor-pointer hover:bg-accent/60 select-none',
                  isOnlyOne && 'cursor-not-allowed opacity-80',
                )}
              >
                <Checkbox
                  id={`col-${col.id}`}
                  checked={isChecked}
                  disabled={isOnlyOne}
                  onCheckedChange={(checked) => onToggleColumn(col.id, Boolean(checked))}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium text-foreground">{col.label}</span>
                    {isDefault && (
                      <Badge variant="secondary" className="px-1 py-0 text-[9px] font-normal leading-normal">
                        Default
                      </Badge>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate leading-tight mt-0.5">
                    {col.description}
                  </p>
                </div>
              </label>
            );
          })}
        </div>

        <div className="border-t border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground flex items-center justify-between">
          <span>{activeColumnIds.length} of {allColumns.length} visible</span>
          {isCustomized ? (
            <span className="font-medium text-primary">Customized</span>
          ) : (
            <span className="text-muted-foreground">Default view</span>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
