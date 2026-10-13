import readline from 'readline';
import type { Page, Frame, Locator } from 'playwright';
import { eq } from 'drizzle-orm';
import type { PaymentDetails } from '../../web/src/lib/card-payment-details';
import * as schema from '../../web/src/db/schema';
import { getWhatsAppClient } from '../../web/src/lib/whatsapp-client';
import { getTelegramClient } from '../../web/src/lib/telegram-client';
import { humanClick, humanType, humanDelay, humanHesitate } from './human-interaction';
import {
  handleContactDetailsIfPresent,
  resolveAndFillCvv,
  resolveAndClickPay,
  resolveOtpInput,
  verifyBankOtpScreenWithLLM,
} from './llm-gateway-agent';

export interface OtpPromptContext {
  db?: any;
  portalAccountId?: string;
  portalAccountLabel?: string;
  attemptId?: string;
  phoneNumber?: string | null;
  telegramChatId?: string | null;
  cardName?: string;
  cardLast4?: string;
  benefitName?: string;
}

export interface PaymentAutomationResult {
  status: 'confirmed' | 'otp_required' | 'failed' | 'timeout';
  bookingReference?: string;
  gateway?: string;
  error?: string;
}

/**
 * Detects the active payment gateway from URL and page structure.
 */
export function detectGateway(url: string, page?: Page): string {
  if (url.includes('ccavenue.com')) return 'CCAvenue';
  if (url.includes('razorpay.com')) return 'Razorpay';
  if (url.includes('payu.in')) return 'PayU';
  if (url.includes('billdesk.com')) return 'BillDesk';
  if (page) {
    const frames = page.frames();
    if (frames.some((f) => f.url().includes('razorpay.com'))) return 'Razorpay';
    if (frames.some((f) => f.url().includes('juspay.in'))) return 'Juspay';
    if (frames.some((f) => f.url().includes('payu.in'))) return 'PayU';
  }
  return 'Generic';
}

function resolvePage(target: Page | Frame): Page {
  return 'page' in target ? (target as Frame).page() : (target as Page);
}
export { handleContactDetailsIfPresent } from './llm-gateway-agent';

/**
 * Ensures the "Card" payment method tab is selected if the gateway presents multiple payment options.
 */
export async function ensureCardTabSelected(target: Page | Frame): Promise<void> {
  const cardTabSelectors = [
    'a:has-text("Credit / Debit Card")',
    'button:has-text("Cards")',
    'a:has-text("Cards")',
    'a:has-text("Debit Card")',
    'a:has-text("Credit Card")',
    'label:has-text("Cards")',
    'div[data-testid="card-tab"]',
    '#cards_tab',
    '#card_option',
  ];

  for (const sel of cardTabSelectors) {
    try {
      const tab = target.locator(sel).first();
      if (await tab.isVisible({ timeout: 1000 })) {
        console.log(`[gateway] Selecting Cards tab via "${sel}"...`);
        await tab.click();
        await resolvePage(target).waitForTimeout(500);
        return;
      }
    } catch {}
  }
}

function getAllTargets(target: Page | Frame): (Page | Frame)[] {
  const page = resolvePage(target);
  return [page, ...page.frames()];
}

/**
 * Fills card details using gateway-specific or generic heuristic rules.
 */
