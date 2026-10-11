'use client';

import * as React from 'react';
import { IndianRupee, Loader2, Sparkles, Undo2 } from 'lucide-react';
import {
  deleteBenefitValueOverrideAction,
  upsertBenefitValueOverrideAction,
} from '@/actions/benefit-values';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMoney } from './helpers';

export interface CustomValuationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  benefitName: string;
  benefitType?: string | null;
  benefitProvider?: string | null;
  catalogDefaultValue: number | null;
  customDefaultValue: number | null;
  onSaved: () => void;
}

export function CustomValuationDialog({
  open,
  onOpenChange,
  benefitName,
  benefitType,
  benefitProvider,
  catalogDefaultValue,
  customDefaultValue,
  onSaved,
}: CustomValuationDialogProps) {
  const [val, setVal] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setVal(customDefaultValue != null ? String(customDefaultValue) : catalogDefaultValue != null ? String(catalogDefaultValue) : '');
      setError(null);
    }
  }, [open, customDefaultValue, catalogDefaultValue]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const numVal = Number(val.trim());
    if (isNaN(numVal) || numVal < 0) {
      setError('Please enter a valid amount (₹0 or higher).');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await upsertBenefitValueOverrideAction({
        benefitName,
        customValue: Math.round(numVal * 100) / 100,
        benefitType,
        benefitProvider,
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save valuation.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevert() {
    setBusy(true);
    setError(null);
    try {
      await deleteBenefitValueOverrideAction({ benefitName });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revert valuation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="h-4 w-4 text-primary" />
              Benefit Valuation
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Define your own valuation for this benefit across all cards in your workspace.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4 text-xs">
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3 space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Benefit
              </span>
              <p className="font-semibold text-foreground text-sm leading-snug">{benefitName}</p>
              {(benefitType || benefitProvider) && (
                <p className="text-muted-foreground text-[11px]">
                  {[benefitType, benefitProvider].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between px-1 text-xs">
              <span className="text-muted-foreground">RuPay Catalog Nominal Value:</span>
              <span className="font-semibold text-foreground">
                {catalogDefaultValue != null ? formatMoney(catalogDefaultValue) : 'Not specified'}
              </span>
            </div>

            <div className="space-y-1.5 pt-1">
              <Label htmlFor="custom-val-input" className="text-xs font-medium">
                My Valuation (₹)
              </Label>
              <div className="relative">
                <IndianRupee className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  id="custom-val-input"
                  type="number"
                  step="0.01"
                  min="0"
                  className="pl-8 h-9 text-xs"
                  placeholder={catalogDefaultValue != null ? String(catalogDefaultValue) : 'e.g. 200'}
                  value={val}
                  onChange={(e) => setVal(e.target.value)}
                  autoFocus
                  required
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter className="flex-row items-center justify-between sm:justify-between gap-2">
            {customDefaultValue != null ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={handleRevert}
                disabled={busy}
              >
                <Undo2 className="h-3 w-3" /> Revert to Catalog
              </Button>
            ) : (
              <div />
            )}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" className="h-8 text-xs font-medium" disabled={busy}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
