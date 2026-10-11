/**
 * WhatsApp Client Service
 * Supports Meta WhatsApp Business Cloud API with automatic mock fallback for development.
 */

export interface WhatsAppSendOtpOptions {
  to: string; // E.164 phone number, e.g. +919876543210
  cardName: string;
  benefitName: string;
  amount?: number;
  timeoutMinutes?: number;
}

export interface WhatsAppConfirmationOptions {
  to: string;
  benefitName: string;
  cardName: string;
  bookingRef: string;
}

export interface WhatsAppClient {
  sendOtpPrompt(options: WhatsAppSendOtpOptions): Promise<{ success: boolean; messageId?: string; error?: string }>;
  sendBookingConfirmation(options: WhatsAppConfirmationOptions): Promise<{ success: boolean; error?: string }>;
}

export class MetaWhatsAppClient implements WhatsAppClient {
  private apiToken: string;
  private phoneNumberId: string;

  constructor(apiToken: string, phoneNumberId: string) {
    this.apiToken = apiToken;
    this.phoneNumberId = phoneNumberId;
  }

  async sendOtpPrompt(options: WhatsAppSendOtpOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const cleanPhone = options.to.replace(/[^\d+]/g, '').replace(/^\+/, '');
    const amount = options.amount ?? 2;
    const timeout = options.timeoutMinutes ?? 2;

    const messageText = 
      `💳 *RuPay Benefit Verification Required*\n\n` +
      `Your automated voucher order is ready to finalize:\n` +
      `• *Benefit:* ${options.benefitName}\n` +
      `• *Card:* ${options.cardName}\n` +
      `• *Verification Charge:* ₹${amount} (nominal)\n\n` +
      `👉 *Please reply with the 6-digit Bank OTP* received on your phone within ${timeout} minutes to complete your order.`;

    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'text',
          text: { body: messageText },
        }),
      });

      if (!res.ok) {
        const errorBody = await res.text();
        console.error('[whatsapp] Meta API error:', res.status, errorBody);
        return { success: false, error: errorBody };
      }

      const json = await res.json();
      const messageId = json.messages?.[0]?.id;
      return { success: true, messageId };
    } catch (err) {
      console.error('[whatsapp] Error sending message:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async sendBookingConfirmation(options: WhatsAppConfirmationOptions): Promise<{ success: boolean; error?: string }> {
    const cleanPhone = options.to.replace(/[^\d+]/g, '').replace(/^\+/, '');

    const messageText =
      `🎉 *Voucher Order Confirmed!*\n\n` +
      `• *Benefit:* ${options.benefitName}\n` +
      `• *Card:* ${options.cardName}\n` +
      `• *Booking Reference:* \`${options.bookingRef}\`\n\n` +
      `Your voucher code will be available in your RuPay Tracker dashboard shortly.`;

    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: cleanPhone,
          type: 'text',
          text: { body: messageText },
        }),
      });

      return { success: res.ok };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class MockWhatsAppClient implements WhatsAppClient {
  async sendOtpPrompt(options: WhatsAppSendOtpOptions): Promise<{ success: boolean; messageId: string }> {
    console.log(`\n💬 [Mock WhatsApp] Outbound to ${options.to}:`);
    console.log(`   "💳 RuPay Verification: OTP required for ${options.benefitName} (₹${options.amount ?? 2}). Reply with OTP within 2 mins."`);
    return { success: true, messageId: `mock_msg_${Date.now()}` };
  }

  async sendBookingConfirmation(options: WhatsAppConfirmationOptions): Promise<{ success: boolean }> {
    console.log(`\n💬 [Mock WhatsApp] Outbound to ${options.to}:`);
    console.log(`   "🎉 Confirmed: ${options.benefitName} booked! Reference: ${options.bookingRef}"`);
    return { success: true };
  }
}

export function getWhatsAppClient(): WhatsAppClient {
  const token = process.env.WHATSAPP_API_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (token && phoneId) {
    return new MetaWhatsAppClient(token, phoneId);
  }

  return new MockWhatsAppClient();
}
