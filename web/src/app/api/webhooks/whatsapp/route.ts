import { NextRequest, NextResponse } from 'next/server';
import { eq, and, gt, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { portalOrderOtpChallenges } from '@/db/schema';

/**
 * GET: Meta Webhook verification challenge
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'rupay_tracker_webhook_verify';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[whatsapp-webhook] Verified webhook subscription with Meta.');
    return new Response(challenge, { status: 200 });
  }

  return new Response('Forbidden', { status: 403 });
}

/**
 * POST: Incoming WhatsApp message event (Meta Cloud API or Twilio WhatsApp webhook)
 */
export async function POST(req: NextRequest) {
  try {
    let senderPhone: string | undefined;
    let textBody: string | undefined;
    let isTwilio = false;

    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      // Twilio WhatsApp webhook
      isTwilio = true;
      const formData = await req.formData();
      const rawFrom = formData.get('From')?.toString() || '';
      senderPhone = rawFrom.replace(/^whatsapp:/i, '').replace(/[^\d]/g, '');
      textBody = formData.get('Body')?.toString()?.trim();
    } else {
      // Meta WhatsApp Cloud API envelope
      const body = await req.json();
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0]?.value;
      const message = change?.messages?.[0];

      if (!message) {
        // Status update or delivery receipt, return 200
        return NextResponse.json({ status: 'ignored' }, { status: 200 });
      }

      senderPhone = message.from ? message.from.replace(/[^\d]/g, '') : undefined;
      textBody = message.text?.body?.trim();
    }

    if (!senderPhone || !textBody) {
      return NextResponse.json({ status: 'empty' }, { status: 200 });
    }

    console.log(`[whatsapp-webhook] Incoming message from +${senderPhone}: "${textBody}"`);

    // Extract 4 to 8 digit OTP from message body
    const otpMatch = textBody.match(/\b\d{4,8}\b/);

    if (!otpMatch) {
      console.log('[whatsapp-webhook] No digit OTP pattern found in text.');
      if (isTwilio) {
        return new Response('<Response></Response>', {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
        });
      }
      return NextResponse.json({ status: 'no_otp' }, { status: 200 });
    }

    const otpCode = otpMatch[0];
    console.log(`[whatsapp-webhook] Detected OTP code: ${otpCode} for phone ${senderPhone}`);

    // Match against active pending challenges for this phone number
    const now = new Date();
    const cleanWithPlus = `+${senderPhone}`;
    const cleanNoPlus = senderPhone;
    const last10 = senderPhone.slice(-10);

    const [challenge] = await db
      .select()
      .from(portalOrderOtpChallenges)
      .where(
        and(
          eq(portalOrderOtpChallenges.status, 'pending'),
          gt(portalOrderOtpChallenges.expiresAt, now),
          or(
            eq(portalOrderOtpChallenges.phoneNumber, cleanWithPlus),
            eq(portalOrderOtpChallenges.phoneNumber, cleanNoPlus),
            sql`${portalOrderOtpChallenges.phoneNumber} LIKE ${`%${last10}`}`,
          ),
        ),
      )
      .orderBy(portalOrderOtpChallenges.createdAt);

    if (!challenge) {
      console.log(`[whatsapp-webhook] No active pending challenge found for phone ${senderPhone}.`);
      if (isTwilio) {
        return new Response('<Response></Response>', {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
        });
      }
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

    console.log(`[whatsapp-webhook] ✓ Challenge ${challenge.id} updated with OTP ${otpCode}!`);

    // Send immediate acknowledgment
    const ackMessage = `✅ Received OTP \`${otpCode}\`! Submitting to your bank verification now...`;

    if (isTwilio) {
      return new Response(
        `<Response><Message>${ackMessage.replace(/`/g, '')}</Message></Response>`,
        {
          status: 200,
          headers: { 'Content-Type': 'text/xml' },
        },
      );
    }

    if (process.env.WHATSAPP_API_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
      try {
        await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: senderPhone,
            type: 'text',
            text: { body: ackMessage },
          }),
        });
      } catch (err) {
        console.error('[whatsapp-webhook] Error sending ack:', err);
      }
    }

    return NextResponse.json({ status: 'success', challengeId: challenge.id });
  } catch (err) {
    console.error('[whatsapp-webhook] Webhook handling error:', err);
    return NextResponse.json({ error: 'Internal Error' }, { status: 500 });
  }
}
