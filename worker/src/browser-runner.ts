import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, and, inArray, lte, or } from 'drizzle-orm';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext, Page, Locator } from 'playwright';

chromium.use(StealthPlugin());
import * as schema from '../../web/src/db/schema';
import type { Database } from '../../web/src/lib/context';
import { decryptPortalCredentials } from '../../web/src/lib/portal-credentials';
import { decryptPaymentDetails, isValidPaymentDetails } from '../../web/src/lib/card-payment-details';
import { captureRecaptchaCallback, injectRecaptchaToken } from './captcha-solver';
import { installPageGlobals } from './page-globals';
import { solveRecaptchaViaService } from './captcha-service-solver';
import { findCandidatesForAccount, findCandidateFromGlobalQueue, recordPortalAccountCooldown } from '../../web/src/domain/automation';
import { today as todayInIST } from '../../web/src/lib/periods';
import { selectCandidateForAccount } from './candidate-selection';
import {
  classifyPortalRefusal,
  type PortalRefusalCode,
  type PortalRefusalSource,
} from '../../web/src/domain/portal-refusal';
import { recordPortalRefusal } from '../../web/src/domain/portal-refusal-store';
import { isPortalCooldownMessage, parsePortalCooldownDate, parsePortalCooldown } from '../../web/src/lib/portal-cooldown';
import { getAccountProfilePath } from './browser-profile';
import { fillCardDetailsOnGateway, clickPayButton, promptForOtpAndSubmit } from './payment-gateway-automation';
import { handlePostPaymentTransition, analyzeCurrentPageWithLLM } from './llm-gateway-agent';
import { getWhatsAppClient } from '../../web/src/lib/whatsapp-client';
import { getTelegramClient } from '../../web/src/lib/telegram-client';
import { humanClick, humanType, humanDelay, humanHesitate, installVisualMouseCursor } from './human-interaction';
import { finalizeConfirmedOrder } from '../../web/src/domain/automation-worker';

export interface BrowserRunnerOptions {
  portalAccountId?: string;
  headless?: boolean;
  ignoreCooldown?: boolean;
  /** Links the attempts this run creates to the ordering job run record. */
  jobRunId?: string;
}

/**
 * What a single runner invocation did. The batch entry point uses this to
 * report accurate per-account counts without re-querying the database.
 */
export interface BrowserRunResult {
  /** True when a candidate was selected and the portal flow was entered. */
  attempted: boolean;
  /** The portal account the run was for, when one was resolved. */
  accountLabel?: string;
  /** A short, safe reason code. Never contains portal data. */
  reason?:
    | 'ordered'
    | 'no_candidate'
    | 'missing_payment_details'
    | 'cooldown_detected'
    | 'cooldown_active'
    | 'card_limit_exhausted'
    | 'gateway_redirect_failed'
    | 'payment_failed'
    | 'portal_refused';
  /** The instance the run acted on, when one was selected. */
  instanceId?: string;
}

let activeBrowserContext: BrowserContext | null = null;

