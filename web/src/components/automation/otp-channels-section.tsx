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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  saveAutomationSettingsAction,
  sendTestTelegramMessageAction,
} from '@/actions/automation';

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
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">
          3DS Bank OTP Delivery Channels
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Automated voucher checkouts require 3D-Secure bank OTP verification. Connect your preferred channel to receive instant prompts and reply with your 6-digit OTP.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-1">
        {/* Telegram Card */}
        <Card className="rounded-2xl border border-border/70 shadow-xs flex flex-col justify-between">
          <div>
            <CardHeader className="p-5 sm:p-6 pb-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-500 shrink-0">
                    <Send className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base sm:text-lg font-semibold">Telegram Bot</CardTitle>
                    <CardDescription className="text-xs sm:text-sm text-muted-foreground mt-0.5">Interactive, 2-way real-time OTP reply</CardDescription>
                  </div>
                </div>
                {telegramChatId ? (
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-normal gap-1 py-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs font-normal py-1">
                    Not configured
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-5 sm:p-6 pt-0 space-y-5">
              <div className="rounded-2xl border bg-muted/30 p-4 space-y-2.5 text-xs sm:text-sm">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <Send className="h-4 w-4 text-sky-500" />
                  Setup in 30 Seconds:
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground leading-relaxed">
                  <li>
                    Open Telegram and message{' '}
                    <a
                      href="https://t.me/rupay_tracker_bot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-primary inline-flex items-center gap-0.5 hover:underline"
                    >
                      @rupay_tracker_bot
                      <ExternalLink className="h-3 w-3 inline" />
                    </a>{' '}
                    or send <code>/start</code>.
                  </li>
                  <li>
                    The bot replies with your unique <strong>Telegram Chat ID</strong> (e.g. <code>1647769921</code>).
                  </li>
                  <li>Paste that Chat ID below and save.</li>
                </ol>
              </div>

              <form onSubmit={handleSaveTelegram} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="telegram-chat-id" className="text-sm font-medium">
                    Telegram Chat ID
                  </Label>
                  <div className="flex gap-2.5">
                    <Input
                      id="telegram-chat-id"
                      type="text"
                      placeholder="e.g. 1647769921"
                      value={telegramInput}
                      onChange={(e) => setTelegramInput(e.target.value)}
                      className="text-sm h-10 rounded-xl"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleSendTestTelegram()}
                      disabled={testingTelegram || (!telegramInput && !telegramChatId)}
                      className="shrink-0 gap-1.5 text-xs sm:text-sm font-medium h-10 px-4 rounded-xl"
                    >
                      {testingTelegram ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4 text-sky-500" />
                      )}
                      Test Message
                    </Button>
                  </div>
                </div>

                {telegramFeedback && (
                  <div
                    className={`rounded-xl p-3 text-xs sm:text-sm flex items-center gap-2.5 ${
                      telegramFeedback.success
                        ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30'
                        : 'bg-destructive/10 text-destructive border border-destructive/30'
                    }`}
                  >
                    {telegramFeedback.success ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                    )}
                    <span>{telegramFeedback.message}</span>
                  </div>
                )}

                <div className="pt-2 flex justify-end">
                  <Button
                    type="submit"
                    disabled={savingTelegram}
                    className="gap-2 text-sm font-medium h-10 px-4 rounded-xl"
                  >
                    {savingTelegram ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save Telegram Chat ID
                  </Button>
                </div>
              </form>
            </CardContent>
          </div>
        </Card>

        {/* WhatsApp Card */}
        <Card className="rounded-2xl border border-border/70 shadow-xs flex flex-col justify-between">
          <div>
            <CardHeader className="p-5 sm:p-6 pb-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3.5">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500 shrink-0">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base sm:text-lg font-semibold">WhatsApp Delivery</CardTitle>
                    <CardDescription className="text-xs sm:text-sm text-muted-foreground mt-0.5">Direct WhatsApp notification to phone</CardDescription>
                  </div>
                </div>
                {whatsappPhoneNumber ? (
                  <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs font-normal gap-1 py-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Connected
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs font-normal py-1">
                    Not configured
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-5 sm:p-6 pt-0 space-y-5">
              <div className="rounded-2xl border bg-muted/30 p-4 space-y-2 text-xs sm:text-sm text-muted-foreground">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <Phone className="h-4 w-4 text-emerald-500" />
                  WhatsApp Prompt Details:
                </p>
                <p className="leading-relaxed">
                  During checkout, an OTP prompt is sent via WhatsApp to this registered phone number. Replying with the 6-digit OTP completes payment.
                </p>
              </div>

              <form onSubmit={handleSavePhone} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="whatsapp-phone" className="text-sm font-medium">
                    WhatsApp Phone Number (with country code)
                  </Label>
                  <Input
                    id="whatsapp-phone"
                    type="tel"
                    placeholder="+919876543210"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    className="text-sm h-10 rounded-xl"
                  />
                  <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
                    Example: <code className="text-foreground font-mono">+919876543210</code>. Leave blank to disable WhatsApp OTP prompts.
                  </p>
                </div>

                {phoneFeedback && (
                  <div
                    className={`rounded-xl p-3 text-xs sm:text-sm flex items-center gap-2.5 ${
                      phoneFeedback.success
                        ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30'
                        : 'bg-destructive/10 text-destructive border border-destructive/30'
                    }`}
                  >
                    {phoneFeedback.success ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                    )}
                    <span>{phoneFeedback.message}</span>
                  </div>
                )}

                <div className="pt-2 flex justify-end">
                  <Button
                    type="submit"
                    disabled={savingPhone}
                    className="gap-2 text-sm font-medium h-10 px-4 rounded-xl"
                  >
                    {savingPhone ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Save Phone Number
                  </Button>
                </div>
              </form>
            </CardContent>
          </div>
        </Card>
      </div>
    </div>
  );
}
