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

function getBenefitEmoji(type: string): string {
  const t = (type || '').toLowerCase();
  if (t.includes('cab') || t.includes('ride')) return '🚕';
  if (t.includes('ott') || t.includes('entertainment') || t.includes('movie') || t.includes('stream')) return '🎬';
  if (t.includes('spa') || t.includes('salon') || t.includes('wellness') || t.includes('massage')) return '💆';
  if (t.includes('gym') || t.includes('fitness') || t.includes('workout')) return '🏋️';
  if (t.includes('food') || t.includes('dining') || t.includes('restaurant')) return '🥗';
  if (t.includes('health') || t.includes('checkup') || t.includes('medical')) return '🩺';
  if (t.includes('shopping') || t.includes('grocery') || t.includes('groceries')) return '🛒';
  if (t.includes('music')) return '🎵';
  if (t.includes('golf')) return '⛳';
  return '🎁';
}

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

      // Show Main Benefit Category Menu (Level 1)
      if (data.startsWith('preorder:bmenu:')) {
        const sessionId = data.slice('preorder:bmenu:'.length);
        const [session] = await db
          .select()
          .from(portalOrderPreorderSessions)
          .where(eq(portalOrderPreorderSessions.id, sessionId));

        if (!session) {
          await telegram.answerCallbackQuery(callbackQueryId, 'Session not found.');
          return NextResponse.json({ status: 'session_not_found' });
        }

        // Extend countdown timer by 90s while user is browsing
        const extendedExpiry = new Date(Date.now() + 90000);
        await db
          .update(portalOrderPreorderSessions)
          .set({ status: 'browsing', expiresAt: extendedExpiry, updatedAt: new Date() })
          .where(eq(portalOrderPreorderSessions.id, sessionId));

        const meta = session.metadata;
        const availableBenefits: Array<{
          instanceId: string;
          benefitType: string;
          benefitProvider: string;
          exactBenefit: string;
          cashValue: string;
          optionCount: number;
        }> = meta?.availableBenefits ?? [];

        if (availableBenefits.length === 0) {
          await telegram.answerCallbackQuery(callbackQueryId, 'No alternative benefits available.');
          return NextResponse.json({ status: 'no_benefits' });
        }

        const inlineKeyboard: Array<Array<{ text: string; callbackData: string }>> = availableBenefits.map(
          (b, idx) => {
            const emoji = getBenefitEmoji(b.benefitType);
            const isCurrent = b.instanceId === session.instanceId;
            const val = b.cashValue && b.cashValue !== '0' ? ` (₹${b.cashValue})` : '';
            const currentTag = isCurrent ? ' • Current' : '';
            return [
              {
                text: `${emoji} ${b.benefitType}${val}${currentTag}`,
                callbackData: `preorder:bpick:${sessionId}:${idx}`,
              },
            ];
          }
        );

        inlineKeyboard.push([
          {
            text: '⬅️ Keep Current & Return',
            callbackData: `preorder:return:${sessionId}`,
          },
        ]);

        if (chatId && messageId) {
          await telegram.editMessageText(
            chatId,
            messageId,
            '📋 *Choose a Benefit Category for this Card:*\n\nTap a benefit below to select (timer extended by 90s):',
            inlineKeyboard
          );
        }
        await telegram.answerCallbackQuery(callbackQueryId);
        return NextResponse.json({ status: 'bmenu_shown', count: availableBenefits.length });
      }

      // User picked a Main Benefit Category
      if (data.startsWith('preorder:bpick:')) {
        const rest = data.slice('preorder:bpick:'.length);
        const [sessionId, idxStr] = rest.split(':');
        const benefitIdx = parseInt(idxStr, 10);

        const [session] = await db
          .select()
          .from(portalOrderPreorderSessions)
          .where(eq(portalOrderPreorderSessions.id, sessionId));

        if (!session) {
          await telegram.answerCallbackQuery(callbackQueryId, 'Session not found.');
          return NextResponse.json({ status: 'session_not_found' });
        }

        const meta = session.metadata;
        const availableBenefits = meta?.availableBenefits ?? [];
        const chosen = availableBenefits[benefitIdx];

        if (!chosen) {
          await telegram.answerCallbackQuery(callbackQueryId, 'Benefit not found.');
          return NextResponse.json({ status: 'benefit_not_found' });
        }

        // Check if chosen instance has multiple options
        const [instRow] = await db
          .select({
            id: benefitInstances.id,
            generatedFromVersion: benefitInstances.generatedFromVersion,
          })
          .from(benefitInstances)
          .where(eq(benefitInstances.id, chosen.instanceId));

        let options: Array<{ id: string; provider: string; offerName: string }> = [];
        if (instRow?.generatedFromVersion) {
          options = await db
            .select({
              id: benefitOptions.id,
              provider: benefitOptions.provider,
              offerName: benefitOptions.offerName,
            })
            .from(benefitOptions)
            .where(eq(benefitOptions.versionId, instRow.generatedFromVersion));
        }

        if (options.length > 1) {
          // Show Offer Variations (Level 2)
          const extendedExpiry = new Date(Date.now() + 90000);
          await db
            .update(portalOrderPreorderSessions)
            .set({
              status: 'browsing',
              expiresAt: extendedExpiry,
              metadata: {
                ...meta,
                pendingInstanceId: chosen.instanceId,
                availableOptionIds: options.map((o) => o.id),
              },
              updatedAt: new Date(),
            })
            .where(eq(portalOrderPreorderSessions.id, sessionId));

          const inlineKeyboard: Array<Array<{ text: string; callbackData: string }>> = options.map(
            (opt, optIdx) => [
              {
                text: `${opt.provider}: ${opt.offerName}`,
                callbackData: `preorder:optpick:${sessionId}:${optIdx}`,
              },
            ]
          );
          inlineKeyboard.push([
            {
              text: '⬅️ Back to Categories',
              callbackData: `preorder:bmenu:${sessionId}`,
            },
          ]);

          const emoji = getBenefitEmoji(chosen.benefitType);
          if (chatId && messageId) {
            await telegram.editMessageText(
              chatId,
              messageId,
              `${emoji} *Select ${chosen.benefitType} Offer:*\n\nChoose your preferred option below:`,
              inlineKeyboard
            );
          }
          await telegram.answerCallbackQuery(callbackQueryId);
          return NextResponse.json({ status: 'options_shown', instanceId: chosen.instanceId });
        } else {
          // Single option or standard voucher -> finalize immediately!
          const singleOpt = options[0];
          await db
            .update(portalOrderPreorderSessions)
            .set({
              status: 'benefit_selected',
              selectedInstanceId: chosen.instanceId,
              selectedOptionId: singleOpt?.id ?? null,
              selectedOptionName: singleOpt?.offerName ?? chosen.exactBenefit,
              updatedAt: new Date(),
            })
            .where(eq(portalOrderPreorderSessions.id, sessionId));

          if (singleOpt) {
            await db
              .update(benefitInstances)
              .set({ chosenOptionId: singleOpt.id, updatedAt: new Date() })
              .where(eq(benefitInstances.id, chosen.instanceId));
          }

          if (chatId && messageId) {
            await telegram.editMessageText(
              chatId,
              messageId,
              `✅ *Benefit Swapped:* *${chosen.exactBenefit}* (${chosen.benefitType})\n\nProceeding with browser order now...`
            );
          }
          await telegram.answerCallbackQuery(callbackQueryId, 'Benefit selected!');
          return NextResponse.json({ status: 'benefit_selected', instanceId: chosen.instanceId });
        }
      }

      // User picked an option variation from Level 2
      if (data.startsWith('preorder:optpick:')) {
        const rest = data.slice('preorder:optpick:'.length);
        const [sessionId, optIdxStr] = rest.split(':');
        const optIdx = parseInt(optIdxStr, 10);

        const [session] = await db
          .select()
          .from(portalOrderPreorderSessions)
          .where(eq(portalOrderPreorderSessions.id, sessionId));

        if (!session) {
          await telegram.answerCallbackQuery(callbackQueryId, 'Session not found.');
          return NextResponse.json({ status: 'session_not_found' });
        }

        const meta = session.metadata;
        const optionId = meta?.availableOptionIds?.[optIdx];
        const targetInstanceId = meta?.pendingInstanceId || session.instanceId;

        if (!optionId) {
          await telegram.answerCallbackQuery(callbackQueryId, 'Option not found.');
          return NextResponse.json({ status: 'option_not_found' });
        }

        const [opt] = await db
          .select()
          .from(benefitOptions)
          .where(eq(benefitOptions.id, optionId));

        if (!opt) {
          await telegram.answerCallbackQuery(callbackQueryId, 'Option not found.');
          return NextResponse.json({ status: 'option_not_found' });
        }

        await db
          .update(portalOrderPreorderSessions)
          .set({
            status: 'option_selected',
            selectedInstanceId: targetInstanceId,
            selectedOptionId: optionId,
            selectedOptionName: opt.offerName,
            updatedAt: new Date(),
          })
          .where(eq(portalOrderPreorderSessions.id, sessionId));

        await db
          .update(benefitInstances)
          .set({ chosenOptionId: optionId, updatedAt: new Date() })
          .where(eq(benefitInstances.id, targetInstanceId));

        if (chatId && messageId) {
          await telegram.editMessageText(
            chatId,
            messageId,
            `✅ *Option Selected:* *${opt.offerName}* (${opt.provider})\n\nProceeding with browser order now...`
          );
        }
        await telegram.answerCallbackQuery(callbackQueryId, 'Option confirmed!');
        return NextResponse.json({ status: 'option_selected', sessionId, optionId });
      }

      // Return to main pre-order interactive view
      if (data.startsWith('preorder:return:')) {
        const sessionId = data.slice('preorder:return:'.length);
        const [session] = await db
          .select()
          .from(portalOrderPreorderSessions)
          .where(eq(portalOrderPreorderSessions.id, sessionId));

        if (!session) {
          await telegram.answerCallbackQuery(callbackQueryId, 'Session not found.');
          return NextResponse.json({ status: 'session_not_found' });
        }

        const resetExpiry = new Date(Date.now() + 45000);
        await db
          .update(portalOrderPreorderSessions)
          .set({ status: 'pending', expiresAt: resetExpiry, updatedAt: new Date() })
          .where(eq(portalOrderPreorderSessions.id, sessionId));

        const meta = session.metadata;
        const availableBenefits = meta?.availableBenefits ?? [];
        const otherBenefitsCount = Math.max(0, availableBenefits.length - 1);

        const inlineKeyboard: Array<Array<{ text: string; callbackData: string }>> = [
          [{ text: '✅ Proceed Now (45s)', callbackData: `preorder:proceed:${sessionId}` }],
        ];
        if (otherBenefitsCount > 0) {
          inlineKeyboard.push([
            {
              text: `🔀 Change Benefit (${otherBenefitsCount} other available)`,
              callbackData: `preorder:bmenu:${sessionId}`,
            },
          ]);
        }
        inlineKeyboard.push([
          { text: '🛑 Skip This Card', callbackData: `preorder:skip:${sessionId}` },
        ]);

        if (chatId && messageId) {
          await telegram.editMessageText(
            chatId,
            messageId,
            `⏳ *RuPay Benefit Order Confirmation (45s window)*\n\nThe automation will automatically proceed with this order in 45 seconds unless you change the benefit or skip below:`,
            inlineKeyboard
          );
        }
        await telegram.answerCallbackQuery(callbackQueryId, 'Returned to main view.');
        return NextResponse.json({ status: 'returned_to_main' });
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
