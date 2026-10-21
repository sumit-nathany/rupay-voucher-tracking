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
  provider?: string;
  category?: string;
  voucherValue?: number | string;
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
    'button:has-text("Card"):not(:has-text("Gift Card"))',
    'div:has-text("Card"):not(:has-text("Gift Card"))',
    'a:has-text("Debit Card")',
    'a:has-text("Credit Card")',
    'label:has-text("Cards")',
    'div[data-testid="card-tab"]',
    '#cards_tab',
    '#card_option',
    'button[value="card"]',
  ];

  for (const sel of cardTabSelectors) {
    try {
      const targets = getAllTargets(target);
      for (const t of targets) {
        const tab = t.locator(sel).first();
        if (await tab.isVisible({ timeout: 400 }).catch(() => false)) {
          console.log(`[gateway] Selecting Cards tab via "${sel}"...`);
          await humanClick(tab, { hesitateBeforeMs: 300, pauseAfterMs: 800 });
          return;
        }
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
      '#green_edge_payment_cardNumber',
      '#cno', // CCAvenue
      'input[name="card_number"]',
      'input[name="cno"]',
      'input[id*="cardnumber" i]',
      'input[id*="card_number" i]',
      'input[id*="cardno" i]',
      'input[id*="card" i]:not([id*="name" i]):not([id*="holder" i])',
      'input[autocomplete*="cc-number" i]',
      'input[placeholder*="Card Number" i]',
      'input[placeholder*="16 digit" i]',
      'input[placeholder*="652500"]',
      'input[name*="card" i]',
      '#card_number',
    ];

    for (const t of targets) {
      for (const sel of cardSelectors) {
        try {
          const input = t.locator(sel).first();
          if (await input.isVisible({ timeout: 800 })) {
            await input.click();
            await input.fill(details.cardNumber);
            await input.evaluate((el: HTMLInputElement, val: string) => {
              el.value = val;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }, details.cardNumber).catch(() => {});
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
    'button:has-text("Continue")',
    ':is(button, [role="button"]):has-text("Continue")',
    'button:has-text("Pay ₹1")',
    'button:has-text("Pay ₹2")',
    'button:has-text("Pay Rs. 1")',
    'button:has-text("Pay Rs. 2")',
    'button:has-text("Pay ₹")',
    'button:has-text("Pay Now")',
    'button:has-text("Make Payment")',
    'button:has-text("Proceed")',
    'button:has-text("Pay")',
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
    'input[placeholder*="Enter OTP" i]',
    'input[placeholder*="OTP" i]',
    'input[placeholder*="One Time Password" i]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[autocomplete*="one-time-code" i]',
    'input[type="tel"][maxlength="6"]',
    'input[type="tel"][maxlength="4"]',
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
 * Detects if the bank 3DS ACS page rejected the entered OTP.
 * Returns the error description if an invalid OTP error is displayed, or null.
 */
export async function checkBankOtpError(page: Page): Promise<string | null> {
  const errorPhrases = [
    'invalid otp',
    'incorrect otp',
    'wrong otp',
    'otp entered is incorrect',
    'authentication failed',
    'invalid one time password',
    'please enter valid otp',
    'otp validation failed',
    'invalid / expired otp',
    'entered otp is wrong',
    'failed to validate otp',
    're-enter otp',
    'incorrect password',
    'invalid credentials',
    'invalid code',
    'maximum attempts',
    'invalid or expired',
    'please enter the correct otp',
    'you have entered an invalid otp',
    'authentication unsuccessful',
  ];

  const targets = [page, ...page.frames()];
  for (const t of targets) {
    try {
      const text = (await t.evaluate(() => document.body?.innerText || '')).toLowerCase();
      for (const phrase of errorPhrases) {
        if (text.includes(phrase)) {
          return phrase;
        }
      }

      // Check specific error elements
      const errorMsg = await t.evaluate(() => {
        const errorSelectors = [
          '.error-message',
          '.errorMessage',
          '.err-msg',
          '.error',
          '#error',
          '#errMsg',
          '#lblMessage',
          '#errMessage',
          'span[style*="red"]',
          'font[color="red"]',
          '.text-danger',
          '.alert-danger',
        ];
        for (const sel of errorSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const txt = (el.textContent || '').trim();
            if (
              txt.length > 3 &&
              (txt.toLowerCase().includes('otp') ||
                txt.toLowerCase().includes('invalid') ||
                txt.toLowerCase().includes('incorrect') ||
                txt.toLowerCase().includes('failed'))
            ) {
              return txt;
            }
          }
        }
        return null;
      });

      if (errorMsg) return errorMsg;
    } catch {}
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
  console.log('[gateway] Verifying active Bank OTP verification screen before notifying...');
  let isOtpConfirmed = false;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey) {
    isOtpConfirmed = await verifyBankOtpScreenWithLLM(page, { maxWaitSec: 15 });
  }
  if (!isOtpConfirmed) {
    const hasOtpInput = await findOtpInput(page);
    if (hasOtpInput) {
      console.log('[gateway] ✓ Confirmed Bank OTP screen via DOM OTP input field.');
      isOtpConfirmed = true;
    }
  }

  if (!isOtpConfirmed) {
    console.warn('[gateway] ⚠️ Bank OTP screen could not be confirmed. Suppressing OTP notifications to prevent false alert.');
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
          provider: contextOptions.provider,
          category: contextOptions.category,
          voucherValue: contextOptions.voucherValue,
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

    async function injectOtp(otp: string, source: string): Promise<boolean> {
      console.log(`\n[gateway] >>> Injecting OTP (${source}): ${otp} into bank ACS page <<<`);
      const otpInput = await findOtpInput(page);
      if (!otpInput) {
        console.log('[gateway] Could not locate OTP input field automatically. Please submit in browser.');
        return false;
      }

      await otpInput.locator.fill(otp);
      console.log('[gateway] OTP filled! Clicking Submit/Verify button...');

      const submitSelectors = [
        'input[type="submit"]',
        'input[value*="submit" i]',
        'input[value*="verify" i]',
        'input[value*="confirm" i]',
        'input[value*="proceed" i]',
        'input[type="button"][value*="submit" i]',
        'input[type="button"][value*="verify" i]',
        'button:has-text("Submit")',
        'button:has-text("Continue")',
        'button:has-text("Verify")',
        'button:has-text("Confirm")',
        'button:has-text("Proceed")',
        '#btnSubmit',
        '#submit',
        '#Submit',
        '#submitBtn',
        '#btn_submit',
        '#verifyBtn',
        '[id*="submit" i]',
        '[name*="submit" i]',
        'a:has-text("Submit")',
        'a:has-text("Verify")',
      ];

      // Try on otpInput.target first, then all frames, then page
      const targets = [otpInput.target, ...page.frames(), page];
      let clicked = false;
      for (const t of targets) {
        for (const sel of submitSelectors) {
          try {
            const elements = await t.locator(sel).all();
            for (const el of elements) {
              if (await el.isVisible({ timeout: 200 })) {
                await el.click({ timeout: 2000, force: true });
                await el.evaluate((b: HTMLElement) => b.click()).catch(() => {});
                console.log(`[gateway] Clicked visible OTP submit via "${sel}".`);
                clicked = true;
                break;
              }
            }
          } catch {}
          if (clicked) break;
        }
        if (clicked) break;
      }

      // If button not clicked via selectors, evaluate DOM directly for any button/link with Submit/Verify text
      if (!clicked) {
        for (const t of targets) {
          try {
            const clickedInDom = await t.evaluate(() => {
              const candidates = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], a, [role="button"]'));
              for (const el of candidates) {
                const text = ((el as HTMLElement).innerText || (el as HTMLInputElement).value || '').trim().toLowerCase();
                const isVisible = (el as HTMLElement).offsetWidth > 0 && (el as HTMLElement).offsetHeight > 0;
                if (isVisible && (text === 'submit' || text === 'verify' || text === 'proceed' || text === 'confirm' || text === 'make payment')) {
                  (el as HTMLElement).click();
                  return true;
                }
              }
              return false;
            });
            if (clickedInDom) {
              console.log('[gateway] Clicked OTP submit button via DOM text match.');
              clicked = true;
              break;
            }
          } catch {}
        }
      }

      // If button still not clicked, press Enter on the OTP input
      if (!clicked) {
        try {
          console.log('[gateway] Standard submit button not found. Pressing Enter on OTP input field...');
          await otpInput.locator.press('Enter');
          clicked = true;
        } catch (e: any) {
          console.warn('[gateway] Pressing Enter failed:', e?.message || e);
        }
      }

      return clicked;
    }

    let otpAttemptCount = 0;
    const maxOtpAttempts = 3;
    let lastProcessedOtp: string | null = null;
    let isSubmitting = false;

    async function handleOtpSubmission(otp: string, source: string): Promise<void> {
      if (isSubmitting) return;
      isSubmitting = true;

      try {
        console.log(`\n[gateway] >>> Handling OTP attempt #${otpAttemptCount + 1} (${source}): ${otp} <<<`);
        const clicked = await injectOtp(otp, source);
        if (!clicked) {
          console.warn('[gateway] Could not click submit button automatically. Please click Submit in browser.');
        }

        // Wait 3.5 seconds for bank 3DS validation response/redirect
        await resolvePage(page).waitForTimeout(3500);

        // Check if page navigated away from bank ACS screen or reached success
        const currUrl = resolvePage(page).url();
        const isPostPaymentSuccess =
          currUrl.includes('success') ||
          currUrl.includes('confirm') ||
          currUrl.includes('truztee.com/#/myaccount') ||
          currUrl.includes('truztee.com/#/view-redeemed-offers') ||
          currUrl.includes('redirect');

        // Check if bank 3DS screen shows an invalid OTP error
        const bankError = await checkBankOtpError(page);

        if (bankError) {
          otpAttemptCount++;
          console.warn(`\n⚠️ [gateway] Bank rejected OTP (${bankError}). Attempt ${otpAttemptCount}/${maxOtpAttempts}.`);

          if (otpAttemptCount < maxOtpAttempts) {
            // Notify user via Telegram that the OTP was incorrect and request retry
            if (contextOptions?.telegramChatId) {
              try {
                const tg = getTelegramClient();
                await tg.sendOtpPrompt({
                  chatId: contextOptions.telegramChatId,
                  cardName: contextOptions.cardName || 'RuPay Card',
                  cardLast4: contextOptions.cardLast4,
                  portalAccountLabel: contextOptions.portalAccountLabel,
                  benefitName: contextOptions.benefitName || 'RuPay Benefit',
                  provider: contextOptions.provider,
                  category: contextOptions.category,
                  voucherValue: contextOptions.voucherValue,
                  amount: 1,
                  timeoutMinutes: 2,
                  isRetry: true,
                  errorMessage: `Bank reported: "${bankError}".`,
                });
                console.log('[gateway] 💬 Dispatched "Wrong OTP" retry prompt to Telegram.');
              } catch (err) {
                console.error('[gateway] Failed to send Telegram retry prompt:', err);
              }
            }

            // Reset DB challenge status to 'pending' so Telegram webhook captures the user's next reply
            if (challengeId && contextOptions?.db) {
              try {
                await contextOptions.db
                  .update(schema.portalOrderOtpChallenges)
                  .set({
                    status: 'pending',
                    otpCode: null,
                    expiresAt: new Date(Date.now() + 3 * 60 * 1000), // extend 3 mins
                    updatedAt: new Date(),
                  })
                  .where(eq(schema.portalOrderOtpChallenges.id, challengeId));
                console.log(`[gateway] Reset DB challenge ${challengeId} to 'pending' for retry.`);
              } catch (err) {
                console.error('[gateway] Failed to reset challenge in DB:', err);
              }
            }

            lastProcessedOtp = null;

            // Clear the OTP input field on the page for clean re-entry
            const otpInput = await findOtpInput(page);
            if (otpInput) {
              await otpInput.locator.fill('').catch(() => {});
            }

            // Prompt terminal again
            promptTerminal();
            isSubmitting = false;
            return; // Continue polling!
          } else {
            console.error('[gateway] ❌ Maximum OTP attempts exceeded.');
            cleanup();
            resolve(false);
            return;
          }
        }

        // If no bank error detected and either left ACS or completed:
        console.log(`[gateway] ✓ OTP accepted or transitioning from bank ACS screen (URL: ${currUrl})`);
        cleanup();
        resolve(true);
      } finally {
        isSubmitting = false;
      }
    }

    // Terminal stdin prompt
    function promptTerminal() {
      if (resolved) return;
      rl.question('👉 Enter OTP: ', async (otpAnswer) => {
        if (resolved) return;
        const trimmedOtp = otpAnswer.trim();
        if (trimmedOtp) {
          await handleOtpSubmission(trimmedOtp, 'terminal');
        }
      });
    }
    promptTerminal();

    // Background watcher: checks Telegram/WhatsApp DB challenge AND browser navigation
    const pollInterval = setInterval(async () => {
      if (resolved || isSubmitting) {
        if (resolved) clearInterval(pollInterval);
        return;
      }

      // 1. Check if Telegram/WhatsApp Webhook populated the OTP in database
      if (challengeId && contextOptions?.db) {
        try {
          const [ch] = await contextOptions.db
            .select()
            .from(schema.portalOrderOtpChallenges)
            .where(eq(schema.portalOrderOtpChallenges.id, challengeId));

          if (ch && ch.status === 'received' && ch.otpCode && ch.otpCode !== lastProcessedOtp) {
            const channelName = ch.channel === 'telegram' ? 'Telegram' : ch.channel === 'whatsapp' ? 'WhatsApp' : 'Webhook';
            console.log(`\n🎉 Received OTP "${ch.otpCode}" via ${channelName}!`);
            lastProcessedOtp = ch.otpCode;
            await handleOtpSubmission(ch.otpCode, channelName);
            return;
          }
        } catch (err) {
          // Ignore transient db poll errors
        }
      }

      // 2. Check if user typed and submitted directly in the browser window
      const currUrl = resolvePage(page).url().toLowerCase();
      const isPostPaymentSuccess =
        currUrl.includes('success') ||
        currUrl.includes('confirm') ||
        currUrl.includes('truztee.com') ||
        currUrl.includes('view-redeemed-offers') ||
        currUrl.includes('myaccount');

      if (isPostPaymentSuccess) {
        console.log(`\n✓ Detected gateway completion in browser! (URL: ${currUrl})`);
        cleanup();
        resolve(true);
      }
    }, 1000);

    // Timeout
    setTimeout(() => {
      if (!resolved) {
        console.log('\n⚠️ OTP entry timed out.');
        cleanup();
        resolve(false);
      }
    }, timeoutMs);
  });
}
