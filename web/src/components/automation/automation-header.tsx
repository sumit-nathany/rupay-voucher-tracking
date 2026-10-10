'use client';

import { useState } from 'react';
import { Bot, PauseCircle, PlayCircle, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { saveAutomationSettingsAction } from '@/actions/automation';

export function AutomationHeader({
  enabled,
  updatedAt,
  hasAttentionAccounts,
}: {
  enabled: boolean;
  updatedAt: string;
  hasAttentionAccounts: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const updatedDateStr = new Date(updatedAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card to-muted/30 p-5 shadow-xs">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-foreground">Automated RuPay Ordering</h1>
                <Badge variant={enabled ? 'default' : 'secondary'} className="text-[11px] font-semibold">
                  {enabled ? 'Active' : 'Paused'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground/80" />
                Scheduled daily at 02:00 AM IST (Asia/Kolkata). Max 1 order per portal account per 24 hours. (Settings updated: {updatedDateStr})
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
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
