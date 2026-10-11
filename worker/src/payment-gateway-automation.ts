import readline from 'readline';
import type { Page, Frame, Locator } from 'playwright';
import { eq } from 'drizzle-orm';
import type { PaymentDetails } from '../../web/src/lib/card-payment-details';
import * as schema from '../../web/src/db/schema';
import { getWhatsAppClient } from '../../web/src/lib/whatsapp-client';

export interface OtpPromptContext {
  db?: any;
  portalAccountId?: string;
  attemptId?: string;
  phoneNumber?: string | null;
  cardName?: string;
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
export function detectGateway(url: string): string {
  if (url.includes('ccavenue.com')) return 'CCAvenue';
  if (url.includes('razorpay.com')) return 'Razorpay';
  if (url.includes('payu.in')) return 'PayU';
  if (url.includes('billdesk.com')) return 'BillDesk';
  return 'Generic';
}

function resolvePage(target: Page | Frame): Page {
  return 'page' in target ? (target as Frame).page() : (target as Page);
}

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

/**
 * Fills card details using gateway-specific or generic heuristic rules.
 */
export async function fillCardDetailsOnGateway(
  target: Page | Frame,
  details: PaymentDetails,
): Promise<boolean> {
  const page = resolvePage(target);
  const gateway = detectGateway(page.url());
  console.log(`[gateway] Detected gateway: ${gateway} (${page.url()})`);

  // Step 1: Ensure Card tab is active
  await ensureCardTabSelected(target);

  let filledCount = 0;

  // 1. Fill Card Number
  if (details.cardNumber) {
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

    for (const sel of cardSelectors) {
      try {
        const input = target.locator(sel).first();
        if (await input.isVisible({ timeout: 1000 })) {
          await input.fill(details.cardNumber);
          console.log(`[gateway] Card number entered via "${sel}"`);
          filledCount++;
          break;
        }
      } catch {}
    }
  }

  // 2. Fill Expiry (Month & Year)
  if (details.expiryMonth && details.expiryYear) {
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
    for (const sel of combinedSelectors) {
      try {
        const input = target.locator(sel).first();
        if (await input.isVisible({ timeout: 1000 })) {
          await input.fill(expCombined);
          console.log(`[gateway] Expiry (${expCombined}) entered via "${sel}"`);
          combinedFilled = true;
          filledCount++;
          break;
        }
      } catch {}
    }

    // Otherwise, try separate Month and Year fields (common in CCAvenue & BillDesk)
    if (!combinedFilled) {
      const monthSelectors = ['#exp_month', 'select[name="exp_month"]', 'select[name*="month" i]', 'input[name="exp_month"]'];
      const yearSelectors = ['#exp_year', 'select[name="exp_year"]', 'select[name*="year" i]', 'input[name="exp_year"]'];

      for (const sel of monthSelectors) {
        try {
          const el = target.locator(sel).first();
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
          const el = target.locator(sel).first();
          if (await el.isVisible({ timeout: 800 })) {
            const tagName = await el.evaluate((e) => e.tagName.toLowerCase());
            if (tagName === 'select') {
              // Try full 4-digit year or 2-digit year
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

  // 3. Fill CVV
  if (details.cvv) {
    const cvvSelectors = [
      '#cvv2', // CCAvenue
      'input[name="cvv"]',
      'input[name="cvv2"]',
      'input[name*="cvc" i]',
      'input[autocomplete*="cc-csc" i]',
      'input[placeholder*="CVV" i]',
      'input[placeholder*="CVC" i]',
      '#cvv',
      '#card_cvv',
    ];

    for (const sel of cvvSelectors) {
      try {
        const input = target.locator(sel).first();
        if (await input.isVisible({ timeout: 1000 })) {
          await input.fill(details.cvv);
          console.log(`[gateway] CVV entered via "${sel}"`);
          filledCount++;
          break;
        }
      } catch {}
    }
  }

  // 4. Fill Name on Card
  if (details.nameOnCard) {
    const nameSelectors = [
      '#card_name', // CCAvenue
      'input[name="card_name"]',
      'input[name*="name" i]',
      'input[autocomplete*="cc-name" i]',
      'input[placeholder*="Name on Card" i]',
      'input[placeholder*="Cardholder" i]',
    ];

    for (const sel of nameSelectors) {
      try {
        const input = target.locator(sel).first();
        if (await input.isVisible({ timeout: 1000 })) {
          await input.fill(details.nameOnCard);
          console.log(`[gateway] Name on card entered via "${sel}"`);
          break;
        }
      } catch {}
    }
  }

  return filledCount >= 2;
}

/**
 * Clicks the primary payment/submit button on the gateway.
 */
export async function clickPayButton(target: Page | Frame): Promise<boolean> {
  const payBtnSelectors = [
    '#pay_button', // CCAvenue
    'button#pay_button',
    'input#pay_button',
    'button:has-text("Make Payment")',
    'button:has-text("Pay ₹2")',
    'button:has-text("Pay Rs. 2")',
    'button:has-text("Pay ₹")',
    'button:has-text("Pay Now")',
    'button:has-text("Proceed")',
    'input[value*="Pay" i]',
    'input[value*="Make Payment" i]',
    'button.btn-pay',
  ];

  for (const sel of payBtnSelectors) {
    try {
      const btn = target.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        console.log(`[gateway] Clicking pay button via "${sel}"...`);
        await btn.click();
        return true;
      }
    } catch {}
  }

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
  console.log(`\n======================================================`);
  console.log(`📲 3D-SECURE BANK OTP VERIFICATION REQUIRED`);
  console.log(`Current URL: ${page.url()}`);
  if (contextOptions?.phoneNumber) {
    console.log(`💬 WhatsApp Notification dispatched to: ${contextOptions.phoneNumber}`);
  }
  console.log(`👉 Enter OTP in terminal, reply on WhatsApp, or type in browser.`);
  console.log(`======================================================\n`);

  let challengeId: string | null = null;

  // 1. If WhatsApp number and DB are provided, create challenge and send prompt
  if (contextOptions?.db && contextOptions?.phoneNumber && contextOptions?.portalAccountId) {
    try {
      const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
      const [challenge] = await contextOptions.db
        .insert(schema.portalOrderOtpChallenges)
        .values({
          attemptId: contextOptions.attemptId,
          portalAccountId: contextOptions.portalAccountId,
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
            console.log(`\n🎉 Received OTP "${ch.otpCode}" via WhatsApp Webhook!`);
            clearInterval(pollInterval);
            cleanup();
            await injectOtp(ch.otpCode, 'WhatsApp');
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
