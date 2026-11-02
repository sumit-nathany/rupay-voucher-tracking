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

    const inlineRes = await mock.sendMessageWithInlineKeyboard('12345678', 'Confirm order?', [
      [{ text: 'Yes', callbackData: 'yes' }],
    ]);
    expect(inlineRes.success).toBe(true);
    expect(inlineRes.messageId).toContain('mock_tg_kb');

    const editRes = await mock.editMessageText('12345678', '9988', 'Updated text');
    expect(editRes.success).toBe(true);

    const answerRes = await mock.answerCallbackQuery('cb_123', 'Acknowledged');
    expect(answerRes.success).toBe(true);
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

  it('RealTelegramClient sends order attempt with cardHolderName and mentions OTP callout', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 12345 } }),
    });
    global.fetch = fetchMock;

    const tg = new RealTelegramClient('fake_bot_token');
    const res = await tg.sendOrderAttempt({
      chatId: '987654321',
      cardName: 'PNB RuPay Select',
      cardLast4: '1234',
      cardHolderName: 'Sumit Nathany',
      portalAccountLabel: 'Account #1',
      benefitName: 'Amazon Pay Gift Card',
      provider: 'Amazon',
      category: 'Shopping',
      voucherValue: 500,
    });

    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botfake_bot_token/sendMessage');
    const body = JSON.parse(options.body);
    expect(body.chat_id).toBe('987654321');
    expect(body.text).toContain('• *Card Holder:* Sumit Nathany\n');
    expect(body.text).toContain("📲 *Note:* The bank OTP for 3D-Secure verification will be received on *Sumit Nathany*'s phone number. Please be ready to share the OTP.");
  });

  it('RealTelegramClient sends order attempt without cardHolderName', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 12346 } }),
    });
    global.fetch = fetchMock;

    const tg = new RealTelegramClient('fake_bot_token');
    const res = await tg.sendOrderAttempt({
      chatId: '987654321',
      cardName: 'PNB RuPay Select',
      benefitName: 'Amazon Pay Gift Card',
    });

    expect(res.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.chat_id).toBe('987654321');
    expect(body.text).not.toContain('• *Card Holder:*');
    expect(body.text).toContain('📲 *Note:* Please be ready to share the bank OTP when prompted.');
  });

  it('RealTelegramClient sends message with inline keyboard', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: { message_id: 54321 } }),
    });
    global.fetch = fetchMock;

    const tg = new RealTelegramClient('fake_bot_token');
    const res = await tg.sendMessageWithInlineKeyboard('987654321', 'Select an option:', [
      [
        { text: 'Option A', callbackData: 'preorder:opt:123:abc' },
        { text: 'Option B', callbackData: 'preorder:opt:123:def' },
      ],
      [{ text: 'Skip', callbackData: 'preorder:skip:123' }],
    ]);

    expect(res.success).toBe(true);
    expect(res.messageId).toBe('54321');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botfake_bot_token/sendMessage');
    const body = JSON.parse(options.body);
    expect(body.chat_id).toBe('987654321');
    expect(body.text).toBe('Select an option:');
    expect(body.reply_markup.inline_keyboard).toEqual([
      [
        { text: 'Option A', callback_data: 'preorder:opt:123:abc' },
        { text: 'Option B', callback_data: 'preorder:opt:123:def' },
      ],
      [{ text: 'Skip', callback_data: 'preorder:skip:123' }],
    ]);
  });

  it('RealTelegramClient edits message text and handles message is not modified', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    }).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request: message is not modified',
    });
    global.fetch = fetchMock;

    const tg = new RealTelegramClient('fake_bot_token');
    const res1 = await tg.editMessageText('987654321', '54321', 'New content', [
      [{ text: 'Keep', callbackData: 'keep' }],
    ]);
    expect(res1.success).toBe(true);
    const [url1, opts1] = fetchMock.mock.calls[0];
    expect(url1).toBe('https://api.telegram.org/botfake_bot_token/editMessageText');
    const body1 = JSON.parse(opts1.body);
    expect(body1.message_id).toBe(54321);
    expect(body1.text).toBe('New content');
    expect(body1.reply_markup.inline_keyboard).toEqual([[{ text: 'Keep', callback_data: 'keep' }]]);

    // Second call tests "message is not modified"
    const res2 = await tg.editMessageText('987654321', '54321', 'New content');
    expect(res2.success).toBe(true);
    const [, opts2] = fetchMock.mock.calls[1];
    const body2 = JSON.parse(opts2.body);
    expect(body2.reply_markup.inline_keyboard).toEqual([]);
  });

  it('RealTelegramClient answers callback queries', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: true }),
    });
    global.fetch = fetchMock;

    const tg = new RealTelegramClient('fake_bot_token');
    const res = await tg.answerCallbackQuery('cb_query_999', 'Success toast');
    expect(res.success).toBe(true);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botfake_bot_token/answerCallbackQuery');
    const body = JSON.parse(options.body);
    expect(body.callback_query_id).toBe('cb_query_999');
    expect(body.text).toBe('Success toast');
  });
});
