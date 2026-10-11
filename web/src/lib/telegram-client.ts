/**
 * Telegram Bot Client Service
 * 100% Free, unlimited, instantaneous messaging for OTP prompts and confirmations.
 */

export interface TelegramSendOtpOptions {
  chatId: string;
  cardName: string;
  benefitName: string;
  amount?: number;
  timeoutMinutes?: number;
}

export interface TelegramConfirmationOptions {
  chatId: string;
  cardName: string;
  benefitName: string;
  bookingRef: string;
}

export interface TelegramClient {
  sendMessage(chatId: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }>;
  sendOtpPrompt(options: TelegramSendOtpOptions): Promise<{ success: boolean; messageId?: string; error?: string }>;
  sendBookingConfirmation(options: TelegramConfirmationOptions): Promise<{ success: boolean; error?: string }>;
}

export class RealTelegramClient implements TelegramClient {
  private botToken: string;

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  async sendMessage(chatId: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('[telegram] API error:', res.status, errorText);
        return { success: false, error: errorText };
      }

      const json = await res.json();
      return { success: true, messageId: String(json.result?.message_id) };
    } catch (err) {
      console.error('[telegram] Error sending message:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendOtpPrompt(options: TelegramSendOtpOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const amount = options.amount ?? 2;
    const timeout = options.timeoutMinutes ?? 2;

    const messageText =
      `💳 *RuPay Benefit Verification Required*\n\n` +
      `Your automated voucher order is ready to finalize:\n` +
      `• *Benefit:* ${options.benefitName}\n` +
      `• *Card:* ${options.cardName}\n` +
      `• *Verification Charge:* ₹${amount} (nominal)\n\n` +
      `👉 *Please reply with the 6-digit Bank OTP* received on your phone within ${timeout} minutes to complete your order.`;

    return this.sendMessage(options.chatId, messageText);
  }

  async sendBookingConfirmation(options: TelegramConfirmationOptions): Promise<{ success: boolean; error?: string }> {
    const messageText =
      `🎉 *Voucher Order Confirmed!*\n\n` +
      `• *Benefit:* ${options.benefitName}\n` +
      `• *Card:* ${options.cardName}\n` +
      `• *Booking Reference:* \`${options.bookingRef}\`\n\n` +
      `Your voucher code will be available in your RuPay Tracker dashboard shortly.`;

    const res = await this.sendMessage(options.chatId, messageText);
    return { success: res.success, error: res.error };
  }
}

export class MockTelegramClient implements TelegramClient {
  async sendMessage(chatId: string, text: string): Promise<{ success: boolean; messageId: string }> {
    console.log(`\n💬 [Mock Telegram] Outbound to chat ${chatId}:`);
    console.log(`   "${text.slice(0, 100)}..."`);
    return { success: true, messageId: `mock_tg_${Date.now()}` };
  }

  async sendOtpPrompt(options: TelegramSendOtpOptions): Promise<{ success: boolean; messageId: string }> {
    console.log(`\n💬 [Mock Telegram] Outbound to chat ${options.chatId}:`);
    console.log(`   "💳 RuPay Verification: OTP required for ${options.benefitName} (₹${options.amount ?? 2}). Reply with OTP within 2 mins."`);
    return { success: true, messageId: `mock_tg_${Date.now()}` };
  }

  async sendBookingConfirmation(options: TelegramConfirmationOptions): Promise<{ success: boolean }> {
    console.log(`\n💬 [Mock Telegram] Outbound to chat ${options.chatId}:`);
    console.log(`   "🎉 Confirmed: ${options.benefitName} booked! Reference: ${options.bookingRef}"`);
    return { success: true };
  }
}

export function getTelegramClient(): TelegramClient {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (token) {
    return new RealTelegramClient(token);
  }
  return new MockTelegramClient();
}