export async function runBrowserTest(options?: BrowserRunnerOptions): Promise<BrowserRunResult> {
  const dbUrl = process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL or WORKER_DATABASE_URL is required');
  }

  const client = postgres(dbUrl, { max: 1 });
  const db = drizzle(client, { schema }) as unknown as Database;

  // Resolve account from options or CLI argument (--account=<id or label>)
  const accountArg = options?.portalAccountId ?? process.argv.find((a) => a.startsWith('--account='))?.split('=')[1]?.trim();

  console.log('--- Step 1: Loading Candidate & Credentials ---');
  const accounts = await db
    .select()
    .from(schema.portalAccounts)
    .where(eq(schema.portalAccounts.status, 'connected'));

  if (accounts.length === 0) {
    throw new Error('No connected portal accounts found in database.');
  }

  const today = todayInIST();
  const ignoreCooldown =
    options?.ignoreCooldown ??
    (process.argv.includes('--force') || process.argv.includes('--ignore-cooldown'));
  if (ignoreCooldown) {
    console.log('[runner] --force / ignoreCooldown active: bypassing 24h limit checks for testing.');
  }

  // Auto-recover stale in-flight attempts (> 10 mins old or expired lease)
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  await db
    .update(schema.portalOrderAttempts)
    .set({ state: 'failed_pre_submit', failureCode: 'abandoned_or_timeout', finishedAt: new Date() })
    .where(
      and(
        inArray(schema.portalOrderAttempts.state, ['reserved', 'submitting']),
        or(
          lte(schema.portalOrderAttempts.leaseExpiresAt, new Date()),
          lte(schema.portalOrderAttempts.reservedAt, tenMinutesAgo),
        ),
      ),
    );

  let account = accounts[0];
  let candidate: Awaited<ReturnType<typeof findCandidatesForAccount>> = null;

  if (accountArg) {
    const match = accounts.find((a) => a.id === accountArg || a.label.toLowerCase() === accountArg.toLowerCase());
    if (!match) {
      throw new Error(`Account "${accountArg}" not found among connected accounts: ${accounts.map((a) => a.label).join(', ')}`);
    }
    account = match;
    // Prefer the global ordering queue for this account, exactly as the
    // unscoped path does, so a pinned account still honours rule priority and
    // the user's manual queue ordering.
    candidate = await selectCandidateForAccount(db, account, today, { ignoreCooldown });
  } else {
    // 1. Evaluate via Global Order Queue first across connected workspaces
    const workspaceIds = Array.from(new Set(accounts.map((a) => a.workspaceId)));
    for (const wId of workspaceIds) {
      const globalNomination = await findCandidateFromGlobalQueue(db, wId, today, { ignoreCooldown });
      if (globalNomination) {
        account = globalNomination.account as typeof account;
        candidate = globalNomination.candidate;
        console.log(`[runner] Global Queue matched candidate at Position #${globalNomination.candidate.rulePriority} for account "${account.label}".`);
        break;
      }
    }

    // 2. Fallback to legacy rules iteration if queue produced no candidate
    if (!candidate) {
      for (const acc of accounts) {
        const c = await findCandidatesForAccount(db, acc.id, today, { ignoreCooldown });
        if (c) {
          account = acc;
          candidate = c;
          break;
        }
      }
    }
  }

  const creds = decryptPortalCredentials(account.credentialsEncrypted, account.id);
  console.log(`Selected account "${account.label}". Decrypted credentials ready.`);

  if (!candidate) {
    console.log('No candidate nominated across connected accounts.');
    for (const acc of accounts) {
      if (acc.cooldownUntil && new Date(acc.cooldownUntil) > new Date()) {
        console.log(`Account ${acc.label} is in active 24h cooldown until: ${new Date(acc.cooldownUntil).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)`);
      }
    }
    await client.end();
    return { attempted: false, accountLabel: account?.label, reason: 'no_candidate' };
  }

  const [cardRow] = await db
    .select({
      last4: schema.cards.lastDigits,
      cardName: schema.bankCardTypes.displayName,
      variantName: schema.cardVariants.name,
      portalCardType: schema.cardVariants.portalCardType,
    })
    .from(schema.cards)
    .innerJoin(schema.bankCardTypes, eq(schema.cards.bankCardTypeId, schema.bankCardTypes.id))
    .innerJoin(schema.cardVariants, eq(schema.bankCardTypes.variantId, schema.cardVariants.id))
    .where(eq(schema.cards.id, candidate.cardId));

  const [instanceRow] = await db
    .select({
      id: schema.benefitInstances.id,
      generatedFromVersion: schema.benefitInstances.generatedFromVersion,
    })
    .from(schema.benefitInstances)
    .where(eq(schema.benefitInstances.id, candidate.instanceId));

  let benefitDetails = {
    benefitType: 'Unknown',
    benefitProvider: 'Unknown',
    exactBenefit: 'Unknown',
    cashValue: '0',
  };

  if (instanceRow?.generatedFromVersion) {
    const [b] = await db
      .select()
      .from(schema.benefitCatalogVersions)
      .where(eq(schema.benefitCatalogVersions.id, instanceRow.generatedFromVersion));
    if (b) {
      benefitDetails = {
        benefitType: b.benefitType,
        benefitProvider: b.benefitProvider ?? '',
        exactBenefit: b.exactBenefit,
        cashValue: b.defaultCashValue ?? '0',
      };
    }
  }

  if (candidate.chosenOptionId) {
    const [opt] = await db
      .select()
      .from(schema.benefitOptions)
      .where(eq(schema.benefitOptions.id, candidate.chosenOptionId));
    if (opt) {
      benefitDetails.benefitProvider = opt.provider;
      benefitDetails.exactBenefit = opt.offerName;
      if (opt.cashValue) benefitDetails.cashValue = opt.cashValue;
    }
  }

  console.log(`Card: ${cardRow?.cardName} (••${cardRow?.last4})`);
  console.log(`Benefit: ${benefitDetails.benefitType} - ${benefitDetails.exactBenefit} (${benefitDetails.benefitProvider}) (₹${benefitDetails.cashValue})`);

  const [cardRecord] = await db
    .select({
      paymentDetailsEncrypted: schema.cards.paymentDetailsEncrypted,
      lastDigits: schema.cards.lastDigits,
    })
    .from(schema.cards)
    .where(eq(schema.cards.id, candidate.cardId));

  let paymentDetails = null;

  // 1. Try current account mapping first
  const [currentAccountMapping] = await db
    .select()
    .from(schema.portalCardMappings)
    .where(
      and(
        eq(schema.portalCardMappings.cardId, candidate.cardId),
        eq(schema.portalCardMappings.portalAccountId, account.id),
      ),
    );

  if (currentAccountMapping?.paymentDetailsEncrypted) {
    try {
      paymentDetails = decryptPaymentDetails(currentAccountMapping.paymentDetailsEncrypted, currentAccountMapping.id);
    } catch (err) {
      console.warn('Could not decrypt payment details from account mapping:', err);
    }
  }

  // 2. Try cards table
  if (!paymentDetails && cardRecord?.paymentDetailsEncrypted) {
    try {
      paymentDetails = decryptPaymentDetails(cardRecord.paymentDetailsEncrypted, candidate.cardId);
    } catch (err) {
      console.warn('Could not decrypt payment details from cards table:', err);
    }
  }

  // 3. Fallback to any mapping for this card
  if (!paymentDetails) {
    const allMappings = await db
      .select()
      .from(schema.portalCardMappings)
      .where(eq(schema.portalCardMappings.cardId, candidate.cardId));

    for (const m of allMappings) {
      if (m.paymentDetailsEncrypted) {
        try {
          paymentDetails = decryptPaymentDetails(m.paymentDetailsEncrypted, m.id);
          if (paymentDetails) break;
        } catch {}
      }
    }
  }

  console.log(`Payment Details Mode: ${paymentDetails ? paymentDetails.mode : 'None'}`);

  // Resolve notification settings early — needed for proactive Telegram notifications
  const [settings] = await db
    .select()
    .from(schema.automationSettings)
    .where(eq(schema.automationSettings.workspaceId, account.workspaceId));

  const telegramChatId = settings?.telegramChatId || null;
  // Strictly use the portal account's own registered mobile number:
  const targetPhoneNumber = account.phoneNumber || creds.extra?.phone || creds.extra?.mobile || null;
  console.log(`[gateway] Portal account mobile number for payment gateway contact: ${targetPhoneNumber || '(not configured, relying on prefill)'}`);

  // Proactive notification: announce the order attempt starting
  if (telegramChatId) {
    const tg = getTelegramClient();
    await tg.sendOrderAttempt({
      chatId: telegramChatId,
      cardName: cardRow?.cardName ?? 'RuPay Card',
      cardLast4: cardRecord?.lastDigits ?? undefined,
      portalAccountLabel: account.label,
      benefitName: benefitDetails.exactBenefit,
      provider: benefitDetails.benefitProvider || undefined,
      category: benefitDetails.benefitType || undefined,
      voucherValue: benefitDetails.cashValue || undefined,
    }).catch((err) => console.error('[telegram] Failed to send order attempt notification:', err));
    console.log(`[gateway] Proactive Telegram notification sent: order attempt starting.`);
  }

  if (!paymentDetails || !isValidPaymentDetails(paymentDetails)) {
    console.error(`\n[runner] ❌ Aborting run: Card "${cardRow?.cardName}" (••${cardRow?.last4}) does not have valid payment details configured.`);
    console.error(`Automation cannot checkout without payment details (card number, expiry date, CVV). Please configure payment details on this card in the Cards section.`);

    // Notify failure via Telegram
    if (telegramChatId) {
      const tg = getTelegramClient();
      await tg.sendOrderFailure({
        chatId: telegramChatId,
        cardName: cardRow?.cardName ?? 'RuPay Card',
        cardLast4: cardRecord?.lastDigits ?? undefined,
        portalAccountLabel: account.label,
        benefitName: benefitDetails.exactBenefit,
        provider: benefitDetails.benefitProvider || undefined,
        category: benefitDetails.benefitType || undefined,
        voucherValue: benefitDetails.cashValue || undefined,
        reason: 'Missing payment details',
        errorDetail: `Card "${cardRow?.cardName}" (•${cardRow?.last4}) has no valid payment details configured.`,
      }).catch((err) => console.error('[telegram] Failed to send order failure notification:', err));
    }

    await client.end();
    return {
      attempted: true,
      accountLabel: account.label,
      instanceId: candidate.instanceId,
      reason: 'missing_payment_details',
    };
  }

  console.log('\n--- Step 2: Launching Browser with Isolated Account Profile ---');
  const userDataDir = getAccountProfilePath(account.id);
  console.log(`Profile Directory: ${userDataDir} (Account: ${account.label})`);

  const launchArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-infobars',
  ];

  // Only pass --no-sandbox if running as root in Linux containers without user namespaces
  if (process.platform === 'linux' && typeof (process as any).getuid === 'function' && (process as any).getuid() === 0) {
    launchArgs.push('--no-sandbox');
  }

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: options?.headless ?? (process.argv.includes('--headless') ? true : false),
      slowMo: 15,
      viewport: { width: 1366, height: 860 },
      ignoreDefaultArgs: ['--enable-automation'],
      args: launchArgs,
    });
  } catch (err) {
    console.warn('[runner] Launching with system Google Chrome failed, falling back to bundled Chromium:', err);
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: options?.headless ?? (process.argv.includes('--headless') ? true : false),
      slowMo: 15,
      viewport: { width: 1366, height: 860 },
      ignoreDefaultArgs: ['--enable-automation'],
      args: launchArgs,
    });
  }
  activeBrowserContext = context;
  await installPageGlobals(context);

  const page: Page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  await installVisualMouseCursor(page);

  // Track any new tabs / popups that might open (e.g. payment gateway tab)
  const popupTracker = { page: null as Page | null };
  context.on('page', async (newPage) => {
    console.log(`[Popup/New Tab detected]: ${newPage.url()}`);
    popupTracker.page = newPage;
    await installVisualMouseCursor(newPage);
  });

  page.on('close', () => console.log('[runner] >>> Main page was closed.'));
  page.on('crash', () => console.log('[runner] >>> Main page crashed!'));
  context.on('close', () => console.log('[runner] >>> Browser context was closed.'));

  // Log console and requests to see errors and APIs
  page.on('console', (msg) => console.log(`[console ${msg.type()}]`, msg.text()));
  page.on('request', (req) => {
    if (req.url().includes('truztee') || req.url().includes('juspay')) {
      console.log(`[request] ${req.method()} ${req.url()}`);
    }
  });

  // Listen for portal transaction responses
  let cooldownDetectedUntil: Date | null = null;
  let initiatedOrderId: string | null = null;
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('addUserTransaction') || url.includes('createOrder') || url.includes('payment') || url.includes('juspay')) {
      try {
        const text = await res.text();
        // Never log the response body — it can carry codes, tokens, or raw
        // portal payloads, and the product rules forbid that in logs. Log the
        // shape only, then parse for the fields we actually act on.
        console.log(`[response ${res.status()}] ${url.slice(0, 100)} (${text.length} bytes)`);
        const json = JSON.parse(text);
        const inner = typeof json.payload === 'string' ? JSON.parse(json.payload) : json.payload;
        const msg = inner?.message || json?.message;
        const resData = inner?.response || json?.response;
        if (resData?.orderid && typeof resData.orderid === 'string' && resData.orderid.startsWith('RUP')) {
          initiatedOrderId = resData.orderid.trim();
          console.log(`[portal] 🎯 Tracked active order ID: ${initiatedOrderId}`);
        }
        if (resData && (resData.billing_tel || resData.mobile || resData.phone)) {
          const detectedPhone = String(resData.billing_tel || resData.mobile || resData.phone).trim();
          if (detectedPhone && detectedPhone.length >= 10 && !account.phoneNumber) {
            console.log(`[portal] 📱 Auto-detected account phone number from portal transaction: ${detectedPhone}`);
            account.phoneNumber = detectedPhone;
            await db
              .update(schema.portalAccounts)
              .set({ phoneNumber: detectedPhone, updatedAt: new Date() })
              .where(eq(schema.portalAccounts.id, account.id))
              .catch(() => {});
          }
        }
        if (msg && isPortalCooldownMessage(msg)) {
          console.log('\n⚠️ Portal Cooldown / Limit Detected in API response:', msg);
          const parsed = parsePortalCooldown(msg);
          cooldownDetectedUntil = parsed?.until ?? new Date(Date.now() + 20 * 60 * 1000);
          const reason = parsed?.reason ?? 'rate_limited_temporary';
          console.log(`Locked until (IST): ${cooldownDetectedUntil.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (${parsed?.durationMinutes ?? 20}m)`);

          // Record cooldown in database
          await recordPortalAccountCooldown(db, account.id, cooldownDetectedUntil, reason);
          console.log('✓ Recorded cooldown in database! Next run will wait until then.');
        }
      } catch (e) {
        // ignore parse errors for non-json
      }
    }
  });

  console.log('Navigating to https://rupayselect.truztee.com ...');
  await page.goto('https://rupayselect.truztee.com/#/offers', { waitUntil: 'networkidle' });

  // Check if session is already active and verify it belongs to the intended account
  const cookies = await context.cookies();
  let jwtCookie = cookies.find((c) => c.name === 'jwt');
  let activeSessionMatches = false;

  if (jwtCookie) {
    const sessionEmail = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('UserDetails');
        if (raw) {
          const ud = JSON.parse(raw);
          return ud.emailid || ud.email || ud.loginId || '';
        }
      } catch {}
      return '';
    });

    const targetEmail = (creds.loginId || account.label).toLowerCase().trim();
    const currentEmail = (sessionEmail || '').toLowerCase().trim();

    if (currentEmail && (currentEmail === targetEmail || currentEmail.includes(targetEmail) || targetEmail.includes(currentEmail))) {
      activeSessionMatches = true;
      console.log(`✓ Active session verified for target account "${account.label}" (${currentEmail}). Login & CAPTCHA bypassed!`);
    } else {
      console.log(`\n======================================================`);
      console.log(`⚠️ Active session in browser belongs to "${currentEmail || 'unknown'}", but target account is "${account.label}" (${targetEmail})!`);
      console.log(`Logging out to switch to correct account...`);
      console.log(`======================================================\n`);

      // Try to click Logout button if present
      const logoutBtn = page.locator(':is(button, a):has-text("Logout"), button.btn-logout').first();
      if (await logoutBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await humanClick(logoutBtn, { hesitateBeforeMs: 300, pauseAfterMs: 1000 }).catch(() => {});
      }

      // Clear cookies and storage for clean session reset
      await context.clearCookies();
      await page.evaluate(() => {
        try {
          localStorage.clear();
          sessionStorage.clear();
        } catch {}
      }).catch(() => {});

      await page.goto('https://rupayselect.truztee.com/#/login', { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000);
      jwtCookie = undefined;
    }
  }

  if (!jwtCookie || !activeSessionMatches) {
    console.log(`Starting login sequence for "${account.label}" (${creds.loginId})...`);
    const loginButton = page.locator('button:has-text("Login"), a:has-text("Login")').first();
    if (await loginButton.isVisible().catch(() => false)) {
      await humanClick(loginButton, { hesitateBeforeMs: 400, pauseAfterMs: 600 });
    }

    const emailInput = page.locator('input[type="email"]:visible').first();
    const passwordInput = page.locator('input[type="password"]:visible').first();
    console.log('Typing login ID naturally...');
    await humanType(emailInput, creds.loginId, { minCharDelayMs: 90, maxCharDelayMs: 170 });
    await humanHesitate(500, 1000);
    console.log('Typing password naturally...');
    await humanType(passwordInput, creds.password, { minCharDelayMs: 80, maxCharDelayMs: 160 });
    await humanHesitate(800, 1500);

    console.log('\n======================================================');
    console.log('🧩 reCAPTCHA verification required on login screen.');
    console.log('🤖 Initiating unattended automated CAPTCHA solver...');
    console.log('======================================================\n');

    let autoSolveInitiated = false;
    let clickedSignIn = false;

    for (let sec = 0; sec < 300; sec++) {
      await page.waitForTimeout(1000);
      const updatedCookies = await context.cookies();
      jwtCookie = updatedCookies.find((c) => c.name === 'jwt');
      if (jwtCookie) break;

      // Start the auto-solver after a brief pause once credentials are input.
      //
      // All CAPTCHA solving is delegated to the external ReCaptcha Solver
      // service. The worker never solves challenges itself.
      if (!autoSolveInitiated && sec >= 1) {
        autoSolveInitiated = true;
        console.log('[captcha] Using the shared solving service.');
        // The service opens the portal in its own browser, so it has to be
        // told how to reach the login form: the modal is opened by the Login
        // button on the offers page.
        solveRecaptchaViaService(page, { loginButton: 'Login' })
          .then((success) => {
            if (success) {
              console.log('[captcha] ✓ Auto-solver finished successfully!');
            }
          })
          .catch((err) => {
            console.warn('[captcha] Auto-solver error:', err);
          });
      }

      const captchaSolved = await page.evaluate(() => {
        const textarea = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
        return Boolean(textarea && textarea.value.length > 0);
      });

      if (captchaSolved && !clickedSignIn) {
        try {
          const submitButton = page.locator('button.btn-login-submit, button:has-text("Sign In"):visible').first();
          if (await submitButton.isVisible()) {
            // The site enables its submit button from the reCAPTCHA callback,
            // so a button that is visible but disabled means the callback
            // never reached the site. Say so, rather than clicking it and
            // waiting four minutes for nothing.
            if (await submitButton.isEnabled().catch(() => true)) {
              clickedSignIn = true;
              console.log('[captcha] ✓ CAPTCHA solved! Automatically clicking Sign In...');
              // reCAPTCHA leaves a transparent overlay over the challenge for
              // a moment after it is solved. A click at raw coordinates lands
              // on that overlay and does nothing, silently. Playwright's own
              // click waits for the element to actually receive the event, so
              // use that first and fall back to the humanised click.
              try {
                // A short timeout: the widget's iframe covers the button, so
                // the real click always fails, and there is no point waiting
                // a long time to find that out.
                await submitButton.click({ timeout: 5000 });
              } catch (err) {
                console.warn('[captcha] The submit button is covered, clicking it directly:', String(err).split('\n')[0]);
                await submitButton.evaluate((el) => (el as HTMLElement).click());
              }
              await page.waitForTimeout(2000);
            } else {
              console.warn(
                '[captcha] The submit button is still disabled — the site has not accepted the ' +
                  'captcha response. Skipping the click.',
              );
            }
          }
        } catch (err) {
          console.warn('[captcha] Could not click the submit button:', err);
        }
      }
    }

    // Give a few extra seconds for network authentication to complete
    if (!jwtCookie) {
      for (let w = 0; w < 10; w++) {
        await page.waitForTimeout(1000);
        const updatedCookies = await context.cookies();
        jwtCookie = updatedCookies.find((c) => c.name === 'jwt');
        if (jwtCookie) break;
      }
    }

    if (!jwtCookie) {
      throw new Error(`Login timed out or failed for account "${account.label}". Please check credentials or complete CAPTCHA.`);
    }

    console.log(`✓ Login complete! Session token saved in profile for ${account.label}.`);
  }

  // Ensure we navigate directly to the offers page if not already there
  if (!page.url().includes('/offers')) {
    console.log('Navigating to https://rupayselect.truztee.com/#/offers ...');
    await page.goto('https://rupayselect.truztee.com/#/offers', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2500);
  }

  // Extract user details and registered mobile number from portal storage
  try {
    const portalUserDetails = await page.evaluate(() => {
      const raw = localStorage.getItem('UserDetails');
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    });

    if (portalUserDetails && portalUserDetails.contactnumber) {
      const contactNum = String(portalUserDetails.contactnumber).trim();
      if (contactNum.length >= 10 && (!account.phoneNumber || account.phoneNumber !== contactNum)) {
        console.log(`[portal] 📱 Auto-detected account registered phone number from UserDetails: ${contactNum}`);
        account.phoneNumber = contactNum;
        await db
          .update(schema.portalAccounts)
          .set({ phoneNumber: contactNum, updatedAt: new Date() })
          .where(eq(schema.portalAccounts.id, account.id))
          .catch(() => {});
      }
    }
  } catch {}

