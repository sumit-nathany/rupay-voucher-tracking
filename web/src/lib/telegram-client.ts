/**
 * Telegram Bot Client Service
 * 100% Free, unlimited, instantaneous messaging for OTP prompts and confirmations.
 */

export interface TelegramSendOtpOptions {
  chatId: string;
  cardName: string;
  cardLast4?: string;
  portalAccountLabel?: string;
  benefitName: string;
  provider?: string;
  category?: string;
  voucherValue?: number | string;
  amount?: number;
  timeoutMinutes?: number;
  isRetry?: boolean;
  errorMessage?: string;
}

export interface TelegramConfirmationOptions {
  chatId: string;
  cardName: string;
  cardLast4?: string;
  portalAccountLabel?: string;
  benefitName: string;
  provider?: string;
  category?: string;
  voucherValue?: number | string;
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
    const amount = options.amount ?? 1;
    const timeout = options.timeoutMinutes ?? 3;

    const accountLine = options.portalAccountLabel ? `• *RuPay Account:* \`${options.portalAccountLabel}\`\n` : '';
    const cardLine = options.cardLast4
      ? `• *Card:* ${options.cardName} (•••• ${options.cardLast4})\n`
      : `• *Card:* ${options.cardName}\n`;
    const brandLine = options.provider ? `• *Brand / Merchant:* *${options.provider}*\n` : '';
    const categoryLine = options.category ? `• *Category:* ${options.category}\n` : '';
    const voucherLine = options.voucherValue
      ? `• *Voucher Details:* ${options.benefitName} (₹${options.voucherValue} value)\n`
      : `• *Voucher Details:* ${options.benefitName}\n`;

    const header = options.isRetry
      ? `❌ *Wrong OTP Entered — Please Re-enter OTP*\n\n` +
        `The bank reported: *${options.errorMessage || 'Invalid OTP'}*.\n\n`
      : `💳 *RuPay Benefit Verification Required*\n\nYour automated voucher order is ready to finalize:\n`;

    const cta = options.isRetry
      ? `👉 *Please check your SMS and reply with the CORRECT 6-digit Bank OTP* to authenticate the payment.`
      : `👉 *Please reply with the 6-digit Bank OTP* received on your phone within ${timeout} minutes to complete your order.`;

    const messageText =
      header +
      accountLine +
      cardLine +
      brandLine +
      categoryLine +
      voucherLine +
      `• *Verification Charge:* ₹${amount} (nominal)\n\n` +
      cta;

    return this.sendMessage(options.chatId, messageText);
  }

  async sendBookingConfirmation(options: TelegramConfirmationOptions): Promise<{ success: boolean; error?: string }> {
    const accountLine = options.portalAccountLabel ? `• *RuPay Account:* \`${options.portalAccountLabel}\`\n` : '';
    const cardLine = options.cardLast4
      ? `• *Card:* ${options.cardName} (•••• ${options.cardLast4})\n`
      : `• *Card:* ${options.cardName}\n`;
    const brandLine = options.provider ? `• *Brand / Merchant:* *${options.provider}*\n` : '';
    const categoryLine = options.category ? `• *Category:* ${options.category}\n` : '';
    const voucherLine = options.voucherValue
      ? `• *Voucher Details:* ${options.benefitName} (₹${options.voucherValue} value)\n`
      : `• *Voucher Details:* ${options.benefitName}\n`;

    const messageText =
      `🎉 *Voucher Order Confirmed!*\n\n` +
      accountLine +
      cardLine +
      brandLine +
      categoryLine +
      voucherLine +
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
    const prefix = options.isRetry ? '❌ Wrong OTP — Re-entry Required' : '💳 RuPay Verification';
    console.log(`\n💬 [Mock Telegram] Outbound to chat ${options.chatId}:`);
    console.log(`   "${prefix}: OTP required for ${options.benefitName} (₹${options.amount ?? 2}). Reply with OTP within 2 mins."`);
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