export async function fillCardDetailsOnGateway(
  target: Page | Frame,
  details: PaymentDetails,
  options?: { phoneNumber?: string | null; email?: string | null },
): Promise<boolean> {
  const page = resolvePage(target);
  const gateway = detectGateway(page.url(), page);
  console.log(`[gateway] Detected gateway: ${gateway} (${page.url()})`);

  // Step 0: Check for Contact Details modal (common in Razorpay Standard Checkout)
  await handleContactDetailsIfPresent(target, options);

  // Step 1: Ensure Card tab is active
  await ensureCardTabSelected(target);

  let filledCount = 0;
  const targets = getAllTargets(target);
  const last4 = details.cardNumber ? details.cardNumber.slice(-4) : undefined;

  // Step 1.5: Check if there is a saved card matching the last 4 digits (e.g. Juspay / Truztee)
  let savedCardClicked = false;
  if (last4) {
    for (let wait = 0; wait < 6; wait++) {
      const freshTargets = getAllTargets(target);
      for (const t of freshTargets) {
        try {
          const locators = [
            t.getByText(last4).first(),
            t.locator(`:has-text("${last4}")`).last(),
            t.locator(`text=${last4}`).first(),
          ];
          for (const loc of locators) {
            if (await loc.isVisible({ timeout: 400 })) {
              console.log(`[gateway] Found saved card matching ••${last4}. Gliding cursor and clicking naturally...`);
              await humanClick(loc, { hesitateBeforeMs: 600, pauseAfterMs: 1200 });
              await loc.evaluate((el: HTMLElement) => el.click()).catch(() => {});
              savedCardClicked = true;
              filledCount++;
              break;
            }
          }
        } catch {}
        if (savedCardClicked) break;
      }
      if (savedCardClicked) break;
      await page.waitForTimeout(800);
    }
  }

  // 1. Fill Card Number (if not already using a saved card)
  if (!savedCardClicked && details.cardNumber) {
    const cardSelectors = [
      '#cno', // CCAvenue
      'input[name="card_number"]',
      'input[name="cno"]',
      'input[id*="card_number" i]',
      'input[id*="cardno" i]',
      'input[autocomplete*="cc-number" i]',
      'input[placeholder*="Card Number" i]',
      'input[placeholder*="16 digit" i]',
      'input[name*="card" i]',
      '#card_number',
    ];

    for (const t of targets) {
      for (const sel of cardSelectors) {
        try {
          const input = t.locator(sel).first();
          if (await input.isVisible({ timeout: 800 })) {
            await input.fill(details.cardNumber);
            console.log(`[gateway] Card number entered via "${sel}"`);
            filledCount++;
            break;
          }
        } catch {}
      }
      if (filledCount > 0) break;
    }
  }

  // 2. Fill Expiry (Month & Year) (if not using saved card)
  if (!savedCardClicked && details.expiryMonth && details.expiryYear) {
    const expCombined = `${details.expiryMonth}/${details.expiryYear.slice(-2)}`;

    // Try single combined MM/YY input first
    const combinedSelectors = [
      'input[name="card_expiry"]',
      'input[autocomplete*="cc-exp" i]',
      'input[placeholder*="MM/YY" i]',
      'input[placeholder*="MM / YY" i]',
      'input[placeholder*="MM/YYYY" i]',
      '#card_expiry',
    ];

    let combinedFilled = false;
    for (const t of targets) {
      for (const sel of combinedSelectors) {
        try {
          const input = t.locator(sel).first();
          if (await input.isVisible({ timeout: 800 })) {
            await input.fill(expCombined);
            console.log(`[gateway] Expiry (${expCombined}) entered via "${sel}"`);
            combinedFilled = true;
            filledCount++;
            break;
          }
        } catch {}
      }
      if (combinedFilled) break;
    }

    // Otherwise, try separate Month and Year fields (common in CCAvenue & BillDesk)
    if (!combinedFilled) {
      const monthSelectors = ['#exp_month', 'select[name="exp_month"]', 'select[name*="month" i]', 'input[name="exp_month"]'];
      const yearSelectors = ['#exp_year', 'select[name="exp_year"]', 'select[name*="year" i]', 'input[name="exp_year"]'];

      for (const t of targets) {
        for (const sel of monthSelectors) {
          try {
            const el = t.locator(sel).first();
            if (await el.isVisible({ timeout: 800 })) {
              const tagName = await el.evaluate((e) => e.tagName.toLowerCase());
              if (tagName === 'select') {
                await el.selectOption({ value: details.expiryMonth });
              } else {
                await el.fill(details.expiryMonth);
              }
              console.log(`[gateway] Expiry month entered via "${sel}"`);
              break;
            }
          } catch {}
        }

        for (const sel of yearSelectors) {
          try {
            const el = t.locator(sel).first();
            if (await el.isVisible({ timeout: 800 })) {
              const tagName = await el.evaluate((e) => e.tagName.toLowerCase());
              if (tagName === 'select') {
                const expYr = details.expiryYear ?? '';
                await el.selectOption(expYr).catch(() => el.selectOption(expYr.slice(-2)));
              } else {
                await el.fill(details.expiryYear ?? '');
              }
              console.log(`[gateway] Expiry year entered via "${sel}"`);
              filledCount++;
              break;
            }
          } catch {}
        }
      }
    }
  }

  // 3. Fill CVV (always fill across all fresh frames, especially after clicking a saved card)
  if (details.cvv) {
    const cvvSelectors = [
      'input[name*="cvv" i]',
      'input[name*="cvc" i]',
      'input[placeholder*="CVV" i]',
      'input[placeholder*="CVC" i]',
      'input[placeholder*="Security" i]',
      'input[aria-label*="cvv" i]',
      'input[aria-label*="security" i]',
      'input[autocomplete*="cc-csc" i]',
      'input[maxlength="3"]',
      'input[maxlength="4"]',
      'input[type="password"]',
      '#cvv',
      '#cvv2',
      '#card_cvv',
      '.cvv-input',
    ];

    let cvvFilled = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const freshTargets = getAllTargets(target);
      for (const t of freshTargets) {
        for (const sel of cvvSelectors) {
          try {
            const input = t.locator(sel).first();
            if (await input.isVisible({ timeout: 400 })) {
              console.log(`[gateway] Found CVV field via "${sel}". Typing CVV with human keystroke delays...`);
              await humanType(input, details.cvv, { minCharDelayMs: 120, maxCharDelayMs: 240 });
              console.log(`[gateway] CVV entered successfully.`);
              filledCount++;
              cvvFilled = true;
              await humanHesitate(800, 1500);
              break;
            }
          } catch {}
        }
        if (cvvFilled) break;
      }
      if (cvvFilled) break;
      await page.waitForTimeout(600);
    }

    if (!cvvFilled && details.cvv) {
      console.log('[gateway] Standard CVV selectors did not match. Consulting Adaptive Gateway Agent (learned cache + DOM / LLM)...');
      const resolved = await resolveAndFillCvv(page, details.cvv);
      if (resolved) {
        filledCount++;
        cvvFilled = true;
      }
    }
  }

  // 4. Fill Name on Card (if not using saved card)
  if (!savedCardClicked && details.nameOnCard) {
    const nameSelectors = [
      '#card_name', // CCAvenue
      'input[name="card_name"]',
      'input[name*="name" i]',
      'input[autocomplete*="cc-name" i]',
      'input[placeholder*="Name on Card" i]',
      'input[placeholder*="Cardholder" i]',
    ];

    for (const t of targets) {
      for (const sel of nameSelectors) {
        try {
          const input = t.locator(sel).first();
          if (await input.isVisible({ timeout: 800 })) {
            await input.fill(details.nameOnCard);
            console.log(`[gateway] Name on card entered via "${sel}"`);
            break;
          }
        } catch {}
      }
    }
  }

  return filledCount >= (savedCardClicked ? 1 : 2);
}

