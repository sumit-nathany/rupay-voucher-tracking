import path from 'path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { chromium, type BrowserContext, type Page } from 'playwright';
import * as schema from '../../web/src/db/schema';
import type { Database } from '../../web/src/lib/context';
import { decryptPortalCredentials } from '../../web/src/lib/portal-credentials';
import { decryptPaymentDetails } from '../../web/src/lib/card-payment-details';
import { findCandidatesForAccount, recordPortalAccountCooldown } from '../../web/src/domain/automation';
import { isPortalCooldownMessage, parsePortalCooldownDate, parsePortalCooldown } from '../../web/src/lib/portal-cooldown';
import { getAccountProfilePath } from './browser-profile';
import { fillCardDetailsOnGateway, clickPayButton, promptForOtpAndSubmit } from './payment-gateway-automation';
import { handlePostPaymentTransition } from './llm-gateway-agent';
import { getWhatsAppClient } from '../../web/src/lib/whatsapp-client';
import { getTelegramClient } from '../../web/src/lib/telegram-client';
import { humanClick, humanType, humanDelay, humanHesitate, installVisualMouseCursor } from './human-interaction';
import { finalizeConfirmedOrder } from '../../web/src/domain/automation-worker';

export interface BrowserRunnerOptions {
  portalAccountId?: string;
  headless?: boolean;
  ignoreCooldown?: boolean;
}

