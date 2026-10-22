import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RealTelegramClient, MockTelegramClient, getTelegramClient } from './telegram-client';

describe('telegram client service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('MockTelegramClient sends OTP prompts and confirmations successfully', async () => {
    const mock = new MockTelegramClient();
    const promptRes = await mock.sendOtpPrompt({
      chatId: '12345678',
      benefitName: 'Cult.fit 3 Month',
      cardName: 'PNB Select',
    });
    expect(promptRes.success).toBe(true);
    expect(promptRes.messageId).toContain('mock_tg');

    const confirmRes = await mock.sendBookingConfirmation({
      chatId: '12345678',
      benefitName: 'Cult.fit 3 Month',
      cardName: 'PNB Select',
      bookingRef: 'RUPAY-12345',
    });
    expect(confirmRes.success).toBe(true);
  });

  it('RealTelegramClient constructs proper payload to Telegram Bot API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 9988 } }),
    });
    global.fetch = fetchMock;

    const tg = new RealTelegramClient('fake_bot_token');
    const res = await tg.sendOtpPrompt({
      chatId: '987654321',
      benefitName: 'Swiggy One',
      cardName: 'Axis Select',
      amount: 2,
    });

    expect(res.success).toBe(true);
    expect(res.messageId).toBe('9988');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botfake_bot_token/sendMessage');
    const body = JSON.parse(options.body);
    expect(body.chat_id).toBe('987654321');
    expect(body.text).toContain('₹2');
    expect(body.text).toContain('RuPay Benefit Verification Required');

    const res2 = await tg.sendOtpPrompt({
      chatId: '987654321',
      benefitName: 'Redeemable Coupon - INR 100',
      isRetry: true,
      errorMessage: 'Incorrect OTP entered',
    });
    expect(res2.success).toBe(true);
    const [, options2] = fetchMock.mock.calls[1];
    const body2 = JSON.parse(options2.body);
    expect(body2.text).toContain('Wrong OTP Entered — Please Re-enter OTP');
    expect(body2.text).toContain('Incorrect OTP entered');
    expect(body2.text).toContain('CORRECT 6-digit Bank OTP');
  });

  it('getTelegramClient defaults to MockTelegramClient when token is missing', () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const client = getTelegramClient();
    expect(client).toBeInstanceOf(MockTelegramClient);
  });
});
