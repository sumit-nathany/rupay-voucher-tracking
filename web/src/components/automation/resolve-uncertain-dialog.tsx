'use client';

import { useState } from 'react';
import { AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { AttemptView } from '@/domain/automation';
import { resolveUncertainAttemptAction } from '@/actions/automation';

export function ResolveUncertainDialog({
  attempt,
  open,
  onOpenChange,
}: {
  attempt: AttemptView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookingRef, setBookingRef] = useState('');
  const [resolutionMode, setResolutionMode] = useState<'confirmed' | 'resolved_no_order'>('confirmed');

  if (!attempt) return null;

  async function handleConfirm() {
    if (!attempt) return;
    if (resolutionMode === 'confirmed' && !bookingRef.trim()) {
      setError('Please provide the portal booking reference ID');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await resolveUncertainAttemptAction({
        attemptId: attempt.id,
        resolution: resolutionMode,
        bookingReference: resolutionMode === 'confirmed' ? bookingRef.trim() : null,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve attempt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-5 w-5" />
            <DialogTitle>Reconcile Uncertain Order</DialogTitle>
          </div>
          <DialogDescription>
            An automated submission reached the portal for <strong>{attempt.benefitName}</strong> ({attempt.cardName}), but the connection timed out or closed before receiving a confirmation response.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2 text-xs">
          <div className="rounded-xl border border-border/80 bg-muted/30 p-3 space-y-1.5">
            <p className="font-semibold text-foreground">Action Required:</p>
            <p className="text-muted-foreground">
              Please log in to your RuPay Benefits portal account (<strong>{attempt.portalAccountLabel}</strong>) and verify if an order was placed under your booking history.
            </p>
          </div>

          <div className="space-y-2">
            <Label className="font-semibold text-foreground">What did you find on the portal?</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setResolutionMode('confirmed')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                  resolutionMode === 'confirmed'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold'
                    : 'border-border/80 bg-card text-muted-foreground hover:bg-muted/30'
                }`}
              >
                <CheckCircle2 className="h-5 w-5 mb-1 text-emerald-600 dark:text-emerald-400" />
                <span>Booking was created</span>
              </button>

              <button
                type="button"
                onClick={() => setResolutionMode('resolved_no_order')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                  resolutionMode === 'resolved_no_order'
                    ? 'border-primary bg-primary/10 text-primary font-semibold'
                    : 'border-border/80 bg-card text-muted-foreground hover:bg-muted/30'
                }`}
              >
                <XCircle className="h-5 w-5 mb-1" />
                <span>No booking exists</span>
              </button>
            </div>
          </div>

          {resolutionMode === 'confirmed' && (
            <div className="space-y-1.5 pt-1">
              <Label htmlFor="booking-ref" className="font-semibold">
                Portal Booking / Reference ID
              </Label>
              <Input
                id="booking-ref"
                placeholder="e.g. BK12345678"
                value={bookingRef}
                onChange={(e) => setBookingRef(e.target.value)}
                className="h-9 font-mono text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                This will mark the benefit instance as &quot;Ordered but Coupon not received&quot;.
              </p>
            </div>
          )}

          {resolutionMode === 'resolved_no_order' && (
            <p className="text-muted-foreground bg-muted/20 p-2.5 rounded-lg border border-border/40">
              The instance will remain <strong>Not Ordered</strong> and eligible for future automated runs after the 24-hour account cooldown.
            </p>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2 border-t border-border/60">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy} className="h-8 text-xs font-semibold">
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleConfirm()} disabled={busy} className="h-8 text-xs font-semibold">
              Confirm Resolution
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