export async function runBrowserTest(options?: BrowserRunnerOptions) {
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

  const today = new Date().toISOString().slice(0, 10);
  const ignoreCooldown =
    options?.ignoreCooldown ??
    (process.argv.includes('--force') || process.argv.includes('--ignore-cooldown'));
  if (ignoreCooldown) {
    console.log('[runner] --force / ignoreCooldown active: bypassing 24h limit checks for testing.');
  }

  let account = accounts[0];
  let candidate: Awaited<ReturnType<typeof findCandidatesForAccount>> = null;

  if (accountArg) {
    const match = accounts.find((a) => a.id === accountArg || a.label.toLowerCase() === accountArg.toLowerCase());
    if (!match) {
      throw new Error(`Account "${accountArg}" not found among connected accounts: ${accounts.map((a) => a.label).join(', ')}`);
    }
    account = match;
    candidate = await findCandidatesForAccount(db, account.id, today, { ignoreCooldown });
  } else {
    for (const acc of accounts) {
      const c = await findCandidatesForAccount(db, acc.id, today, { ignoreCooldown });
      if (c) {
        account = acc;
        candidate = c;
        break;
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
    return;
  }

  const [cardRow] = await db
    .select({
      last4: schema.cards.lastDigits,
      cardName: schema.bankCardTypes.displayName,
    })
    .from(schema.cards)
    .innerJoin(schema.bankCardTypes, eq(schema.cards.bankCardTypeId, schema.bankCardTypes.id))
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

  console.log(`Card: ${cardRow?.cardName} (••${cardRow?.last4})`);
  console.log(`Benefit: ${benefitDetails.benefitType} - ${benefitDetails.exactBenefit} (₹${benefitDetails.cashValue})`);

  const [cardRecord] = await db
    .select({
      paymentDetailsEncrypted: schema.cards.paymentDetailsEncrypted,
      lastDigits: schema.cards.lastDigits,
    })
    .from(schema.cards)
    .where(eq(schema.cards.id, candidate.cardId));

  let paymentDetails = null;
  if (cardRecord?.paymentDetailsEncrypted) {
    try {
      paymentDetails = decryptPaymentDetails(cardRecord.paymentDetailsEncrypted, candidate.cardId);
    } catch (err) {
      console.warn('Could not decrypt payment details from cards table:', err);
    }
  }

  if (!paymentDetails) {
    const [mapping] = await db
      .select()
      .from(schema.portalCardMappings)
      .where(eq(schema.portalCardMappings.cardId, candidate.cardId));

    if (mapping?.paymentDetailsEncrypted) {
      try {
        paymentDetails = decryptPaymentDetails(mapping.paymentDetailsEncrypted, mapping.id);
      } catch (err) {
        console.warn('Could not decrypt payment details from mapping table:', err);
      }
    }
  }

  console.log(`Payment Details Mode: ${paymentDetails ? paymentDetails.mode : 'None'}`);

  console.log('\n--- Step 2: Launching Browser with Isolated Account Profile ---');
  const userDataDir = getAccountProfilePath(account.id);
  console.log(`Profile Directory: ${userDataDir} (Account: ${account.label})`);
  const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: options?.headless ?? false,
    slowMo: 60,
    viewport: { width: 1366, height: 860 },
  });

  const page: Page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  await installVisualMouseCursor(page);

  // Track any new tabs / popups that might open (e.g. payment gateway tab)
  const popupTracker = { page: null as Page | null };
  context.on('page', async (newPage) => {
    console.log(`[Popup/New Tab detected]: ${newPage.url()}`);
    popupTracker.page = newPage;
    await installVisualMouseCursor(newPage);
  });

  // Log console and requests to see errors and APIs
  page.on('console', (msg) => console.log(`[console ${msg.type()}]`, msg.text()));
  page.on('request', (req) => {
    if (req.url().includes('truztee') || req.url().includes('juspay')) {
      console.log(`[request] ${req.method()} ${req.url()}`);
    }
  });

  // Listen for portal transaction responses
  let cooldownDetectedUntil: Date | null = null;
  page.on('response', async (res) => {
    const url = res.url();
    if (url.includes('addUserTransaction') || url.includes('createOrder') || url.includes('payment') || url.includes('juspay')) {
      try {
        const text = await res.text();
        console.log(`[response ${res.status()}] ${url.slice(0, 100)}: ${text.slice(0, 300)}`);
        const json = JSON.parse(text);
        const inner = typeof json.payload === 'string' ? JSON.parse(json.payload) : json.payload;
        const msg = inner?.message || json?.message;
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

  // Check if session is already active
  const cookies = await context.cookies();
  let jwtCookie = cookies.find((c) => c.name === 'jwt');

  if (!jwtCookie) {
    console.log('Not signed in yet. Starting login sequence...');
    const loginButton = page.locator('button:has-text("Login")').first();
    if (await loginButton.isVisible()) {
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
    console.log('👉 Please complete the CAPTCHA in the open browser.');
    console.log('   The automation is standing by and will automatically proceed once completed.');
    console.log('======================================================\n');

    for (let sec = 0; sec < 180; sec++) {
      await page.waitForTimeout(1000);
      const updatedCookies = await context.cookies();
      jwtCookie = updatedCookies.find((c) => c.name === 'jwt');
      if (jwtCookie) break;

      const captchaSolved = await page.evaluate(() => {
        const textarea = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
        return Boolean(textarea && textarea.value.length > 0);
      });

      if (captchaSolved) {
        try {
          const submitButton = page.locator('button.btn-login-submit, button:has-text("Sign In"):visible').first();
          if (await submitButton.isVisible()) {
            console.log('[captcha] CAPTCHA completed! Clicking Sign In...');
            await humanClick(submitButton, { hesitateBeforeMs: 300, pauseAfterMs: 1500 });
            await page.waitForTimeout(2000);
          }
        } catch {}
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
  } else {
    console.log(`✓ Active session exists in profile for "${account.label}". Login & CAPTCHA bypassed!`);
  }

  await humanHesitate(1200, 2000);

  console.log('\n--- Step 3: Selecting PNB Card ---');
  const activeCardText = await page.locator('button.nav-dropdown-trigger').first().textContent().catch(() => '');
  if (!activeCardText?.includes('PNB')) {
    console.log('Selecting PNB card in dropdown...');
    await humanClick(page.locator('button.nav-dropdown-trigger').first(), { hesitateBeforeMs: 500, pauseAfterMs: 800 });
    const cardItem = page.locator('a.dropdown-item:has-text("PNB Salary Imperial")').first();
    await humanClick(cardItem, { hesitateBeforeMs: 400, pauseAfterMs: 1500 });
  } else {
    console.log('✓ PNB Salary Imperial card already selected.');
  }

  const targetCategory = benefitDetails.benefitType || 'Gym Access';
  console.log(`\n--- Step 4: Navigating to ${targetCategory} ---`);
  await humanHesitate(1000, 1800);
  await humanClick(page.locator('button.nav-dropdown-trigger:has-text("Explore Benefits")'), { hesitateBeforeMs: 500, pauseAfterMs: 700 });

  const dropdownTexts = await page.locator('a.dropdown-item').allTextContents().catch(() => []);
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
    const fallbackItem = page.locator(`a.dropdown-item`).first();
    await humanClick(fallbackItem, { hesitateBeforeMs: 400, pauseAfterMs: 1500 });
  }

  console.log(`\n--- Step 5: Clicking Redeem on Category Page (${benefitDetails.exactBenefit}) ---`);
  await humanHesitate(1500, 2500);
  let redeemBtn = page.locator('button.od-redeem-btn, button:has-text("Redeem")').first();
  if (benefitDetails.benefitProvider) {
    const providerCardBtn = page
      .locator(`.offer-card:has-text("${benefitDetails.benefitProvider}"), .card:has-text("${benefitDetails.benefitProvider}")`)
      .locator('button:has-text("Redeem")')
      .first();
    if (await providerCardBtn.isVisible({ timeout: 2000 })) {
      redeemBtn = providerCardBtn;
    }
  }
  await redeemBtn.waitFor({ state: 'visible', timeout: 10000 });
  await humanClick(redeemBtn, { hesitateBeforeMs: 600, pauseAfterMs: 1500 });

  console.log('\n--- Step 6: Clicking Redeem Now on Benefit Page ---');
  await humanHesitate(1800, 2800);
  const redeemNowBtn = page.locator('button:has-text("Redeem Now")').first();
  await redeemNowBtn.waitFor({ state: 'visible', timeout: 8000 });
  await humanClick(redeemNowBtn, { hesitateBeforeMs: 700, pauseAfterMs: 1500 });

  console.log('\n--- Step 7: Payment Confirmation Modal ---');
  await humanHesitate(2000, 3200); // Allow modal animation to complete and simulate human reading

  // Inspect modal elements
  const modalInfo = await page.evaluate(() => {
    const dialogs = Array.from(document.querySelectorAll('.modal, [role="dialog"], .fade.show, .modal-dialog'));
    const buttons = dialogs.flatMap((d) =>
      Array.from(d.querySelectorAll('button, a, [role="button"]')).map((el) => ({
        tag: el.tagName,
        text: el.textContent?.trim(),
        className: el.className,
        disabled: (el as HTMLButtonElement).disabled,
        visible: (el as HTMLElement).offsetParent !== null,
      }))
    );
    return { count: dialogs.length, buttons };
  });
  console.log('[modal]', JSON.stringify(modalInfo));

  const continueToPaymentBtn = page
    .locator(':is(button, a, [role="button"]):has-text("Continue to Payment"):visible')
    .first();
  await continueToPaymentBtn.waitFor({ state: 'visible', timeout: 8000 });
  console.log('Gliding cursor and clicking "Continue to Payment" naturally...');
  await humanClick(continueToPaymentBtn, { hesitateBeforeMs: 800, pauseAfterMs: 1200 });
  // Also dispatch DOM click in case synthetic Playwright click didn't trigger attached Vue/jQuery handler
  await continueToPaymentBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {});

  console.log('Waiting for response / gateway redirect...');
  for (let sec = 0; sec < 30; sec++) {
    if (popupTracker.page) {
      console.log(`[gateway] Detected payment popup page: ${popupTracker.page.url()}`);
      break;
    }
    if (!page.url().includes('rupayselect.truztee.com')) {
      console.log(`[gateway] Main page redirected to gateway: ${page.url()}`);
      break;
    }
    if (cooldownDetectedUntil) {
      break;
    }
    // Re-click if still on truztee after 4 seconds
    if (sec === 4 && page.url().includes('rupayselect.truztee.com')) {
      try {
        const btn = page.locator(':is(button, a, [role="button"]):has-text("Continue to Payment"):visible').first();
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
    return;
  }

  const activePaymentPage: Page = popupTracker.page ?? page;
  if (activePaymentPage.url().includes('rupayselect.truztee.com')) {
    console.error('[gateway] Fatal: Gateway did not redirect/open within 30s. Saving screenshot...');
    await activePaymentPage.screenshot({ path: 'gateway-redirect-failed.png' });
    await context.close();
    await client.end();
    return;
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
    const filled = await fillCardDetailsOnGateway(activePaymentPage, paymentDetails);
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
  const transitionResult = await handlePostPaymentTransition(activePaymentPage, { maxWaitSec: 40 });
  const cardLast4 = cardRecord?.lastDigits ?? '1746';

  let otpCompleted = false;

  // Resolve notification recipient: Telegram preferred, fallback to WhatsApp phone
  const [settings] = await db
    .select()
    .from(schema.automationSettings)
    .where(eq(schema.automationSettings.workspaceId, account.workspaceId));

  const telegramChatId = settings?.telegramChatId || null;
  const targetPhoneNumber = settings?.whatsappPhoneNumber || account.phoneNumber;

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
    })
    .returning();

  if (transitionResult.reachedSuccess) {
    console.log('✓ Order confirmation screen reached directly!');
    otpCompleted = true;
  } else {
    // Step 9: 3D-Secure Bank OTP Prompt
    console.log('\n--- Step 9: 3D-Secure Verification / OTP ---');

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
      },
      180000,
    );
  }

  if (otpCompleted) {
    console.log('Monitoring transaction completion & booking reference...');
    for (let sec = 0; sec < 30; sec++) {
      await activePaymentPage.waitForTimeout(1000);
      const currUrl = activePaymentPage.url();
      if (currUrl.includes('success') || currUrl.includes('confirm') || currUrl.includes('booking') || currUrl.includes('truztee.com')) {
        const pageText = await activePaymentPage.evaluate(() => document.body.innerText).catch(() => '');
        
        // Exclude common non-ID generic English words
        const invalidWords = new Set([
          'process', 'processing', 'pending', 'initiated', 'failed', 'failure',
          'cancelled', 'loading', 'success', 'successful', 'transaction', 'completed',
          'reference', 'confirmed', 'details', 'status', 'summary', 'payment', 'please'
        ]);

        const matches = Array.from(pageText.matchAll(/(?:booking|reference|order|transaction)\s*(?:id|no|#)?\s*[:\-]?\s*([A-Za-z0-9\-_]{6,30})/gi));
        let bookingRef: string | null = null;
        for (const m of matches) {
          const cand = m[1].trim();
          if (!invalidWords.has(cand.toLowerCase()) && (/[0-9]/.test(cand) || cand.toUpperCase().startsWith('RUP'))) {
            bookingRef = cand;
            break;
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
          break;
        }
      }
    }
  }

  await activePaymentPage.waitForTimeout(10000);
  await context.close();
  await client.end();
  console.log('Done.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBrowserTest().catch((err) => {
    console.error('Test run error:', err);
    process.exit(1);
  });
}