async function addCardToPortalAccount(
  page: Page,
  options: {
    cardName: string;
    cardNumber: string;
    portalCardType?: number | null;
    bankCoreName: string;
    accountLabel: string;
  },
) {
  console.log(`\n======================================================`);
  console.log(`➕ [portal] Automatically adding card "${options.cardName}" to portal account "${options.accountLabel}"...`);
  console.log(`======================================================\n`);

  const isDebit = options.portalCardType === 41 || options.cardName.toLowerCase().includes('debit');
  const cardTypeKeyword = isDebit ? 'Debit' : 'Credit';
  const cardTypeId = isDebit ? '41' : '42';

  // 1. Query public card catalog to determine exact digitflag
  let digitCount = 6;
  try {
    const res = await page.request.post('https://apirupayselect.truztee.com/api/Public/getCardNames', {
      data: { cardtype: cardTypeId },
      headers: { 'Content-Type': 'application/json' },
    });
    if (res.ok()) {
      const json = await res.json();
      const payload = typeof json.payload === 'string' ? JSON.parse(json.payload) : json.payload;
      const cards = payload?.response || [];
      const matched = cards.find((c: any) =>
        c.cardname.toLowerCase().includes(options.bankCoreName.toLowerCase()),
      );
      if (matched) {
        console.log(`[portal] Matched catalog entry: ID=${matched.id}, Name="${matched.cardname}", digitflag="${matched.digitflag}"`);
        digitCount = matched.digitflag === 'E' ? 8 : (matched.digitflag === 'N' ? 9 : 6);
      }
    }
  } catch (err) {
    console.warn('[portal] Warning checking public card names catalog:', err);
  }

  const startDigits = options.cardNumber.slice(0, digitCount);
  console.log(`[portal] Card BIN prefix for card addition: ${startDigits} (${digitCount} digits)`);

  // 2. Navigate to myaccount page
  console.log('Navigating to https://rupayselect.truztee.com/#/myaccount ...');
  await page.goto('https://rupayselect.truztee.com/#/myaccount', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // 3. Switch to Cards tab
  const cardsTab = page
    .locator(':is(button, a)[data-bs-target="#cards"], :is(button, a):has-text("Cards"), a[href*="#cards"]')
    .first();
  await cardsTab.waitFor({ state: 'visible', timeout: 8000 });
  await humanClick(cardsTab, { hesitateBeforeMs: 400, pauseAfterMs: 1200 });

  // 4. Click "+ Add Card" button
  const addCardBtn = page.locator('button:has-text("Add Card"), a:has-text("Add Card")').first();
  await addCardBtn.waitFor({ state: 'visible', timeout: 6000 });
  await humanClick(addCardBtn, { hesitateBeforeMs: 500, pauseAfterMs: 1500 });

  // 5. In Add Card modal:
  const modalContainer = page.locator('.modal.show, .modal:visible').first();
  await modalContainer.waitFor({ state: 'visible', timeout: 6000 });

  // 5a. Select Card Type
  const cardTypeDropdownBtn = modalContainer
    .locator('button')
    .filter({ hasText: /select card type/i })
    .first();
  await cardTypeDropdownBtn.waitFor({ state: 'visible', timeout: 5000 });
  await humanClick(cardTypeDropdownBtn, { hesitateBeforeMs: 400, pauseAfterMs: 800 });

  const cardTypeItem = page
    .locator('.dropdown-menu.show a, .modal.show a, a.dropdown-item:visible')
    .filter({ hasText: new RegExp(cardTypeKeyword, 'i') })
    .first();
  await cardTypeItem.waitFor({ state: 'visible', timeout: 5000 });
  await humanClick(cardTypeItem, { hesitateBeforeMs: 400, pauseAfterMs: 1800 });
  console.log(`[portal] Selected Card Type program: ${cardTypeKeyword}`);

  // 5b. Select Card Name
  const cardNameDropdownBtn = modalContainer
    .locator('button')
    .filter({ hasText: /select card/i })
    .first();
  await cardNameDropdownBtn.waitFor({ state: 'visible', timeout: 5000 });
  await humanClick(cardNameDropdownBtn, { hesitateBeforeMs: 400, pauseAfterMs: 800 });

  const cardNameItem = page
    .locator('.dropdown-menu.show a, .modal.show a, a.dropdown-item:visible')
    .filter({ hasText: new RegExp(options.bankCoreName, 'i') })
    .first();
  await cardNameItem.waitFor({ state: 'visible', timeout: 6000 });
  await humanClick(cardNameItem, { hesitateBeforeMs: 400, pauseAfterMs: 1200 });
  console.log(`[portal] Selected Card Name matching: ${options.bankCoreName}`);

  // 5c. Enter start digits
  const digitsInput = modalContainer
    .locator('input[formcontrolname="sixDigits"], input[type="text"], input[placeholder*="digit" i], input:visible')
    .first();
  await digitsInput.waitFor({ state: 'visible', timeout: 5000 });
  await digitsInput.fill('');
  await humanType(digitsInput, startDigits, { minCharDelayMs: 80, maxCharDelayMs: 140 });
  await humanHesitate(500, 1000);

  // 5d. Click Submit "Add Card"
  const submitBtn = modalContainer
    .locator('button[type="submit"]:has-text("Add Card"), button:has-text("Add Card")')
    .last();
  console.log('[portal] Clicking "Add Card" submit button...');
  await humanClick(submitBtn, { hesitateBeforeMs: 500, pauseAfterMs: 3000 });

  await page.waitForTimeout(2000);
  console.log(`✓ Card addition submitted! Returning to offers page.`);
}

  await humanHesitate(1200, 2000);

  console.log(`\n--- Step 3: Selecting Card for ${cardRow?.cardName || 'PNB'} (••${cardRow?.last4}) ---`);
  // Ensure we are on the offers page
  if (!page.url().includes('/offers')) {
    console.log('Navigating to https://rupayselect.truztee.com/#/offers ...');
    await page.goto('https://rupayselect.truztee.com/#/offers', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2500);
  }

  // The first dropdown trigger in the navbar is the Card selector
  let cardDropdownTrigger = page.locator(':is(button, a)[id*="card" i], button.nav-dropdown-trigger:not(:has-text("Explore Benefits")), :is(button, a):has-text("RuPay Select"), .navbar :is(button, a).dropdown-toggle').first();
  let triggerVisible = await cardDropdownTrigger.isVisible({ timeout: 5000 }).catch(() => false);

  if (!triggerVisible) {
    console.log('[step 3] Card dropdown not immediately visible. Consulting Autonomous LLM with full page text...');
    const step3Analysis = await analyzeCurrentPageWithLLM(page, {
      stepName: 'Step 3: Card Selection',
      goal: `Find card dropdown or navbar to switch card to ${cardRow?.cardName}`,
      cardName: cardRow?.cardName,
      accountLabel: account.label,
    });

    if (step3Analysis.classification === 'LOGIN_OR_CAPTCHA') {
      console.log(`[step 3] LLM detected session expired or login required: ${step3Analysis.explanation}`);
      throw new Error(`[LLM Analysis] Session expired or re-login required for ${account.label}: ${step3Analysis.explanation}`);
    }
    if (step3Analysis.classification === 'COOLDOWN_LIMIT') {
      const cdTime = new Date(Date.now() + (step3Analysis.cooldownMinutes ?? 20) * 60 * 1000);
      await recordPortalAccountCooldown(db, account.id, cdTime, 'portal_cooldown_detected');
      throw new Error(`[LLM Analysis] Portal cooldown active: ${step3Analysis.explanation}`);
    }
    if (step3Analysis.classification === 'BLOCKED_ERROR') {
      throw new Error(`[LLM Analysis] Card selection blocked: ${step3Analysis.explanation}`);
    }
    if (step3Analysis.recommendedAction?.selector) {
      const el = page.locator(step3Analysis.recommendedAction.selector).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        cardDropdownTrigger = el;
        triggerVisible = true;
      }
    }
  }

  const currentCardHeader = (await cardDropdownTrigger.textContent().catch(() => ''))?.trim() ?? '';
  const bankCoreName = cardRow?.cardName?.replace(/RuPay|Select|Card|Debit|Credit/gi, '').trim() || (cardRow?.cardName?.includes('India') ? 'Bank of India' : 'PNB');

  const isCardAlreadySelected = currentCardHeader.toLowerCase().includes(bankCoreName.toLowerCase());

  if (!isCardAlreadySelected && triggerVisible) {
    console.log(`Current card is "${currentCardHeader}". Checking if "${bankCoreName}" is available in dropdown...`);
    await humanClick(cardDropdownTrigger, { hesitateBeforeMs: 500, pauseAfterMs: 1000 });

    const targetCardItem = page.locator(`.dropdown-menu.show a.dropdown-item, a.dropdown-item:visible`).filter({
      hasText: new RegExp(bankCoreName, 'i')
    }).first();

    const cardFoundInDropdown = await targetCardItem.isVisible({ timeout: 2500 }).catch(() => false);

    if (cardFoundInDropdown) {
      console.log(`✓ Found "${bankCoreName}" in dropdown. Switching...`);
      await humanClick(targetCardItem, { hesitateBeforeMs: 500, pauseAfterMs: 2500 });
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await page.waitForTimeout(2000);
      const newHeader = (await cardDropdownTrigger.textContent().catch(() => ''))?.trim() ?? '';
      console.log(`✓ Active card dropdown updated to: "${newHeader}"`);
    } else {
      // Card is not yet added to this portal account: close dropdown and add it!
      await page.keyboard.press('Escape').catch(() => {});
      console.log(`[portal] ⚠️ Card matching "${bankCoreName}" not found in account's card list.`);

      await addCardToPortalAccount(page, {
        cardName: cardRow?.cardName ?? 'Bank of India RuPay Select Card',
        cardNumber: paymentDetails.cardNumber ?? '',
        portalCardType: cardRow?.portalCardType ?? 41,
        bankCoreName,
        accountLabel: account.label,
      });

      // Navigate back to offers and select the new card
      console.log('Navigating to https://rupayselect.truztee.com/#/offers ...');
      await page.goto('https://rupayselect.truztee.com/#/offers', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      // Re-trigger dropdown and select newly added card
      await humanClick(cardDropdownTrigger, { hesitateBeforeMs: 500, pauseAfterMs: 1000 });
      const newCardItem = page.locator(`.dropdown-menu.show a.dropdown-item, a.dropdown-item:visible`).filter({
        hasText: new RegExp(bankCoreName, 'i')
      }).first();
      await newCardItem.waitFor({ state: 'visible', timeout: 8000 });
      await humanClick(newCardItem, { hesitateBeforeMs: 500, pauseAfterMs: 2500 });
      await page.waitForTimeout(2000);
      const updatedHeader = (await cardDropdownTrigger.textContent().catch(() => ''))?.trim() ?? '';
      console.log(`✓ Active card dropdown updated to: "${updatedHeader}"`);
    }
  } else {
    console.log(`✓ Target card "${currentCardHeader}" already selected.`);
  }

  const targetCategory = benefitDetails.benefitType || 'Gym Access';
  console.log(`\n--- Step 4: Navigating to ${targetCategory} ---`);
  await humanHesitate(1000, 1800);
  let exploreDropdownTrigger = page.locator('button.nav-dropdown-trigger:has-text("Explore Benefits"), :is(button, a):has-text("Explore Benefits")').first();
  let exploreVisible = await exploreDropdownTrigger.isVisible({ timeout: 4000 }).catch(() => false);

  if (!exploreVisible) {
    console.log(`[step 4] "Explore Benefits" dropdown trigger not immediately visible. Consulting Autonomous LLM...`);
    const step4Analysis = await analyzeCurrentPageWithLLM(page, {
      stepName: 'Step 4: Category Navigation',
      goal: `Find "Explore Benefits" or navigate to category "${targetCategory}"`,
      cardName: cardRow?.cardName,
      accountLabel: account.label,
    });
    if (step4Analysis.recommendedAction?.selector) {
      const el = page.locator(step4Analysis.recommendedAction.selector).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        exploreDropdownTrigger = el;
        exploreVisible = true;
      }
    }
  }

  if (exploreVisible) {
    await humanClick(exploreDropdownTrigger, { hesitateBeforeMs: 500, pauseAfterMs: 1000 });
  }

  const dropdownTexts = await page.locator('.dropdown-menu.show a.dropdown-item, a.dropdown-item:visible').allTextContents().catch(() => []);
  console.log(`[dropdown] Available categories: ${dropdownTexts.map((t) => t.trim()).filter(Boolean).join(', ')}`);

  const targetLower = targetCategory.toLowerCase();
  const tokens = targetLower.split(/\s+/).filter((w) => w.length > 3);
  let matchedItemText: string | null = null;

  for (const text of dropdownTexts) {
    const t = text.trim();
    if (!t) continue;
    const tl = t.toLowerCase();
    if (tl === targetLower || tl.includes(targetLower) || targetLower.includes(tl)) {
      matchedItemText = t;
      break;
    }
  }

  if (!matchedItemText) {
    for (const text of dropdownTexts) {
      const t = text.trim();
      if (!t) continue;
      const tl = t.toLowerCase();
      if (tokens.some((token) => tl.includes(token))) {
        matchedItemText = t;
        break;
      }
    }
  }

  const categoryItem = matchedItemText
    ? page.locator(`a.dropdown-item:has-text("${matchedItemText}")`).first()
    : page.locator(`a.dropdown-item:has-text("${targetCategory}")`).first();

  if (await categoryItem.isVisible({ timeout: 2000 })) {
    console.log(`Clicking matched category: "${await categoryItem.textContent().catch(() => '')}"`);
    await humanClick(categoryItem, { hesitateBeforeMs: 400, pauseAfterMs: 1500 });
  } else {
    console.log(`Dropdown item for "${targetCategory}" not found directly. Checking first available item...`);
    const fallbackItem = page.locator(`.dropdown-menu.show a.dropdown-item, a.dropdown-item:visible`).first();
    await humanClick(fallbackItem, { hesitateBeforeMs: 400, pauseAfterMs: 1500 });
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(2000);

  console.log(`\n--- Step 5: Clicking Redeem on Category Page (${benefitDetails.exactBenefit} - Provider: ${benefitDetails.benefitProvider || 'any'}) ---`);
  await humanHesitate(1500, 2500);
  let redeemBtn: Locator | null = null;

  const targetProvider = (benefitDetails.benefitProvider || '').trim();
  const targetOffer = (benefitDetails.exactBenefit || '').trim();
  console.log(`[step 5] Searching for offer card specific to provider: "${targetProvider}", exactOffer: "${targetOffer}"...`);

  // Identify the target card using scoring on provider, duration, and keywords
  const matched = await page.evaluate(({ provider, exactOffer }) => {
    const pLower = (provider || '').toLowerCase().trim();
    const pClean = pLower.replace(/[\s-_]+/g, '');
    const offerLower = (exactOffer || '').toLowerCase().trim();

    // Clear previous attributes
    document.querySelectorAll('[data-target-offer], [data-target-redeem]').forEach((el) => {
      el.removeAttribute('data-target-offer');
      el.removeAttribute('data-target-redeem');
    });

    // Find all candidate action elements (buttons / links with 'redeem')
    const allActionEls = Array.from(document.querySelectorAll('button, a, [role="button"], div.od-redeem-btn')).filter((el) => {
      const t = el.textContent?.trim().toLowerCase() || '';
      return t.includes('redeem');
    });

    let bestContainer: HTMLElement | null = null;
    let bestActionEl: HTMLElement | null = null;
    let bestScore = -999;
    let bestIndex = -1;

    for (let i = 0; i < allActionEls.length; i++) {
      const btn = allActionEls[i] as HTMLElement;
      let curr: HTMLElement | null = btn;
      let cardContainer: HTMLElement | null = null;

      // Walk up DOM hierarchy to find the card container (stop at common card boundary or 5 levels)
      for (let depth = 0; depth < 5 && curr && curr !== document.body; depth++) {
        const cls = (curr.getAttribute('class') || '').toLowerCase();
        if (cls.includes('card') || cls.includes('deal') || cls.includes('item') || cls.includes('col-') || cls.includes('service')) {
          cardContainer = curr;
          break;
        }
        const innerActionCount = Array.from(curr.querySelectorAll('button, a, [role="button"], div.od-redeem-btn')).filter((el) => {
          const t = el.textContent?.trim().toLowerCase() || '';
          return t.includes('redeem');
        }).length;
        if (innerActionCount > 1) {
          break;
        }
        cardContainer = curr;
        curr = curr.parentElement;
      }

      if (!cardContainer) continue;

      const cardText = (cardContainer.textContent || '').toLowerCase();
      const cardTextClean = cardText.replace(/[\s-_]+/g, '');
      const imgs = Array.from(cardContainer.querySelectorAll('img'));
      const imgMatches = imgs.some((img) => {
        const src = (img.src || '').toLowerCase().replace(/[\s-_]+/g, '');
        const alt = (img.alt || '').toLowerCase().replace(/[\s-_]+/g, '');
        return pClean && (src.includes(pClean) || alt.includes(pClean));
      });

      let score = 0;

      // Check provider match
      if (pClean) {
        if (cardTextClean.includes(pClean) || imgMatches) {
          score += 50;
        } else {
          continue; // Must match provider if specified
        }
      }

      // Check exact offer match
      if (offerLower && !offerLower.startsWith('any one of')) {
        if (cardText.includes(offerLower)) {
          score += 100;
        }

        // Check duration match (e.g. "1 month" vs "3 month", "12 month")
        const durationMatch = offerLower.match(/(\d+)\s*month/i);
        if (durationMatch) {
          const months = durationMatch[1];
          const hasExactMonths =
            cardText.includes(`${months} month`) ||
            cardText.includes(`${months}-month`) ||
            cardText.includes(`${months}month`) ||
            cardText.includes(`${months} m`);
          if (hasExactMonths) {
            score += 60;
          } else {
            // Check if card explicitly specifies a conflicting duration (e.g. 3 Month when looking for 1 Month)
            const otherDurationMatch = cardText.match(/(\d+)\s*month/i);
            if (otherDurationMatch && otherDurationMatch[1] !== months) {
              score -= 80; // Heavy penalty for conflicting duration!
            }
          }
        }

        // Check key distinctive keywords in exactOffer
        const keywords = offerLower
          .split(/[\s-]+/)
          .map((w) => w.trim().toLowerCase())
          .filter((w) => w.length > 3 && !['month', 'pass', 'subscription', 'free', 'access', 'card'].includes(w));
        for (const kw of keywords) {
          if (cardText.includes(kw)) {
            score += 30;
          }
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestContainer = cardContainer;
        bestActionEl = btn;
        bestIndex = i;
      }
    }

    if (bestActionEl && bestContainer) {
      bestContainer.setAttribute('data-target-offer', 'true');
      bestActionEl.setAttribute('data-target-redeem', 'true');
      return {
        found: true,
        score: bestScore,
        index: bestIndex,
        cardTextSnippet: (bestContainer.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      };
    }

    return { found: false, score: bestScore, index: -1, cardTextSnippet: '' };
  }, { provider: targetProvider, exactOffer: targetOffer });

  if (matched.found) {
    console.log(`[step 5] ✓ Matched exact target card (score: ${matched.score}, index: ${matched.index}): "${matched.cardTextSnippet}"`);
    redeemBtn = page.locator('[data-target-redeem="true"]').first();
    if (!(await redeemBtn.isVisible().catch(() => false))) {
      const cardEl = page.locator('[data-target-offer="true"]').first();
      await cardEl.scrollIntoViewIfNeeded().catch(() => {});
      redeemBtn = cardEl.locator(':is(button, a, [role="button"], div.od-redeem-btn):has-text("Redeem"), div.od-redeem-btn').first();
    }
  } else {
    // Fallback: standard Redeem locator
    redeemBtn = page.locator('button.od-redeem-btn, button:has-text("Redeem"), div.od-redeem-btn').first();
  }

  if (!redeemBtn || !(await redeemBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    console.log('[step 5] Standard redeem matching uncertain. Consulting Autonomous LLM with full page text...');
    const pageAnalysis = await analyzeCurrentPageWithLLM(page, {
      stepName: 'Step 5: Offer Selection',
      goal: `Find and redeem target offer "${targetOffer}" (${targetProvider})`,
      cardName: cardRow?.cardName,
      targetOffer,
      provider: targetProvider,
      accountLabel: account.label,
    });
    if (pageAnalysis.classification === 'BLOCKED_ERROR') {
      throw new Error(`[LLM Analysis] Offer blocked on portal: ${pageAnalysis.explanation}`);
    }
    if (pageAnalysis.classification === 'COOLDOWN_LIMIT') {
      const cooldownMs = (pageAnalysis.cooldownMinutes ?? 20) * 60 * 1000;
      await recordPortalAccountCooldown(db, account.id, new Date(Date.now() + cooldownMs), 'portal_cooldown_detected');
      throw new Error(`[LLM Analysis] Portal cooldown active: ${pageAnalysis.explanation}`);
    }
    if (pageAnalysis.recommendedAction?.selector) {
      redeemBtn = page.locator(pageAnalysis.recommendedAction.selector).first();
    }
    if (!redeemBtn || !(await redeemBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      throw new Error(`Target offer "${targetOffer}" (${targetProvider}) could NOT be found. LLM Analysis: ${pageAnalysis.explanation}`);
    }
  }

  console.log('[step 5] Scrolling Redeem button into view and clicking naturally...');
  await redeemBtn.scrollIntoViewIfNeeded().catch(() => {});
  await redeemBtn.waitFor({ state: 'visible', timeout: 5000 });
  await humanClick(redeemBtn, { hesitateBeforeMs: 600, pauseAfterMs: 1500 });
  await redeemBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {});

  console.log('\n--- Step 6: Checking Benefit Page / Payment Modal ---');
  await humanHesitate(1800, 2800);
  const continueDirectly = page.locator(':is(button, a, [role="button"]):has-text("Continue to Payment"):visible, button.btn-custom_modal:has-text("Continue"):visible, button:has-text("Continue"):visible').first();
  if (await continueDirectly.isVisible({ timeout: 2000 })) {
    console.log('[step 6] "Continue to Payment" already visible; skipping separate "Redeem Now" step.');
  } else {
    const redeemNowBtn = page.locator('button:has-text("Redeem Now"), a:has-text("Redeem Now"), button.btn-redeem-now:visible').first();
    if (await redeemNowBtn.isVisible({ timeout: 4000 })) {
      console.log('[step 6] Found "Redeem Now" button, scrolling and clicking...');
      await redeemNowBtn.scrollIntoViewIfNeeded().catch(() => {});
      await humanClick(redeemNowBtn, { hesitateBeforeMs: 700, pauseAfterMs: 1500 });
      await redeemNowBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {});
    } else {
      console.log('[step 6] "Redeem Now" not present. Consulting Autonomous LLM with full page text...');
      const modalAnalysis = await analyzeCurrentPageWithLLM(page, {
        stepName: 'Step 6: Payment Confirmation Modal',
        goal: 'Advance past terms/confirmation modal to payment gateway',
        cardName: cardRow?.cardName,
        targetOffer,
        accountLabel: account.label,
      });
      if (modalAnalysis.classification === 'COOLDOWN_LIMIT') {
        const cdTime = new Date(Date.now() + (modalAnalysis.cooldownMinutes ?? 20) * 60 * 1000);
        console.log(`[step 6] ⏱️ Autonomous LLM detected portal cooldown: ${modalAnalysis.explanation}`);
        await recordPortalAccountCooldown(db, account.id, cdTime, 'transaction_initiated_cooldown');
        cooldownDetectedUntil = cdTime;
      } else if (modalAnalysis.classification === 'BLOCKED_ERROR') {
        throw new Error(`[LLM Analysis] Order blocked: ${modalAnalysis.explanation}`);
      } else if (modalAnalysis.recommendedAction?.selector) {
        const actionLoc = page.locator(modalAnalysis.recommendedAction.selector).first();
        if (await actionLoc.isVisible().catch(() => false)) {
          await humanClick(actionLoc, { hesitateBeforeMs: 500, pauseAfterMs: 1500 });
        }
      }
    }
  }

  console.log('\n--- Step 7: Payment Confirmation Modal ---');
  await humanHesitate(2000, 3200); // Allow modal animation to complete and simulate human reading

  const continueToPaymentBtn = page
    .locator(':is(button, a, [role="button"]):has-text("Continue to Payment"):visible, button.btn-custom_modal:has-text("Continue"):visible, .modal button:has-text("Continue"):visible, button:has-text("Continue"):visible, button.btn-custom_modal:visible, button:has-text("Proceed"):visible')
    .first();

  let continueBtnVisible = await continueToPaymentBtn.isVisible({ timeout: 4000 }).catch(() => false);
  if (!continueBtnVisible) {
    console.log('[step 7] "Continue to Payment" not immediately visible. Consulting Autonomous LLM with full page text...');
    const step7Analysis = await analyzeCurrentPageWithLLM(page, {
      stepName: 'Step 7: Payment Confirmation Modal',
      goal: 'Find Continue to Payment button or diagnose blocking modal',
      cardName: cardRow?.cardName,
      targetOffer,
      accountLabel: account.label,
    });
     if (step7Analysis.classification === 'COOLDOWN_LIMIT') {
      const cdTime = new Date(Date.now() + (step7Analysis.cooldownMinutes ?? 20) * 60 * 1000);
      console.log(`[step 7] ⏱️ Autonomous LLM detected portal cooldown: ${step7Analysis.explanation}`);
      await recordPortalAccountCooldown(db, account.id, cdTime, 'transaction_initiated_cooldown');
      cooldownDetectedUntil = cdTime;

      // Notify failure via Telegram (with screenshot if available)
      if (telegramChatId) {
        const tg = getTelegramClient();
        const screenshot = await page.screenshot({ timeout: 5000 }).catch(() => null);
        if (screenshot) {
          await tg.sendOrderFailureWithScreenshot({
            chatId: telegramChatId,
            cardName: cardRow?.cardName ?? 'RuPay Card',
            cardLast4: cardRecord?.lastDigits ?? undefined,
            portalAccountLabel: account.label,
            benefitName: benefitDetails.exactBenefit,
            provider: benefitDetails.benefitProvider || undefined,
            category: benefitDetails.benefitType || undefined,
            voucherValue: benefitDetails.cashValue || undefined,
            reason: 'Portal cooldown detected',
            errorDetail: step7Analysis.explanation,
            screenshotBuffer: screenshot,
          }).catch((err) => console.error('[telegram] Failed to send order failure notification:', err));
        } else {
          await tg.sendOrderFailure({
            chatId: telegramChatId,
            cardName: cardRow?.cardName ?? 'RuPay Card',
            cardLast4: cardRecord?.lastDigits ?? undefined,
            portalAccountLabel: account.label,
            benefitName: benefitDetails.exactBenefit,
            provider: benefitDetails.benefitProvider || undefined,
            category: benefitDetails.benefitType || undefined,
            voucherValue: benefitDetails.cashValue || undefined,
            reason: 'Portal cooldown detected',
            errorDetail: step7Analysis.explanation,
          }).catch((err) => console.error('[telegram] Failed to send order failure notification:', err));
        }
      }
      await context.close().catch(() => {});
      await client.end().catch(() => {});

      return { attempted: true, accountLabel: account.label, instanceId: candidate.instanceId, reason: 'cooldown_active' };
    }
    if (step7Analysis.classification === 'BLOCKED_ERROR') {
      throw new Error(`[LLM Analysis] Cannot proceed to payment: ${step7Analysis.explanation}`);
    }
    if (step7Analysis.recommendedAction?.selector) {
      const actionLoc = page.locator(step7Analysis.recommendedAction.selector).first();
      if (await actionLoc.isVisible().catch(() => false)) {
        await humanClick(actionLoc, { hesitateBeforeMs: 500, pauseAfterMs: 1500 });
        continueBtnVisible = true;
      }
    }
  }

  if (await continueToPaymentBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('Gliding cursor and clicking "Continue to Payment" naturally...');
    await humanClick(continueToPaymentBtn, { hesitateBeforeMs: 800, pauseAfterMs: 1200 });
    // Also dispatch DOM click in case synthetic Playwright click didn't trigger attached Vue/jQuery handler
    await continueToPaymentBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {});
  }

  console.log('Waiting for response / gateway redirect...');
  let isEmbeddedGateway = false;
  for (let sec = 0; sec < 30; sec++) {
    if (popupTracker.page) {
      console.log(`[gateway] Detected payment popup page: ${popupTracker.page.url()}`);
      break;
    }
    if (!page.url().includes('rupayselect.truztee.com')) {
      console.log(`[gateway] Main page redirected to gateway: ${page.url()}`);
      break;
    }
    // Check if an embedded gateway iframe (Razorpay, Juspay, etc.) has appeared on the page
    const frames = page.frames();
    const paymentFrame = frames.find((f) => {
      const u = f.url().toLowerCase();
      return u.includes('razorpay') || u.includes('juspay') || u.includes('payu') || u.includes('billdesk');
    });
    const razorpayIframeEl = page.locator('iframe[src*="razorpay"], iframe.razorpay-checkout-frame, iframe[src*="juspay"]');
    if (paymentFrame || (await razorpayIframeEl.isVisible().catch(() => false))) {
      console.log(`[gateway] Embedded payment gateway detected (frame: ${paymentFrame?.url() ?? 'iframe in DOM'})`);
      isEmbeddedGateway = true;
      break;
    }
    if (cooldownDetectedUntil) {
      break;
    }
    // Re-click if still on truztee after 4 seconds and no gateway visible
    if (sec === 4 && page.url().includes('rupayselect.truztee.com')) {
      try {
        const btn = page.locator(':is(button, a, [role="button"]):has-text("Continue to Payment"):visible, button.btn-custom_modal:has-text("Continue"):visible, .modal button:has-text("Continue"):visible, button:has-text("Continue"):visible').first();
        if (await btn.isVisible()) {
          console.log('[gateway] Re-clicking "Continue to Payment"...');
          await btn.click({ force: true });
          await btn.evaluate((el: HTMLElement) => el.click()).catch(() => {});
        }
      } catch {}
    }
    await page.waitForTimeout(1000);
  }

  if (cooldownDetectedUntil) {
    const cd = cooldownDetectedUntil as Date;
    console.log(`\n======================================================`);
    console.log(`NOTICE: Account cooldown active until ${cd.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)`);
    console.log(`The database has been updated. Next automation run will wait until then.`);
    console.log(`======================================================\n`);
    await context.close();
    await client.end();
    return {
      attempted: true,
      accountLabel: account.label,
      instanceId: candidate.instanceId,
      reason: 'cooldown_detected',
    };
  }

  const activePaymentPage: Page = popupTracker.page ?? page;
  if (!isEmbeddedGateway && activePaymentPage.url().includes('rupayselect.truztee.com')) {
    console.error('[gateway] Fatal: Gateway did not redirect/open within 30s. Saving screenshot...');
    await activePaymentPage.screenshot({ path: 'gateway-redirect-failed.png' });
    await context.close();
    await client.end();

    // Notify failure via Telegram (with screenshot)
    if (telegramChatId) {
      const tg = getTelegramClient();
      const screenshot = await activePaymentPage.screenshot({ timeout: 5000 }).catch(() => null);
      if (screenshot) {
        await tg.sendOrderFailureWithScreenshot({
          chatId: telegramChatId,
          cardName: cardRow?.cardName ?? 'RuPay Card',
          cardLast4: cardRecord?.lastDigits ?? undefined,
          portalAccountLabel: account.label,
          benefitName: benefitDetails.exactBenefit,
          provider: benefitDetails.benefitProvider || undefined,
          category: benefitDetails.benefitType || undefined,
          voucherValue: benefitDetails.cashValue || undefined,
          reason: 'Gateway redirect failed',
          errorDetail: 'Payment gateway did not redirect within 30s.',
          screenshotBuffer: screenshot,
        }).catch((err) => console.error('[telegram] Failed to send order failure notification:', err));
      } else {
        await tg.sendOrderFailure({
          chatId: telegramChatId,
          cardName: cardRow?.cardName ?? 'RuPay Card',
          cardLast4: cardRecord?.lastDigits ?? undefined,
          portalAccountLabel: account.label,
          benefitName: benefitDetails.exactBenefit,
          provider: benefitDetails.benefitProvider || undefined,
          category: benefitDetails.benefitType || undefined,
          voucherValue: benefitDetails.cashValue || undefined,
          reason: 'Gateway redirect failed',
          errorDetail: 'Payment gateway did not redirect within 30s.',
        }).catch((err) => console.error('[telegram] Failed to send order failure notification:', err));
      }
    }

    return {
      attempted: true,
      accountLabel: account.label,
      instanceId: candidate.instanceId,
      reason: 'gateway_redirect_failed',
    };
  }

  // Active payment page (either new tab or current page redirect)
  console.log(`Payment Page URL: ${activePaymentPage.url()}`);
  await activePaymentPage.waitForLoadState('domcontentloaded').catch(() => {});
  await activePaymentPage.waitForTimeout(3000); // Allow gateway and iframes to render
  console.log(`Payment Page Title: ${await activePaymentPage.title()}`);

  // Inspect payment form elements (inputs, iframes)
  const formAnalysis = await activePaymentPage.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])')).map((el) => ({
      type: el.type,
      id: el.id,
      name: el.name,
      placeholder: el.placeholder,
      className: el.className,
      ariaLabel: el.getAttribute('aria-label'),
    }));
    const iframes = Array.from(document.querySelectorAll('iframe')).map((f) => ({
      src: f.src,
      id: f.id,
      title: f.title,
    }));
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).map((b) => ({
      text: b.textContent?.trim(),
      id: b.id,
      className: b.className,
    })).filter((b) => b.text);
    return { inputs, iframes, buttons };
  });

  console.log('Payment Gateway Elements Detected:', JSON.stringify(formAnalysis, null, 2));

  // Step 8: Static Payment Gateway Automation
  if (paymentDetails && (paymentDetails.mode === 'full' || paymentDetails.mode === 'saved_card')) {
    console.log('\n--- Step 8: Executing Static Gateway Automation ---');
    const filled = await fillCardDetailsOnGateway(activePaymentPage, paymentDetails, {
      phoneNumber: targetPhoneNumber,
      email: account.label,
    });
    if (filled) {
      console.log('✓ Card details filled! Clicking primary Make Payment / Proceed button...');
      await clickPayButton(activePaymentPage);
    } else {
      console.log('⚠️ Could not fill all card fields automatically. Please verify in the open browser.');
    }
  }

  await activePaymentPage.screenshot({ path: 'payment-gateway-screen.png' });
  console.log('Saved payment-gateway-screen.png');

  // Step 8b: Handle RBI Tokenization Modal & Post-Payment Gateway Transition with LLM
  console.log('\n--- Step 8b: Monitoring Post-Payment Gateway Transition with LLM ---');
  const transitionResult = await handlePostPaymentTransition(activePaymentPage, {
    maxWaitSec: 40,
    phoneNumber: targetPhoneNumber,
    email: account.label,
  });
  const cardLast4 = cardRecord?.lastDigits ?? '1746';

  let otpCompleted = false;

  // Create portal order attempt record to track this execution
  const [attempt] = await db
    .insert(schema.portalOrderAttempts)
    .values({
      workspaceId: account.workspaceId,
      portalAccountId: account.id,
      instanceId: candidate.instanceId,
      ruleId: candidate.ruleId,
      state: 'submitting',
      submissionStartedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      jobRunId: options?.jobRunId ?? null,
    })
    .returning();

  // A portal refusal: the portal or the bank will not serve this benefit for
  // this card. The wording on the page is the authority — the LLM only tells
  // us that something is blocking, and its explanation is a paraphrase. So the
  // page text is classified, with the explanation as a fallback.
  //
  // Only read the page when the transition did not succeed or reach the OTP
  // screen: on those paths the page is a confirmation or a bank form, and
  // reading it would be wasted work.
  const mayHaveBeenRefused =
    !transitionResult.reachedSuccess && !transitionResult.reachedOtp;

  let refusalCode: PortalRefusalCode | null = null;
  if (mayHaveBeenRefused) {
    const pageText = await activePaymentPage
      .evaluate(() => document.body.innerText)
      .catch(() => '');
    refusalCode =
      classifyPortalRefusal(pageText) ??
      classifyPortalRefusal(transitionResult.reason) ??
      (transitionResult.cardExhausted ? 'card_limit_reached' : null);
  }

  if (refusalCode) {
    const refusalSource: PortalRefusalSource = 'rupay_portal';
    const detail = (transitionResult.reason ?? '').trim() || null;
    console.log(
      `\n❌ RuPay portal refused this benefit: ${refusalCode} (${transitionResult.reason ?? 'no detail'}).`,
    );

    await db
      .update(schema.portalOrderAttempts)
      .set({
        state: 'failed_pre_submit',
        failureCode: refusalCode === 'card_limit_reached' ? 'card_limit_exhausted' : 'offer_unavailable',
        finishedAt: new Date(),
      })
      .where(eq(schema.portalOrderAttempts.id, attempt.id));

    // Record the refusal against the benefit instance. The instance's order
    // status is deliberately left alone — the benefit was never ordered, so it
    // stays 'Not Ordered'. The refusal is what explains why, and it is what
    // stops the worker retrying it every hour. See REQUIREMENTS.md §6 and RH#16.
    await recordPortalRefusal(db, {
      instanceId: candidate.instanceId,
      code: refusalCode,
      source: refusalSource,
      detail,
    });

    console.log(
      `[portal] Benefit instance ${candidate.instanceId} recorded as refused by the portal: ${refusalCode}.`,
    );
    await activePaymentPage.waitForTimeout(1000).catch(() => {});

    // Notify failure via Telegram (with screenshot if available)
    if (telegramChatId) {
      const tg = getTelegramClient();
      const screenshot = await activePaymentPage.screenshot({ timeout: 5000 }).catch(() => null);
      if (screenshot) {
        await tg.sendOrderFailureWithScreenshot({
          chatId: telegramChatId,
          cardName: cardRow?.cardName ?? 'RuPay Card',
          cardLast4: cardRecord?.lastDigits ?? undefined,
          portalAccountLabel: account.label,
          benefitName: benefitDetails.exactBenefit,
          provider: benefitDetails.benefitProvider || undefined,
          category: benefitDetails.benefitType || undefined,
          voucherValue: benefitDetails.cashValue || undefined,
          reason: 'Portal refused this benefit',
          errorDetail: refusalCode === 'card_limit_reached' ? 'Card benefit limit exhausted' : `Refusal code: ${refusalCode}. ${detail ?? ''}`,
          screenshotBuffer: screenshot,
        }).catch((err) => console.error('[telegram] Failed to send order failure notification:', err));
      } else {
        await tg.sendOrderFailure({
          chatId: telegramChatId,
          cardName: cardRow?.cardName ?? 'RuPay Card',
          cardLast4: cardRecord?.lastDigits ?? undefined,
          portalAccountLabel: account.label,
          benefitName: benefitDetails.exactBenefit,
          provider: benefitDetails.benefitProvider || undefined,
          category: benefitDetails.benefitType || undefined,
          voucherValue: benefitDetails.cashValue || undefined,
          reason: 'Portal refused this benefit',
          errorDetail: refusalCode === 'card_limit_reached' ? 'Card benefit limit exhausted' : `Refusal code: ${refusalCode}. ${detail ?? ''}`,
        }).catch((err) => console.error('[telegram] Failed to send order failure notification:', err));
      }
    }
    await context.close().catch(() => {});
    await client.end().catch(() => {});

    return {
      attempted: true,
      accountLabel: account.label,
      instanceId: candidate.instanceId,
      reason: 'portal_refused',
    };
  }

  if (transitionResult.reachedSuccess) {
    console.log('✓ Order confirmation screen reached directly!');
    otpCompleted = true;
  } else if (transitionResult.reachedOtp) {
    // Step 9: 3D-Secure Bank OTP Prompt
    console.log('\n--- Step 9: 3D-Secure Verification / OTP (Confirmed by LLM) ---');

    if (telegramChatId) {
      console.log(`[gateway] OTP recipient: Telegram Chat ${telegramChatId}`);
    } else if (targetPhoneNumber) {
      console.log(`[gateway] OTP recipient: ${targetPhoneNumber} (${settings?.whatsappPhoneNumber ? 'workspace owner' : 'account default'})`);
    }

    otpCompleted = await promptForOtpAndSubmit(
      activePaymentPage,
      {
        db,
        portalAccountId: account.id,
        portalAccountLabel: account.label,
        attemptId: attempt.id,
        telegramChatId,
        phoneNumber: targetPhoneNumber,
        cardName: cardRow?.cardName ?? 'RuPay Card',
        cardLast4,
        benefitName: benefitDetails.exactBenefit,
        provider: benefitDetails.benefitProvider || undefined,
        category: benefitDetails.benefitType || undefined,
        voucherValue: benefitDetails.cashValue || undefined,
      },
      180000,
    );
  } else {
    console.log(`\n[gateway] ⚠️ Bank OTP screen was not reached (${transitionResult.reason || 'timeout'}). Skipping OTP notification.`);
    await db
      .update(schema.portalOrderAttempts)
      .set({
        state: 'failed_pre_submit',
        finishedAt: new Date(),
        failureCode: 'otp_screen_not_reached',
      })
      .where(eq(schema.portalOrderAttempts.id, attempt.id));
  }

  if (otpCompleted) {
    console.log('Monitoring transaction completion & booking reference...');
    let bookingRef: string | null = null;
    for (let sec = 0; sec < 120; sec++) {
      await activePaymentPage.waitForTimeout(1000);
      const currUrl = activePaymentPage.url();
      if (sec % 10 === 0) {
        console.log(`[monitor] Waiting for transaction completion (${sec}s / 120s) - URL: ${currUrl}`);
      }

      // 1. Immediate match in URL (e.g. #/Success/RUPS-E4084B90 or ?orderId=RUPS-E4084B90)
      const urlMatch = currUrl.match(/RUPS-[A-Za-z0-9]+/i);
      if (urlMatch) {
        bookingRef = urlMatch[0].toUpperCase();
        console.log(`[monitor] ✓ Extracted booking reference from URL: ${bookingRef}`);
        break;
      }

      const urlLower = currUrl.toLowerCase();
      const isPostPaymentSuccess =
        urlLower.includes('success') ||
        urlLower.includes('confirm') ||
        urlLower.includes('booking') ||
        urlLower.includes('truztee.com/#/myaccount') ||
        urlLower.includes('truztee.com/#/view-redeemed-offers');

      if (isPostPaymentSuccess) {
        // 2. If tracked initiated order ID is confirmed on a success page
        if (initiatedOrderId && urlLower.includes('success')) {
          bookingRef = initiatedOrderId;
          console.log(`[monitor] ✓ Confirmed tracked order ID from success redirect: ${bookingRef}`);
          break;
        }

        const pageText = await activePaymentPage.evaluate(() => document.body.innerText).catch(() => '');
        
        // Exclude pages that explicitly say "Initiated" or "Failure" without any "Success"
        const isOnlyInitiated = pageText.includes('Initiated') && !pageText.includes('Success') && !pageText.includes('Successful');
        if (!isOnlyInitiated) {
          // Exclude common non-ID generic English words
          const invalidWords = new Set([
            'process', 'processing', 'pending', 'initiated', 'failed', 'failure',
            'cancelled', 'loading', 'success', 'successful', 'transaction', 'completed',
            'reference', 'confirmed', 'details', 'status', 'summary', 'payment', 'please'
          ]);

          const matches = Array.from(pageText.matchAll(/(?:booking|reference|order|transaction)\s*(?:id|no|#)?\s*[:\-]?\s*([A-Za-z0-9\-_]{6,30})/gi));
          for (const m of matches) {
            const cand = m[1].trim();
            if (!invalidWords.has(cand.toLowerCase()) && (/[0-9]/.test(cand) || cand.toUpperCase().startsWith('RUP'))) {
              bookingRef = cand;
              break;
            }
          }

          if (bookingRef) break;
        }
      }
    }

    // Fallback: If not found in page text, check Truztee My Account table directly
    if (!bookingRef) {
      console.log('[monitor] Direct booking reference not found in post-payment page. Checking Truztee My Account page...');
      try {
        const checkPage = popupTracker.page && !popupTracker.page.isClosed() ? popupTracker.page : page;
        await checkPage.goto('https://rupayselect.truztee.com/#/myaccount').catch(() => {});
        await checkPage.waitForTimeout(4000);

        const latestOrder = await checkPage.evaluate((targetOrderId) => {
          const rows = Array.from(document.querySelectorAll('tr'));
          if (targetOrderId) {
            const targetRow = rows.find((r) => r.innerText.includes(targetOrderId));
            if (targetRow) {
              const text = targetRow.innerText;
              const isSuccess = text.includes('Success') || text.includes('Successful') || text.includes('Completed');
              if (isSuccess) return targetOrderId;
              return null;
            }
          }
          const todayDateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
          for (const r of rows) {
            const text = r.innerText;
            const isConfirmedStatus = text.includes('Success') || text.includes('Successful') || text.includes('Completed');
            const isToday = text.includes(todayDateStr);
            if (isConfirmedStatus && isToday) {
              const chip = r.querySelector('.ma-order-chip');
              if (chip) {
                return chip.textContent?.trim() || null;
              }
            }
          }
          return null;
        }, initiatedOrderId).catch(() => null);

        if (latestOrder && latestOrder.startsWith('RUP')) {
          console.log(`[monitor] ✓ Found Confirmed Order ID from My Account table: ${latestOrder}`);
          bookingRef = latestOrder;
        } else {
          // Check if there is an Initiated row to alert
          const initiatedChip = await checkPage.evaluate(() => {
            const rows = Array.from(document.querySelectorAll('tr'));
            for (const r of rows) {
              const text = r.innerText;
              if (text.includes('Initiated')) {
                const chip = r.querySelector('.ma-order-chip');
                if (chip) return chip.textContent?.trim() || null;
              }
            }
            return null;
          }).catch(() => null);

          if (initiatedChip) {
            console.warn(`[monitor] ⚠️ Order ${initiatedChip} is still in "Initiated" state on Truztee (bank capture pending or cooldown). Will not mark as confirmed.`);
          }
        }
      } catch (err) {
        console.warn('[monitor] Error checking My Account table:', err);
      }
    }

    if (bookingRef) {
      console.log(`\n🎉 Booking Reference Confirmed: ${bookingRef}`);
      const today = new Date().toLocaleDateString('en-CA'); // 'YYYY-MM-DD'

      try {
        await finalizeConfirmedOrder(db as any, attempt.id, bookingRef, today);
        if (candidate.chosenOptionId) {
          await db
            .update(schema.benefitInstances)
            .set({ chosenOptionId: candidate.chosenOptionId })
            .where(eq(schema.benefitInstances.id, candidate.instanceId));
        }
        console.log(`[portal] ✓ Successfully auto-recorded booking ID "${bookingRef}" against benefit instance ${candidate.instanceId} in portal database!`);
      } catch (e) {
        console.error('[portal] Error in finalizeConfirmedOrder, running direct update:', e);
        await db
          .update(schema.benefitInstances)
          .set({
            orderStatus: 'Ordered but Coupon not received',
            orderDate: today,
            rupayBookingId: bookingRef,
            ...(candidate.chosenOptionId ? { chosenOptionId: candidate.chosenOptionId } : {}),
            comments: `Auto-ordered via RuPay portal runner on ${today} (Ref: ${bookingRef})`,
          })
          .where(eq(schema.benefitInstances.id, candidate.instanceId));

        await db
          .update(schema.portalOrderAttempts)
          .set({ state: 'confirmed', bookingReference: bookingRef, finishedAt: new Date() })
          .where(eq(schema.portalOrderAttempts.id, attempt.id));

        const cooldown24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
        await recordPortalAccountCooldown(db as any, account.id, cooldown24h, 'order_completed_cooldown');
        console.log(`[portal] ✓ Direct fallback update completed for instance ${candidate.instanceId}.`);
      }

      const cooldown24h = new Date(Date.now() + 24 * 60 * 60 * 1000);
      console.log(`[portal] ⏱️ Account "${account.label}" placed into 24-hour cooldown until: ${cooldown24h.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`);
      if (telegramChatId) {
        const tg = getTelegramClient();
        await tg.sendBookingConfirmation({
          chatId: telegramChatId,
          cardName: cardRow?.cardName ?? 'RuPay Card',
          cardLast4,
          portalAccountLabel: account.label,
          benefitName: benefitDetails.exactBenefit,
          provider: benefitDetails.benefitProvider || undefined,
          category: benefitDetails.benefitType || undefined,
          voucherValue: benefitDetails.cashValue || undefined,
          bookingRef,
        });
        console.log(`[gateway] Sent booking confirmation via Telegram to ${telegramChatId}.`);
      } else if (targetPhoneNumber) {
        const whatsapp = getWhatsAppClient();
        await whatsapp.sendBookingConfirmation({
          to: targetPhoneNumber,
          cardName: cardRow?.cardName ?? 'RuPay Card',
          benefitName: benefitDetails.exactBenefit,
          bookingRef,
        });
        console.log(`[gateway] Sent booking confirmation via WhatsApp to ${targetPhoneNumber}.`);
      }

      console.log('\n🎉 Order completed and confirmed. Closing browser cleanly...');
      await page.waitForTimeout(1500).catch(() => {});
      await context.close().catch(() => {});
      await client.end().catch(() => {});
      console.log('✓ Automation finished cleanly.');
      // Return, do not exit: a batch run must continue with the next account.
      return {
        attempted: true,
        accountLabel: account.label,
        instanceId: candidate.instanceId,
        reason: 'ordered',
      };
    }

    // If loop finished without finding a booking reference, check if order is still pending or failed
    const finalUrl = activePaymentPage.url();
    const finalPageText = await activePaymentPage.evaluate(() => document.body.innerText).catch(() => '');
    const isDefinitiveFailure =
      finalPageText.includes('Transaction Failed') ||
      finalPageText.includes('Payment Failed') ||
      finalPageText.includes('Transaction Cancelled') ||
      finalUrl.includes('failure') ||
      finalUrl.includes('cancel');

    if (isDefinitiveFailure) {
      console.log(`\n❌ Payment definitive failure detected in browser.`);
      await db
        .update(schema.portalOrderAttempts)
        .set({ state: 'uncertain', failureCode: 'gateway_declined', finishedAt: new Date() })
        .where(eq(schema.portalOrderAttempts.id, attempt.id));
      await activePaymentPage.waitForTimeout(2000).catch(() => {});

      // Notify failure via Telegram (with screenshot)
      if (telegramChatId) {
        const tg = getTelegramClient();
        const screenshot = await activePaymentPage.screenshot({ timeout: 5000 }).catch(() => null);
        if (screenshot) {
          await tg.sendOrderFailureWithScreenshot({
            chatId: telegramChatId,
            cardName: cardRow?.cardName ?? 'RuPay Card',
            cardLast4: cardRecord?.lastDigits ?? undefined,
            portalAccountLabel: account.label,
            benefitName: benefitDetails.exactBenefit,
            provider: benefitDetails.benefitProvider || undefined,
            category: benefitDetails.benefitType || undefined,
            voucherValue: benefitDetails.cashValue || undefined,
            reason: 'Payment gateway declined the transaction',
            errorDetail: `Page text indicates: ${finalPageText.slice(0, 100)}`,
            screenshotBuffer: screenshot,
          }).catch((err) => console.error('[telegram] Failed to send order failure notification:', err));
        } else {
          await tg.sendOrderFailure({
            chatId: telegramChatId,
            cardName: cardRow?.cardName ?? 'RuPay Card',
            cardLast4: cardRecord?.lastDigits ?? undefined,
            portalAccountLabel: account.label,
            benefitName: benefitDetails.exactBenefit,
            provider: benefitDetails.benefitProvider || undefined,
            category: benefitDetails.benefitType || undefined,
            voucherValue: benefitDetails.cashValue || undefined,
            reason: 'Payment gateway declined the transaction',
            errorDetail: `Page text indicates: ${finalPageText.slice(0, 100)}`,
          }).catch((err) => console.error('[telegram] Failed to send order failure notification:', err));
        }
      }
      await context.close().catch(() => {});
      await client.end().catch(() => {});

      // Do not exit the process: a batch run must continue with the next
      // account and report this one as failed.
      return {
        attempted: true,
        accountLabel: account.label,
        instanceId: candidate.instanceId,
        reason: 'payment_failed',
      };
    }
  } else {
    console.log(`\n⚠️ OTP was not completed or timed out.`);
    await db
      .update(schema.portalOrderAttempts)
      .set({ state: 'failed_pre_submit', failureCode: 'otp_timeout', finishedAt: new Date() })
      .where(eq(schema.portalOrderAttempts.id, attempt.id));

    // Notify failure via Telegram (with screenshot if available)
    if (telegramChatId) {
      const tg = getTelegramClient();
      const screenshot = await activePaymentPage.screenshot({ timeout: 5000 }).catch(() => null);
      if (screenshot) {
        await tg.sendOrderFailureWithScreenshot({
          chatId: telegramChatId,
          cardName: cardRow?.cardName ?? 'RuPay Card',
          cardLast4: cardRecord?.lastDigits ?? undefined,
          portalAccountLabel: account.label,
          benefitName: benefitDetails.exactBenefit,
          provider: benefitDetails.benefitProvider || undefined,
          category: benefitDetails.benefitType || undefined,
          voucherValue: benefitDetails.cashValue || undefined,
          reason: 'OTP not completed or timed out',
          errorDetail: transitionResult.reason || 'No OTP screen was reached or the OTP entry timed out.',
          screenshotBuffer: screenshot,
        }).catch((err) => console.error('[telegram] Failed to send order failure notification:', err));
      } else {
        await tg.sendOrderFailure({
          chatId: telegramChatId,
          cardName: cardRow?.cardName ?? 'RuPay Card',
          cardLast4: cardRecord?.lastDigits ?? undefined,
          portalAccountLabel: account.label,
          benefitName: benefitDetails.exactBenefit,
          provider: benefitDetails.benefitProvider || undefined,
          category: benefitDetails.benefitType || undefined,
          voucherValue: benefitDetails.cashValue || undefined,
          reason: 'OTP not completed or timed out',
          errorDetail: transitionResult.reason || 'No OTP screen was reached or the OTP entry timed out.',
        }).catch((err) => console.error('[telegram] Failed to send order failure notification:', err));
      }
    }
  }

  await activePaymentPage.waitForTimeout(2000).catch(() => {});
  await context.close().catch(() => {});
  await client.end().catch(() => {});
  console.log('Done.');
  return {
    attempted: true,
    accountLabel: account.label,
    instanceId: candidate.instanceId,
    reason: 'ordered',
  };
}

// The CLI block runs only when this module is the entry point AND the caller
// explicitly asked for it.
//
// The `import.meta.url` check alone is not enough: the worker is bundled by
// esbuild into a single file, and inside that bundle `import.meta.url` is the
// *bundle's* URL — which is also `process.argv[1]`. Without the environment
// guard, the bundled worker would fire this block and place an order through
// the CLI path, in parallel with the batch entry point, ignoring plan-only
// mode. The explicit flag is what keeps that from happening.
if (process.env.RUN_BROWSER_RUNNER_CLI === 'true' && import.meta.url === `file://${process.argv[1]}`) {
  const cleanupAndExit = async (code: number) => {
    if (activeBrowserContext) {
      await activeBrowserContext.close().catch(() => {});
      activeBrowserContext = null;
    }
    process.exit(code);
  };

  process.on('SIGINT', () => cleanupAndExit(130));
  process.on('SIGTERM', () => cleanupAndExit(143));

  runBrowserTest().catch(async (err) => {
    console.error('Test run error:', err);
    await cleanupAndExit(1);
  });
}
