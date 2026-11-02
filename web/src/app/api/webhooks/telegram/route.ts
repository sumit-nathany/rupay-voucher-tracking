import { NextRequest, NextResponse } from 'next/server';
import { eq, and, gt, or } from 'drizzle-orm';
import { db } from '@/db';
import {
  portalOrderOtpChallenges,
  automationSettings,
  workspaces,
  portalOrderPreorderSessions,
  benefitInstances,
  benefitOptions,
} from '@/db/schema';
import { getTelegramClient } from '@/lib/telegram-client';

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'telegram-webhook' });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const telegram = getTelegramClient();

    // 1. Handle Telegram callback queries (inline button clicks)
    if (body.callback_query) {
      const cb = body.callback_query;
      const callbackQueryId = String(cb.id);
      const chat = cb.message?.chat;
      const chatId = chat?.id ? String(chat.id) : null;
      const messageId = cb.message?.message_id ? String(cb.message.message_id) : null;
      const data = typeof cb.data === 'string' ? cb.data : '';

      console.log(`[telegram-webhook] Callback query ${callbackQueryId} from chat ${chatId}: data="${data}"`);

      if (data.startsWith('preorder:proceed:')) {
        const sessionId = data.slice('preorder:proceed:'.length);
        await db
          .update(portalOrderPreorderSessions)
          .set({ status: 'proceed', updatedAt: new Date() })
          .where(eq(portalOrderPreorderSessions.id, sessionId));

        if (chatId && messageId) {
          await telegram.editMessageText(
            chatId,
            messageId,
            '✅ *Order Confirmed:* Proceeding with order now...'
          );
        }
        await telegram.answerCallbackQuery(callbackQueryId, 'Proceeding with order!');
        return NextResponse.json({ status: 'proceed', sessionId });
      }

      if (data.startsWith('preorder:change:')) {
        const sessionId = data.slice('preorder:change:'.length);
        const [session] = await db
          .select()
          .from(portalOrderPreorderSessions)
          .where(eq(portalOrderPreorderSessions.id, sessionId));

        if (!session) {
          await telegram.answerCallbackQuery(callbackQueryId, 'Session not found.');
          return NextResponse.json({ status: 'session_not_found' });
        }

        const [instance] = await db
          .select({
            id: benefitInstances.id,
            generatedFromVersion: benefitInstances.generatedFromVersion,
          })
          .from(benefitInstances)
          .where(eq(benefitInstances.id, session.instanceId));

        let options: Array<{ id: string; provider: string; offerName: string }> = [];
        if (instance?.generatedFromVersion) {
          options = await db
            .select({
              id: benefitOptions.id,
              provider: benefitOptions.provider,
              offerName: benefitOptions.offerName,
            })
            .from(benefitOptions)
            .where(eq(benefitOptions.versionId, instance.generatedFromVersion));
        }

        if (options.length > 0) {
          const inlineKeyboard: Array<Array<{ text: string; callbackData: string }>> = options.map((opt) => [
            {
              text: `${opt.provider}: ${opt.offerName}`,
              callbackData: `preorder:opt:${sessionId}:${opt.id}`,
            },
          ]);
          inlineKeyboard.push([
            {
              text: '⬅️ Keep Current',
              callbackData: `preorder:proceed:${sessionId}`,
            },
          ]);

          if (chatId && messageId) {
            await telegram.editMessageText(
              chatId,
              messageId,
              '📋 *Choose an Alternative Benefit Option:*\n\nTap an option below to select:',
              inlineKeyboard
            );
          }
          await telegram.answerCallbackQuery(callbackQueryId);
          return NextResponse.json({ status: 'options_shown', sessionId, count: options.length });
        } else {
          await telegram.answerCallbackQuery(callbackQueryId, 'No alternative options available.');
          return NextResponse.json({ status: 'no_options', sessionId });
        }
      }

      if (data.startsWith('preorder:opt:')) {
        const rest = data.slice('preorder:opt:'.length);
        const parts = rest.split(':');
        const sessionId = parts[0];
        const optionId = parts[1];

        const [option] = await db
          .select()
          .from(benefitOptions)
          .where(eq(benefitOptions.id, optionId));

        if (!option) {
          await telegram.answerCallbackQuery(callbackQueryId, 'Option not found.');
          return NextResponse.json({ status: 'option_not_found' });
        }

        const [session] = await db
          .select()
          .from(portalOrderPreorderSessions)
          .where(eq(portalOrderPreorderSessions.id, sessionId));

        await db
          .update(portalOrderPreorderSessions)
          .set({
            status: 'option_selected',
            selectedOptionId: optionId,
            selectedOptionName: option.offerName,
            updatedAt: new Date(),
          })
          .where(eq(portalOrderPreorderSessions.id, sessionId));

        if (session) {
          await db
            .update(benefitInstances)
            .set({
              chosenOptionId: optionId,
              updatedAt: new Date(),
            })
            .where(eq(benefitInstances.id, session.instanceId));
        }

        if (chatId && messageId) {
          await telegram.editMessageText(
            chatId,
            messageId,
            `✅ *Option Selected:* *${option.offerName}* (${option.provider})\n\nProceeding with order now...`
          );
        }
        await telegram.answerCallbackQuery(callbackQueryId, 'Option updated!');
        return NextResponse.json({ status: 'option_selected', sessionId, optionId });
      }

      if (data.startsWith('preorder:skip:')) {
        const sessionId = data.slice('preorder:skip:'.length);
        await db
          .update(portalOrderPreorderSessions)
          .set({
            status: 'skipped',
            updatedAt: new Date(),
          })
          .where(eq(portalOrderPreorderSessions.id, sessionId));

        if (chatId && messageId) {
          await telegram.editMessageText(
            chatId,
            messageId,
            '🛑 *Order Skipped.* Moving to next eligible card/benefit.'
          );
        }
        await telegram.answerCallbackQuery(callbackQueryId, 'Skipped.');
        return NextResponse.json({ status: 'skipped', sessionId });
      }

      await telegram.answerCallbackQuery(callbackQueryId);
      return NextResponse.json({ status: 'ignored_callback' }, { status: 200 });
    }

    // 2. Normal text message handling
    const message = body.message;

    if (!message || !message.chat?.id || !message.text) {
      return NextResponse.json({ status: 'ignored' }, { status: 200 });
    }

    const chatId = String(message.chat.id);
    const text = message.text.trim();

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
