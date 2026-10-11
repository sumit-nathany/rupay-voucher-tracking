import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetaWhatsAppClient, MockWhatsAppClient, getWhatsAppClient } from './whatsapp-client';

describe('whatsapp client service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('MockWhatsAppClient sends OTP prompts and confirmations successfully', async () => {
    const mock = new MockWhatsAppClient();
    const promptRes = await mock.sendOtpPrompt({
      to: '+919876543210',
      benefitName: 'Cult.fit 3 Month',
      cardName: 'PNB Select',
    });
    expect(promptRes.success).toBe(true);
    expect(promptRes.messageId).toContain('mock_msg');

    const confirmRes = await mock.sendBookingConfirmation({
      to: '+919876543210',
      benefitName: 'Cult.fit 3 Month',
      cardName: 'PNB Select',
      bookingRef: 'RUPAY-12345',
    });
    expect(confirmRes.success).toBe(true);
  });

  it('MetaWhatsAppClient constructs proper payload to Meta Graph API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.12345' }] }),
    });
    global.fetch = fetchMock;

    const meta = new MetaWhatsAppClient('fake_token', '123456789');
    const res = await meta.sendOtpPrompt({
      to: '+91 98765 43210',
      benefitName: 'Swiggy One',
      cardName: 'Axis Select',
      amount: 2,
    });

    expect(res.success).toBe(true);
    expect(res.messageId).toBe('wamid.12345');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/123456789/messages');
    expect(options.headers.Authorization).toBe('Bearer fake_token');

    const body = JSON.parse(options.body);
    expect(body.to).toBe('919876543210');
    expect(body.text.body).toContain('Swiggy One');
    expect(body.text.body).toContain('₹2');
  });

  it('TwilioWhatsAppClient constructs proper payload to Twilio Messages API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SM123456789' }),
    });
    global.fetch = fetchMock;

    const { TwilioWhatsAppClient } = await import('./whatsapp-client');
    const twilio = new TwilioWhatsAppClient('AC123', 'auth_secret', '+14155238886');
    const res = await twilio.sendOtpPrompt({
      to: '+919876543210',
      benefitName: 'Cult.fit 3 Month',
      cardName: 'PNB Select',
      amount: 2,
    });

    expect(res.success).toBe(true);
    expect(res.messageId).toBe('SM123456789');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    const params = new URLSearchParams(options.body);
    expect(params.get('From')).toBe('whatsapp:+14155238886');
    expect(params.get('To')).toBe('whatsapp:+919876543210');
    expect(params.get('Body')).toContain('Cult.fit 3 Month');
  });

  it('getWhatsAppClient defaults to MockWhatsAppClient when env vars are missing', () => {
    delete process.env.WHATSAPP_API_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_WHATSAPP_NUMBER;

    const client = getWhatsAppClient();
    expect(client).toBeInstanceOf(MockWhatsAppClient);
  });
});
