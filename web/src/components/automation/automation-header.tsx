'use client';

import { useState } from 'react';
import {
  PauseCircle,
  PlayCircle,
  Clock,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  Play,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/layout/page-header';
import {
  saveAutomationSettingsAction,
  triggerManualOrderAction,
} from '@/actions/automation';

export interface NextRunView {
  eligibleNow: boolean;
  nextRunAt: string | null;
  accountLabel: string | null;
  reason: 'ready_now' | 'waiting_for_cooldown' | 'no_accounts' | 'automation_paused';
}

export function AutomationHeader({
  enabled,
  hasAttentionAccounts,
  nextRun,
}: {
  enabled: boolean;
  hasAttentionAccounts: boolean;
  nextRun?: NextRunView;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Manual Trigger State
  const [triggeringOrder, setTriggeringOrder] = useState(false);
  const [triggerFeedback, setTriggerFeedback] = useState<string | null>(null);

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

  async function handleRunOrderNow() {
    setTriggeringOrder(true);
    setTriggerFeedback(null);
    try {
      await triggerManualOrderAction();
      setTriggerFeedback('⚡ Order run requested! The worker daemon will execute immediately. Watch your Telegram for any 3DS bank OTP prompt.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to trigger automated order');
    } finally {
      setTriggeringOrder(false);
    }
  }

  const isCooldownActive = Boolean(
    nextRun?.nextRunAt && new Date(nextRun.nextRunAt) > new Date(),
  );

  let formattedUnlockLabel: string | null = null;
  if (nextRun?.nextRunAt) {
    const nextRunDate = new Date(nextRun.nextRunAt);
    const now = new Date();
    const isToday = nextRunDate.toDateString() === now.toDateString();
    const timeStr = nextRunDate.toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });
    const dateStr = nextRunDate.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Kolkata',
    });
    formattedUnlockLabel = isToday ? `Today at ${timeStr} IST` : `${dateStr} at ${timeStr} IST`;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Automation"
        title="Automated Ordering"
        description="Daily unattended voucher ordering across portal accounts, cards, and priority rules."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Run Order Now Action */}
            <Button
              variant="outline"
              size="sm"
              disabled={triggeringOrder || busy || !enabled}
              onClick={() => void handleRunOrderNow()}
              className="h-9 text-xs font-semibold gap-1.5 border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary"
              title="Trigger an automated order run immediately"
            >
              {triggeringOrder ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 fill-current" />
              )}
              Run Order Now
            </Button>

            {/* Toggle Automation Button */}
            {enabled ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void handleToggle(false)}
                className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive h-9 text-xs font-semibold gap-1.5"
              >
                <PauseCircle className="h-4 w-4" />
                Pause Automation
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                disabled={busy}
                onClick={() => void handleToggle(true)}
                className="h-9 text-xs font-semibold gap-1.5"
              >
                <PlayCircle className="h-4 w-4" />
                Enable Automation
              </Button>
            )}
          </div>
        }
      />

      {/* Schedule / Cooldown Status Strip */}
      {isCooldownActive && formattedUnlockLabel ? (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-700 dark:text-amber-300 shrink-0">
              <Clock className="h-4 w-4" />
            </div>
            <div>
              <span className="font-semibold text-foreground">
                Next eligible run: {formattedUnlockLabel}
              </span>
              <span className="text-muted-foreground ml-1.5 hidden sm:inline">
                (Waiting for {nextRun?.accountLabel} 24h portal cooldown)
              </span>
            </div>
          </div>
          <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200 text-[10px] font-semibold self-start sm:self-auto">
            Cooldown active
          </Badge>
        </div>
      ) : !enabled ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <PauseCircle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>Automation is currently paused. Scheduled orders are suspended until resumed.</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void handleToggle(true)} className="h-7 text-xs bg-background">
            Resume
          </Button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-border/80 bg-muted/20 px-4 py-2.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
            <span>
              Automation active •{' '}
              {nextRun?.reason === 'ready_now'
                ? `Ready to order (${nextRun.accountLabel} eligible)`
                : 'Scheduled daily at 02:00 AM IST'}
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground/80">Max 1 order / account / 24h</span>
        </div>
      )}

      {/* Instant Feedback / Notification Banners */}
      {triggerFeedback && (
        <div className="flex items-start gap-3 rounded-xl border border-sky-500/40 bg-sky-500/10 p-4 text-sky-900 dark:text-sky-200">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-sky-600 dark:text-sky-400 mt-0.5" />
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-sm">Order Run Triggered</p>
            <p className="text-muted-foreground/90">{triggerFeedback}</p>
          </div>
        </div>
      )}

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
