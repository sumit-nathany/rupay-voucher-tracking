'use client';

import { useState } from 'react';
import { Bot, PauseCircle, PlayCircle, Clock, AlertTriangle, MessageSquare, Phone, Send, Loader2, CheckCircle2, ExternalLink } from 'lucide-react';
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
import { saveAutomationSettingsAction, sendTestTelegramMessageAction } from '@/actions/automation';

export interface NextRunView {
  eligibleNow: boolean;
  nextRunAt: string | null;
  accountLabel: string | null;
  reason: 'ready_now' | 'waiting_for_cooldown' | 'no_accounts' | 'automation_paused';
}

export function AutomationHeader({
  enabled,
  whatsappPhoneNumber,
  telegramChatId,
  workspaceId,
  updatedAt,
  hasAttentionAccounts,
  nextRun,
}: {
  enabled: boolean;
  whatsappPhoneNumber?: string | null;
  telegramChatId?: string | null;
  workspaceId?: string;
  updatedAt: string;
  hasAttentionAccounts: boolean;
  nextRun?: NextRunView;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phoneDialogOpen, setPhoneDialogOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState(whatsappPhoneNumber ?? '');
  const [savingPhone, setSavingPhone] = useState(false);

  const [telegramDialogOpen, setTelegramDialogOpen] = useState(false);
  const [telegramInput, setTelegramInput] = useState(telegramChatId ?? '');
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [telegramTestFeedback, setTelegramTestFeedback] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

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

  async function handleSaveTelegram(e: React.FormEvent) {
    e.preventDefault();
    setSavingTelegram(true);
    setError(null);
    try {
      await saveAutomationSettingsAction({ telegramChatId: telegramInput });
      setTelegramDialogOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save Telegram Chat ID');
    } finally {
      setSavingTelegram(false);
    }
  }

  async function handleSendTestTelegram() {
    setTestingTelegram(true);
    setTelegramTestFeedback(null);
    try {
      const res = await sendTestTelegramMessageAction({ chatId: telegramInput || undefined });
      if (res.success) {
        setTelegramTestFeedback({
          success: true,
          message: 'Test message sent! Check your Telegram chat.',
        });
      } else {
        setTelegramTestFeedback({
          success: false,
          message: res.error || 'Failed to send Telegram test message.',
        });
      }
    } catch (e) {
      setTelegramTestFeedback({
        success: false,
        message: e instanceof Error ? e.message : 'Error sending test message.',
      });
    } finally {
      setTestingTelegram(false);
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
                {telegramChatId ? (
                  <Badge variant="outline" className="border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 text-[10px] font-semibold gap-1">
                    <Send className="h-3 w-3" />
                    Telegram OTP: {telegramChatId}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="border-slate-500/40 bg-slate-500/10 text-slate-700 dark:text-slate-300 text-[10px] font-semibold gap-1">
                    <Send className="h-3 w-3" />
                    No Telegram OTP
                  </Badge>
                )}
                {whatsappPhoneNumber && (
                  <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-[10px] font-semibold gap-1">
                    <Phone className="h-3 w-3" />
                    WhatsApp OTP: {whatsappPhoneNumber}
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
          {/* Telegram Setup & Test Dialog */}
          <Dialog open={telegramDialogOpen} onOpenChange={setTelegramDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs font-semibold gap-1.5 border-border/80"
              >
                <Send className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                {telegramChatId ? 'Telegram Bot (Connected)' : 'Set Up Telegram OTP'}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <form onSubmit={handleSaveTelegram} className="space-y-4">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Send className="h-5 w-5 text-sky-600 dark:text-sky-400" />
                    Telegram Bot OTP Integration
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                    100% free, unlimited, and instant. When an automated voucher booking triggers a 3D-Secure bank OTP, the prompt is delivered to your Telegram chat. Replying with the 6-digit OTP completes the purchase automatically.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 py-2 text-xs">
                  <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                    <p className="font-semibold text-foreground">How to connect:</p>
                    <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
                      <li>
                        Open{' '}
                        <a
                          href={workspaceId ? `https://t.me/rupay_tracker_bot?start=${workspaceId}` : 'https://t.me/rupay_tracker_bot'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1"
                        >
                          @rupay_tracker_bot
                          <ExternalLink className="h-3 w-3 inline" />
                        </a>{' '}
                        and tap <span className="font-medium text-foreground">Start</span> to auto-link your workspace.
                      </li>
                      <li>Or find your Telegram Chat ID (e.g. from <span className="text-foreground font-medium">@userinfobot</span>)</li>
                      <li>Paste your Chat ID below and click Save.</li>
                    </ol>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="telegram-chat-id" className="text-xs font-medium">
                      Your Telegram Chat ID
                    </Label>
                    <Input
                      id="telegram-chat-id"
                      type="text"
                      placeholder="e.g. 123456789"
                      value={telegramInput}
                      onChange={(e) => {
                        setTelegramInput(e.target.value);
                        setTelegramTestFeedback(null);
                      }}
                      className="font-mono text-sm"
                    />
                  </div>

                  {telegramTestFeedback && (
                    <div
                      className={`p-2.5 rounded-lg text-xs flex items-start gap-2 ${
                        telegramTestFeedback.success
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                          : 'bg-destructive/10 text-destructive border border-destructive/30'
                      }`}
                    >
                      {telegramTestFeedback.success ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      )}
                      <span>{telegramTestFeedback.message}</span>
                    </div>
                  )}
                </div>

                <div className="flex justify-between items-center gap-2 pt-2 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSendTestTelegram}
                    disabled={testingTelegram || !telegramInput.trim()}
                    className="gap-1.5 text-xs"
                  >
                    {testingTelegram ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Send Test Message
                  </Button>

                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setTelegramDialogOpen(false)}
                      disabled={savingTelegram}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="default"
                      size="sm"
                      disabled={savingTelegram}
                      className="gap-1.5"
                    >
                      {savingTelegram ? 'Saving...' : 'Save Chat ID'}
                    </Button>
                  </div>
                </div>
              </form>
            </DialogContent>
          </Dialog>

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
