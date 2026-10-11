import { NextRequest, NextResponse } from 'next/server';
import { eq, and, gt, or } from 'drizzle-orm';
import { db } from '@/db';
import { portalOrderOtpChallenges, automationSettings, workspaces } from '@/db/schema';
import { getTelegramClient } from '@/lib/telegram-client';

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'telegram-webhook' });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body.message;

    if (!message || !message.chat?.id || !message.text) {
      return NextResponse.json({ status: 'ignored' }, { status: 200 });
    }

    const chatId = String(message.chat.id);
    const text = message.text.trim();
    const telegram = getTelegramClient();

    console.log(`[telegram-webhook] Incoming message from chat ${chatId}: "${text}"`);

    // Handle /start command
    if (text.startsWith('/start')) {
      const parts = text.split(/\s+/);
      const possibleWorkspaceId = parts[1]?.trim();

      if (possibleWorkspaceId) {
        // Attempt to auto-link workspace
        const [ws] = await db
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, possibleWorkspaceId));

        if (ws) {
          await db
            .insert(automationSettings)
            .values({
              workspaceId: ws.id,
              enabled: false,
              telegramChatId: chatId,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: automationSettings.workspaceId,
              set: { telegramChatId: chatId, updatedAt: new Date() },
            });

          await telegram.sendMessage(
            chatId,
            `✅ *Connected to RuPay Tracker!*\n\n` +
            `Your Telegram Chat is linked to your workspace (*${ws.name}*).\n\n` +
            `When an automated RuPay voucher checkout requires a bank OTP, you will receive the prompt right here! Reply with the 6-digit OTP to complete your orders seamlessly.`
          );

          return NextResponse.json({ status: 'linked', workspaceId: ws.id });
        }
      }

      await telegram.sendMessage(
        chatId,
        `👋 *Welcome to RuPay Tracker Bot!*\n\n` +
        `Your Telegram Chat ID is:\n` +
        `\`${chatId}\`\n\n` +
        `Copy this Chat ID into your RuPay Tracker *Automation Settings* (/automation) to receive 3D-Secure bank OTP prompts directly in this chat!`
      );

      return NextResponse.json({ status: 'started', chatId });
    }

    // Extract 4 to 8 digit OTP
    const otpMatch = text.match(/\b\d{4,8}\b/);
    if (!otpMatch) {
      console.log('[telegram-webhook] No digit OTP pattern found in text.');
      return NextResponse.json({ status: 'no_otp' }, { status: 200 });
    }

    const otpCode = otpMatch[0];
    console.log(`[telegram-webhook] Detected OTP code: ${otpCode} for chat ${chatId}`);

    const now = new Date();

    const [challenge] = await db
      .select()
      .from(portalOrderOtpChallenges)
      .where(
        and(
          eq(portalOrderOtpChallenges.status, 'pending'),
          gt(portalOrderOtpChallenges.expiresAt, now),
          or(
            eq(portalOrderOtpChallenges.telegramChatId, chatId),
            eq(portalOrderOtpChallenges.phoneNumber, chatId),
          ),
        ),
      )
      .orderBy(portalOrderOtpChallenges.createdAt);

    if (!challenge) {
      console.log(`[telegram-webhook] No active pending challenge found for chat ${chatId}.`);
      await telegram.sendMessage(
        chatId,
        `⚠️ No active pending bank OTP challenge found right now. If a checkout is in progress, the request may have expired or completed already.`
      );
      return NextResponse.json({ status: 'no_active_challenge' }, { status: 200 });
    }

    // Mark challenge as received and store OTP
    await db
      .update(portalOrderOtpChallenges)
      .set({
        status: 'received',
        otpCode,
        updatedAt: now,
      })
      .where(eq(portalOrderOtpChallenges.id, challenge.id));

    console.log(`[telegram-webhook] ✓ Challenge ${challenge.id} updated with OTP ${otpCode}!`);

    // Send immediate acknowledgment
    await telegram.sendMessage(
      chatId,
      `✅ Received OTP \`${otpCode}\`! Submitting to your bank verification now...`
    );

    return NextResponse.json({ status: 'success', challengeId: challenge.id });
  } catch (err) {
    console.error('[telegram-webhook] Webhook handling error:', err);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}
