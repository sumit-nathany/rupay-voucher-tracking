'use client';

import { useState } from 'react';
import { Bot, PauseCircle, PlayCircle, Clock, AlertTriangle, MessageSquare, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { saveAutomationSettingsAction } from '@/actions/automation';

export interface NextRunView {
  eligibleNow: boolean;
  nextRunAt: string | null;
  accountLabel: string | null;
  reason: 'ready_now' | 'waiting_for_cooldown' | 'no_accounts' | 'automation_paused';
}

export function AutomationHeader({
  enabled,
  whatsappPhoneNumber,
  updatedAt,
  hasAttentionAccounts,
  nextRun,
}: {
  enabled: boolean;
  whatsappPhoneNumber?: string | null;
  updatedAt: string;
  hasAttentionAccounts: boolean;
  nextRun?: NextRunView;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState(whatsappPhoneNumber ?? '');
  const [savingPhone, setSavingPhone] = useState(false);

  async function handleToggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      await saveAutomationSettingsAction({ enabled: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update automation settings');
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePhone(e: React.FormEvent) {
    e.preventDefault();
    setSavingPhone(true);
    setError(null);
    try {
      await saveAutomationSettingsAction({ whatsappPhoneNumber: phoneInput });
      setPhoneDialogOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save WhatsApp number');
    } finally {
      setSavingPhone(false);
    }
  }

  const updatedDateStr = new Date(updatedAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

  // Format dynamic next run schedule
  let scheduleDescription: React.ReactNode = null;
  let scheduleBadge: React.ReactNode = null;

  if (!enabled) {
    scheduleDescription = (
      <>Automation is paused. Toggle on to enable scheduled automatic ordering.</>
    );
  } else if (nextRun?.reason === 'waiting_for_cooldown' && nextRun.nextRunAt) {
    const nextRunDate = new Date(nextRun.nextRunAt);
    const now = new Date();
    const isToday = nextRunDate.toDateString() === now.toDateString();
    const timeStr = nextRunDate.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
    const dateStr = nextRunDate.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    });
    const scheduleLabel = isToday ? `Today at ${timeStr} IST` : `${dateStr} at ${timeStr} IST`;

    scheduleBadge = (
      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-semibold gap-1">
        <Clock className="h-3 w-3" />
        Next run: {scheduleLabel}
      </Badge>
    );

    scheduleDescription = (
      <>
        Next run scheduled: <span className="font-semibold text-foreground">{scheduleLabel}</span> (when {nextRun.accountLabel} unlocks). Max 1 order per account per 24 hours.
      </>
    );
  } else if (nextRun?.reason === 'ready_now') {
    scheduleBadge = (
      <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold gap-1">
        <Clock className="h-3 w-3" />
        Eligible to run now
      </Badge>
    );
    scheduleDescription = (
      <>
        Ready to run now (<span className="font-semibold text-foreground">{nextRun.accountLabel}</span> eligible). Default daily schedule: 02:00 AM IST.
      </>
    );
  } else {
    scheduleDescription = (
      <>Scheduled daily at 02:00 AM IST (Asia/Kolkata). Max 1 order per portal account per 24 hours.</>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card to-muted/30 p-5 shadow-xs">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight text-foreground">Automated RuPay Ordering</h1>
                <Badge variant={enabled ? 'default' : 'secondary'} className="text-[11px] font-semibold">
                  {enabled ? 'Active' : 'Paused'}
                </Badge>
                {scheduleBadge}
                {whatsappPhoneNumber ? (
                  <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold gap-1">
                    <Phone className="h-3 w-3" />
                    WhatsApp OTP: {whatsappPhoneNumber}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-semibold gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    No WhatsApp OTP Phone
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
                <Clock className="h-3.5 w-3.5 text-muted-foreground/80 shrink-0" />
                <span>{scheduleDescription}</span>
                <span className="text-muted-foreground/60">(Updated {updatedDateStr})</span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Dialog open={phoneDialogOpen} onOpenChange={setPhoneDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs font-semibold gap-1.5 border-border/80"
              >
                <Phone className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                {whatsappPhoneNumber ? 'Change WhatsApp Phone' : 'Set WhatsApp OTP Phone'}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <form onSubmit={handleSavePhone} className="space-y-4">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    Workspace WhatsApp OTP Number
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                    Automated checkouts require 3D-Secure bank OTP verification. During checkout, an OTP prompt is sent via WhatsApp to this workspace owner phone number. Replying with the 6-digit OTP completes the purchase automatically.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-2 py-2">
                  <Label htmlFor="whatsapp-phone" className="text-xs font-medium">
                    Phone Number (with country code)
                  </Label>
                  <Input
                    id="whatsapp-phone"
                    type="tel"
                    placeholder="+919876543210"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Example: <code className="text-foreground font-mono">+919876543210</code>. Leave blank to disable WhatsApp OTP prompts.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setPhoneDialogOpen(false)}
                    disabled={savingPhone}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="default"
                    size="sm"
                    disabled={savingPhone}
                    className="gap-1.5"
                  >
                    {savingPhone ? 'Saving...' : 'Save Phone Number'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          {enabled ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void handleToggle(false)}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive h-9 text-xs font-semibold gap-1.5"
            >
              <PauseCircle className="h-4 w-4" />
              Pause All Automation
            </Button>
          ) : (
            <Button
              variant="default"
              disabled={busy}
              onClick={() => void handleToggle(true)}
              className="h-9 text-xs font-semibold gap-1.5"
            >
              <PlayCircle className="h-4 w-4" />
              Enable Automation
            </Button>
          )}
        </div>
      </div>

      {hasAttentionAccounts && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-sm">Action Required on RuPay Portal</p>
            <p className="text-muted-foreground/90">
              One or more accounts require verification, credential updates, or manual reconciliation of uncertain bookings.
              Review the notices below before automatic ordering resumes for those accounts.
            </p>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