/**
 * Clicks the primary payment/submit button on the gateway across all frames.
 */
export async function clickPayButton(target: Page | Frame): Promise<boolean> {
  const payBtnSelectors = [
    'button:has-text("Pay ₹1")',
    'button:has-text("Pay ₹2")',
    'button:has-text("Pay Rs. 1")',
    'button:has-text("Pay Rs. 2")',
    'button:has-text("Pay ₹")',
    'button:has-text("Pay Now")',
    'button:has-text("Make Payment")',
    'button:has-text("Proceed")',
    'button:has-text("Pay")',
    'button:has-text("Continue")',
    ':is(button, [role="button"], a):has-text("Pay")',
    ':is(button, [role="button"], a):has-text("Proceed")',
    '#pay_button',
    'button#pay_button',
    'input#pay_button',
    'input[value*="Pay" i]',
    'input[value*="Make Payment" i]',
    'button.btn-pay',
  ];

  for (let attempt = 0; attempt < 6; attempt++) {
    const targets = getAllTargets(target);
    for (const t of targets) {
      for (const sel of payBtnSelectors) {
        try {
          const btn = t.locator(sel).first();
          if (await btn.isVisible({ timeout: 500 })) {
            console.log(`[gateway] Gliding cursor and clicking pay button via "${sel}"...`);
            await humanClick(btn, { hesitateBeforeMs: 700, pauseAfterMs: 1500 });
            await btn.evaluate((el: HTMLElement) => el.click()).catch(() => {});
            return true;
          }
        } catch {}
      }
    }
    await resolvePage(target).waitForTimeout(800);
  }

  // Fallback to Adaptive Gateway Agent
  console.log('[gateway] Standard Pay button selectors did not match. Consulting Adaptive Gateway Agent (learned cache + DOM / LLM)...');
  const payClicked = await resolveAndClickPay(resolvePage(target));
  if (payClicked) return true;

  return false;
}

