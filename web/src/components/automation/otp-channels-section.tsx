'use client';

import { useState } from 'react';
import {
  Send,
  Phone,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  saveAutomationSettingsAction,
  sendTestTelegramMessageAction,
} from '@/actions/automation';

const SHOW_WHATSAPP = false;

export function OtpChannelsSection({
  whatsappPhoneNumber,
  telegramChatId,
}: {
  whatsappPhoneNumber?: string | null;
  telegramChatId?: string | null;
}) {
  // Telegram State
  const [telegramInput, setTelegramInput] = useState(telegramChatId ?? '');
  const [savingTelegram, setSavingTelegram] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [telegramFeedback, setTelegramFeedback] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // WhatsApp State
  const [phoneInput, setPhoneInput] = useState(whatsappPhoneNumber ?? '');
  const [savingPhone, setSavingPhone] = useState(false);
  const [phoneFeedback, setPhoneFeedback] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  async function handleSaveTelegram(e: React.FormEvent) {
    e.preventDefault();
    setSavingTelegram(true);
    setTelegramFeedback(null);
    try {
      await saveAutomationSettingsAction({ telegramChatId: telegramInput.trim() || null });
      setTelegramFeedback({
        success: true,
        message: 'Telegram Chat ID saved successfully!',
      });
    } catch (e) {
      setTelegramFeedback({
        success: false,
        message: e instanceof Error ? e.message : 'Failed to save Telegram Chat ID',
      });
    } finally {
      setSavingTelegram(false);
    }
  }

  async function handleSendTestTelegram() {
    setTestingTelegram(true);
    setTelegramFeedback(null);
    try {
      const res = await sendTestTelegramMessageAction({ chatId: telegramInput || undefined });
      if (res.success) {
        setTelegramFeedback({
          success: true,
          message: 'Test message sent! Check your Telegram chat.',
        });
      } else {
        setTelegramFeedback({
          success: false,
          message: res.error || 'Failed to send Telegram test message.',
        });
      }
    } catch (e) {
      setTelegramFeedback({
        success: false,
        message: e instanceof Error ? e.message : 'Error sending test message.',
      });
    } finally {
      setTestingTelegram(false);
    }
  }

  async function handleSavePhone(e: React.FormEvent) {
    e.preventDefault();
    setSavingPhone(true);
    setPhoneFeedback(null);
    try {
      await saveAutomationSettingsAction({ whatsappPhoneNumber: phoneInput.trim() || null });
      setPhoneFeedback({
        success: true,
        message: 'WhatsApp phone number saved successfully!',
      });
    } catch (e) {
      setPhoneFeedback({
        success: false,
        message: e instanceof Error ? e.message : 'Failed to save WhatsApp number',
      });
    } finally {
      setSavingPhone(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Telegram OTP Card */}
      <div className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-xs space-y-4">
        {/* Header row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-sky-500">
              <Send className="h-5 w-5" />
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-base sm:text-lg text-foreground">
                  Telegram OTP Delivery
                </h3>
                {telegramChatId ? (
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs gap-1 py-0.5 font-normal">
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs py-0.5 font-normal">
                    Not configured
                  </Badge>
                )}
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Receive 3D-Secure bank OTP prompts and reply with your 6-digit code.
              </p>
            </div>
          </div>
        </div>

        {/* Quick setup hint */}
        <div className="rounded-xl border border-border/60 bg-muted/40 px-3.5 py-2 text-xs text-muted-foreground flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-3">
          <span className="flex items-center gap-1.5 flex-wrap">
            <span>1. Message</span>
            <a
              href="https://t.me/rupay_tracker_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline hover:text-primary inline-flex items-center gap-0.5"
            >
              @rupay_tracker_bot
              <ExternalLink className="h-3 w-3 inline" />
            </a>
            <span>or send <code className="bg-background px-1 py-0.2 rounded text-[11px] font-mono border">/start</code></span>
          </span>
          <span className="text-muted-foreground/90">2. Copy your Chat ID & save below</span>
        </div>

        {/* Form: Unified input + actions in one clean row */}
        <form onSubmit={handleSaveTelegram} className="space-y-2.5">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Input
                id="telegram-chat-id"
                type="text"
                placeholder="Enter Telegram Chat ID (e.g. 1647769921)"
                value={telegramInput}
                onChange={(e) => setTelegramInput(e.target.value)}
                className="text-sm h-9 rounded-xl"
              />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                type="submit"
                size="sm"
                disabled={savingTelegram || telegramInput === (telegramChatId ?? '')}
                className="h-9 px-4 rounded-xl text-xs font-semibold gap-1.5"
              >
                {savingTelegram && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleSendTestTelegram()}
                disabled={testingTelegram || (!telegramInput && !telegramChatId)}
                className="h-9 px-3.5 rounded-xl text-xs font-medium gap-1.5"
              >
                {testingTelegram ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5 text-sky-500" />
                )}
                Send Test
              </Button>
            </div>
          </div>

          {telegramFeedback && (
            <div
              className={`rounded-xl px-3 py-2 text-xs flex items-center gap-2 ${
                telegramFeedback.success
                  ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30'
                  : 'bg-destructive/10 text-destructive border border-destructive/30'
              }`}
            >
              {telegramFeedback.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <span>{telegramFeedback.message}</span>
            </div>
          )}
        </form>
      </div>

      {/* WhatsApp Card (hidden via SHOW_WHATSAPP) */}
      {SHOW_WHATSAPP && (
        <div className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
              <Phone className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-foreground">WhatsApp Delivery</h3>
              <p className="text-xs text-muted-foreground">Direct WhatsApp notification to phone</p>
            </div>
          </div>
          <form onSubmit={handleSavePhone} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="whatsapp-phone" className="text-xs font-medium">Phone Number</Label>
              <div className="flex gap-2">
                <Input
                  id="whatsapp-phone"
                  type="tel"
                  placeholder="+919876543210"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  className="text-sm h-9 rounded-xl flex-1"
                />
                <Button type="submit" size="sm" disabled={savingPhone} className="h-9 px-4 rounded-xl text-xs font-semibold">
                  {savingPhone && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save
                </Button>
              </div>
            </div>
            {phoneFeedback && (
              <p className="text-xs text-muted-foreground">{phoneFeedback.message}</p>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
