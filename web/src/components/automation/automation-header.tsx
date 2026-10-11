'use client';

import { useState } from 'react';
import {
  Bot,
  PauseCircle,
  PlayCircle,
  Clock,
  AlertTriangle,
  Phone,
  Send,
  Loader2,
  CheckCircle2,
  ExternalLink,
  Play,
  BellRing,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  saveAutomationSettingsAction,
  sendTestTelegramMessageAction,
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
  whatsappPhoneNumber,
  telegramChatId,
  updatedAt,
  hasAttentionAccounts,
  nextRun,
}: {
  enabled: boolean;
  whatsappPhoneNumber?: string | null;
  telegramChatId?: string | null;
  updatedAt: string;
  hasAttentionAccounts: boolean;
  nextRun?: NextRunView;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Channels Dialog State
  const [channelsDialogOpen, setChannelsDialogOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState(whatsappPhoneNumber ?? '');
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneSavedFeedback, setPhoneSavedFeedback] = useState<string | null>(null);

  const [telegramInput, setTelegramInput] = useState(telegramChatId ?? '');
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [telegramTestFeedback, setTelegramTestFeedback] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

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

  async function handleSavePhone(e: React.FormEvent) {
    e.preventDefault();
    setSavingPhone(true);
    setError(null);
    setPhoneSavedFeedback(null);
    try {
      await saveAutomationSettingsAction({ whatsappPhoneNumber: phoneInput.trim() || null });
      setPhoneSavedFeedback('WhatsApp phone number saved successfully!');
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
      await saveAutomationSettingsAction({ telegramChatId: telegramInput.trim() || null });
      setTelegramTestFeedback({
        success: true,
        message: 'Telegram Chat ID saved successfully!',
      });
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

  const updatedDateStr = new Date(updatedAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

  // Dynamic next run schedule description and badge
  let scheduleDescription: React.ReactNode = null;
  let scheduleBadge: React.ReactNode = null;

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
    const scheduleLabel = isToday ? `Today at ${timeStr} IST` : `${dateStr} at ${timeStr} IST`;

    if (nextRunDate > now) {
      scheduleBadge = (
        <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] font-semibold gap-1">
          <Clock className="h-3 w-3" />
          Next unlock: {scheduleLabel}
        </Badge>
      );

      scheduleDescription = (
        <>
          Next run scheduled: <span className="font-semibold text-foreground">{scheduleLabel}</span> (when {nextRun.accountLabel} unlocks).
        </>
      );
    }
  }

  if (!scheduleDescription) {
    if (!enabled) {
      scheduleDescription = (
        <>Automation is currently paused. Enable automation to resume scheduled daily ordering.</>
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
  }

  const hasAnyOtpChannel = Boolean(telegramChatId || whatsappPhoneNumber);

  return (
    <div className="space-y-4">
      {/* Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-border/80 bg-gradient-to-r from-card via-card to-muted/20 p-5 shadow-xs">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight text-foreground">Automated RuPay Ordering</h1>
                <Badge variant={enabled ? 'default' : 'secondary'} className="text-[11px] font-semibold">
                  {enabled ? 'Active' : 'Paused'}
                </Badge>
                {scheduleBadge}
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5 flex-wrap">
                <Clock className="h-3.5 w-3.5 text-muted-foreground/80 shrink-0" />
                <span>{scheduleDescription}</span>
                <span className="text-muted-foreground/50 text-[11px]">• Updated {updatedDateStr}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
          {/* Unified OTP Channels Dialog */}
          <Dialog open={channelsDialogOpen} onOpenChange={setChannelsDialogOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs font-semibold gap-1.5 border-border/80"
              >
                <BellRing className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
                OTP Channels
                {hasAnyOtpChannel ? (
                  <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500" title="OTP channel connected" />
                ) : (
                  <span className="flex h-1.5 w-1.5 rounded-full bg-amber-500" title="No OTP channel connected" />
                )}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <BellRing className="h-5 w-5 text-primary" />
                  3DS Bank OTP Delivery Channels
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground leading-relaxed">
                  Automated voucher checkouts require 3D-Secure bank OTP verification. Connect your preferred channel to receive instant prompts and reply with your 6-digit OTP.
                </DialogDescription>
              </DialogHeader>

              <Tabs defaultValue="telegram" className="w-full pt-1">
                <TabsList className="grid grid-cols-2 w-full mb-3 h-9">
                  <TabsTrigger value="telegram" className="gap-1.5 text-xs font-semibold">
                    <Send className="h-3.5 w-3.5 text-sky-500" />
                    <span>Telegram Bot</span>
                    {telegramChatId && (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 ml-1">✓</span>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="whatsapp" className="gap-1.5 text-xs font-semibold">
                    <Phone className="h-3.5 w-3.5 text-emerald-500" />
                    <span>WhatsApp</span>
                    {whatsappPhoneNumber && (
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 ml-1">✓</span>
                    )}
                  </TabsTrigger>
                </TabsList>

                {/* Telegram Tab */}
                <TabsContent value="telegram" className="space-y-4 focus-visible:outline-none">
                  <form onSubmit={handleSaveTelegram} className="space-y-4">
                    <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-xs">
                      <p className="font-semibold text-foreground flex items-center gap-1.5">
                        <Send className="h-3.5 w-3.5 text-sky-500" />
                        Free, Instant, and Interactive Telegram Setup:
                      </p>
                      <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
                        <li>
                          Open Telegram and search for{' '}
                          <a
                            href="https://t.me/rupay_tracker_bot"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-primary inline-flex items-center gap-0.5 hover:underline"
                          >
                            @rupay_tracker_bot
                            <ExternalLink className="h-3 w-3 inline" />
                          </a>{' '}
                          or type <code>/start</code>.
                        </li>
                        <li>
                          The bot replies with your unique <strong>Telegram Chat ID</strong> (e.g. <code>1647769921</code>).
                        </li>
                        <li>Paste that Chat ID below and click Save.</li>
                      </ol>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="telegram-chat-id" className="text-xs font-medium">
                        Telegram Chat ID
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="telegram-chat-id"
                          type="text"
                          placeholder="e.g. 1647769921"
                          value={telegramInput}
                          onChange={(e) => setTelegramInput(e.target.value)}
                          className="font-mono text-sm"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleSendTestTelegram()}
                          disabled={testingTelegram || (!telegramInput && !telegramChatId)}
                          className="shrink-0 gap-1.5 text-xs font-semibold"
                        >
                          {testingTelegram ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Send className="h-3.5 w-3.5 text-sky-500" />
                          )}
                          Test Message
                        </Button>
                      </div>
                    </div>

                    {telegramTestFeedback && (
                      <div
                        className={`rounded-lg p-2.5 text-xs flex items-center gap-2 ${
                          telegramTestFeedback.success
                            ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30'
                            : 'bg-destructive/10 text-destructive border border-destructive/30'
                        }`}
                      >
                        {telegramTestFeedback.success ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                        )}
                        <span>{telegramTestFeedback.message}</span>
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-1 border-t border-border/50">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setChannelsDialogOpen(false)}
                      >
                        Close
                      </Button>
                      <Button
                        type="submit"
                        variant="default"
                        size="sm"
                        disabled={savingTelegram}
                        className="gap-1.5 text-xs font-semibold"
                      >
                        {savingTelegram ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Save Telegram Chat ID
                      </Button>
                    </div>
                  </form>
                </TabsContent>

                {/* WhatsApp Tab */}
                <TabsContent value="whatsapp" className="space-y-4 focus-visible:outline-none">
                  <form onSubmit={handleSavePhone} className="space-y-4">
                    <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-xs text-muted-foreground">
                      <p className="font-semibold text-foreground flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 text-emerald-500" />
                        WhatsApp Business OTP Prompt
                      </p>
                      <p>
                        During checkout, an OTP prompt is sent via WhatsApp to this phone number. Replying with the 6-digit OTP completes the purchase.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="whatsapp-phone" className="text-xs font-medium">
                        WhatsApp Phone Number (with country code)
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

                    {phoneSavedFeedback && (
                      <div className="rounded-lg p-2.5 text-xs flex items-center gap-2 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span>{phoneSavedFeedback}</span>
                      </div>
                    )}

                    <div className="flex justify-end gap-2 pt-1 border-t border-border/50">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setChannelsDialogOpen(false)}
                      >
                        Close
                      </Button>
                      <Button
                        type="submit"
                        variant="default"
                        size="sm"
                        disabled={savingPhone}
                        className="gap-1.5 text-xs font-semibold"
                      >
                        {savingPhone ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        Save Phone Number
                      </Button>
                    </div>
                  </form>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>

          {/* Run Order Now Button */}
          <Button
            variant="outline"
            size="sm"
            disabled={triggeringOrder || busy}
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
      </div>

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