/**
 * Searches for an active OTP input element across the page and all child iframes.
 */
export async function findOtpInput(page: Page): Promise<{ target: Page | Frame; locator: Locator } | null> {
  const otpSelectors = [
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[placeholder*="OTP" i]',
    'input[placeholder*="One Time Password" i]',
    'input[autocomplete*="one-time-code" i]',
    'input[type="password"]',
    '#otp',
    '#otpPassword',
    '#txtOtp',
    '#login-otp',
  ];

  // Check main page first
  for (const sel of otpSelectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 500 })) {
        return { target: page, locator: loc };
      }
    } catch {}
  }

  // Check frames (bank 3DS ACS pages are frequently embedded in an iframe)
  for (const frame of page.frames()) {
    for (const sel of otpSelectors) {
      try {
        const loc = frame.locator(sel).first();
        if (await loc.isVisible({ timeout: 500 })) {
          return { target: frame, locator: loc };
        }
      } catch {}
    }
  }

  // Fallback to Adaptive Gateway Agent
  console.log('[gateway] Standard OTP input selectors did not match. Consulting Adaptive Gateway Agent (learned cache + DOM / LLM)...');
  const adaptiveOtp = await resolveOtpInput(page);
  if (adaptiveOtp) {
    return adaptiveOtp;
  }

  return null;
}

/**
 * Prompts the user interactively in the terminal for the OTP with a timeout,
 * while simultaneously watching if the user fills it directly in the open browser window.
 */
export async function promptForOtpAndSubmit(
  page: Page,
  contextOptions?: OtpPromptContext,
  timeoutMs: number = 180000,
): Promise<boolean> {
  console.log('[gateway] Verifying active Bank OTP verification screen with Gemini Vision before notifying...');
  const isOtpConfirmed = await verifyBankOtpScreenWithLLM(page, { maxWaitSec: 30 });
  if (!isOtpConfirmed) {
    console.warn('[gateway] ⚠️ LLM Vision did NOT confirm a Bank OTP screen. Suppressing OTP notifications to prevent false alert.');
    return false;
  }

  console.log(`\n======================================================`);
  console.log(`📲 3D-SECURE BANK OTP VERIFICATION REQUIRED (Verified by LLM Vision)`);
  console.log(`Current URL: ${page.url()}`);
  if (contextOptions?.telegramChatId) {
    console.log(`💬 Telegram OTP Prompt dispatched to Chat ID: ${contextOptions.telegramChatId}`);
  } else if (contextOptions?.phoneNumber) {
    console.log(`💬 WhatsApp Notification dispatched to: ${contextOptions.phoneNumber}`);
  }
  console.log(`👉 Enter OTP in terminal, reply on Telegram/WhatsApp, or type in browser.`);
  console.log(`======================================================\n`);

  let challengeId: string | null = null;

  // 1. If Telegram Chat ID and DB are provided, prioritize Telegram
  if (contextOptions?.db && contextOptions?.telegramChatId && contextOptions?.portalAccountId) {
    try {
      const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
      const [challenge] = await contextOptions.db
        .insert(schema.portalOrderOtpChallenges)
        .values({
          attemptId: contextOptions.attemptId,
          portalAccountId: contextOptions.portalAccountId,
          channel: 'telegram',
          telegramChatId: contextOptions.telegramChatId,
          phoneNumber: contextOptions.phoneNumber || null,
          status: 'pending',
          expiresAt,
        })
        .returning();

      if (challenge) {
        challengeId = challenge.id;
        const tg = getTelegramClient();
        await tg.sendOtpPrompt({
          chatId: contextOptions.telegramChatId,
          cardName: contextOptions.cardName || 'RuPay Card',
          cardLast4: contextOptions.cardLast4,
          portalAccountLabel: contextOptions.portalAccountLabel,
          benefitName: contextOptions.benefitName || 'RuPay Benefit',
          amount: 1,
          timeoutMinutes: 3,
        });
        console.log(`[gateway] Telegram OTP challenge initiated (id: ${challengeId}).`);
      }
    } catch (e) {
      console.error('[gateway] Failed to dispatch Telegram prompt:', e);
    }
  } else if (contextOptions?.db && contextOptions?.phoneNumber && contextOptions?.portalAccountId) {
    // 2. Otherwise fall back to WhatsApp if phone number is provided
    try {
      const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
      const [challenge] = await contextOptions.db
        .insert(schema.portalOrderOtpChallenges)
        .values({
          attemptId: contextOptions.attemptId,
          portalAccountId: contextOptions.portalAccountId,
          channel: 'whatsapp',
          phoneNumber: contextOptions.phoneNumber,
          status: 'pending',
          expiresAt,
        })
        .returning();

      if (challenge) {
        challengeId = challenge.id;
        const whatsapp = getWhatsAppClient();
        await whatsapp.sendOtpPrompt({
          to: contextOptions.phoneNumber,
          cardName: contextOptions.cardName || 'RuPay Card',
          benefitName: contextOptions.benefitName || 'RuPay Benefit',
          amount: 2,
          timeoutMinutes: 2,
        });
        console.log(`[gateway] WhatsApp OTP challenge initiated (id: ${challengeId}).`);
      }
    } catch (e) {
      console.error('[gateway] Failed to dispatch WhatsApp prompt:', e);
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<boolean>((resolve) => {
    let resolved = false;

    const cleanup = () => {
      resolved = true;
      rl.close();
    };

    async function injectOtp(otp: string, source: string) {
      console.log(`\n[gateway] >>> Injecting OTP (${source}): ${otp} into bank ACS page <<<`);
      const otpInput = await findOtpInput(page);
      if (otpInput) {
        await otpInput.locator.fill(otp);
        console.log('[gateway] OTP filled! Clicking Submit/Verify button...');

        const submitSelectors = [
          'button:has-text("Submit")',
          'input[type="submit"]',
          'button:has-text("Verify")',
          'button:has-text("Confirm")',
          'input[value*="Submit" i]',
          '#btnSubmit',
          '#submit',
        ];

        for (const sel of submitSelectors) {
          try {
            const btn = otpInput.target.locator(sel).first();
            if (await btn.isVisible({ timeout: 1000 })) {
              await btn.click();
              console.log(`[gateway] Clicked OTP submit via "${sel}".`);
              break;
            }
          } catch {}
        }
      } else {
        console.log('[gateway] Could not locate OTP input field automatically. Please submit in browser.');
      }
    }

    // Terminal stdin prompt
    rl.question('👉 Enter OTP: ', async (otpAnswer) => {
      if (resolved) return;
      cleanup();

      const trimmedOtp = otpAnswer.trim();
      if (trimmedOtp) {
        await injectOtp(trimmedOtp, 'terminal');
      }
      resolve(true);
    });

    // Background watcher: checks WhatsApp DB challenge AND browser navigation
    const pollInterval = setInterval(async () => {
      if (resolved) {
        clearInterval(pollInterval);
        return;
      }

      // 1. Check if WhatsApp Webhook populated the OTP in database
      if (challengeId && contextOptions?.db) {
        try {
          const [ch] = await contextOptions.db
            .select()
            .from(schema.portalOrderOtpChallenges)
            .where(eq(schema.portalOrderOtpChallenges.id, challengeId));

          if (ch && ch.status === 'received' && ch.otpCode) {
            const channelName = ch.channel === 'telegram' ? 'Telegram' : ch.channel === 'whatsapp' ? 'WhatsApp' : 'Webhook';
            console.log(`\n🎉 Received OTP "${ch.otpCode}" via ${channelName}!`);
            clearInterval(pollInterval);
            cleanup();
            await injectOtp(ch.otpCode, channelName);
            resolve(true);
            return;
          }
        } catch (err) {
          // Ignore transient db poll errors
        }
      }

      // 2. Check if user typed and submitted directly in the browser window
      const currUrl = page.url();
      if (
        currUrl.includes('success') ||
        currUrl.includes('confirm') ||
        currUrl.includes('truztee.com/#/offers') ||
        currUrl.includes('truztee.com')
      ) {
        console.log(`\n✓ Detected gateway completion in browser!`);
        clearInterval(pollInterval);
        cleanup();
        resolve(true);
      }
    }, 1000);

    // Timeout
    setTimeout(() => {
      if (!resolved) {
        console.log('\n⚠️ OTP entry timed out.');
        clearInterval(pollInterval);
        cleanup();
        resolve(false);
      }
    }, timeoutMs);
  });
}
