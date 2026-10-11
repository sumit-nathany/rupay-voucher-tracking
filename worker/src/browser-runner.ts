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
import { isPortalCooldownMessage, parsePortalCooldownDate } from '../../web/src/lib/portal-cooldown';
import { getAccountProfilePath } from './browser-profile';
import { fillCardDetailsOnGateway, clickPayButton, promptForOtpAndSubmit } from './payment-gateway-automation';
import { getWhatsAppClient } from '../../web/src/lib/whatsapp-client';
import { getTelegramClient } from '../../web/src/lib/telegram-client';

export interface BrowserRunnerOptions {
  portalAccountId?: string;
  headless?: boolean;
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

  let account = accounts[0];
  if (accountArg) {
    const match = accounts.find((a) => a.id === accountArg || a.label.toLowerCase() === accountArg.toLowerCase());
    if (!match) {
      throw new Error(`Account "${accountArg}" not found among connected accounts: ${accounts.map((a) => a.label).join(', ')}`);
    }
    account = match;
  }

  const creds = decryptPortalCredentials(account.credentialsEncrypted, account.id);
  console.log(`Found account "${account.label}". Decrypted credentials ready.`);

  const today = new Date().toISOString().slice(0, 10);
  const candidate = await findCandidatesForAccount(db, account.id, today);

  if (!candidate) {
    console.log('No candidate nominated.');
    if (account.cooldownUntil && new Date(account.cooldownUntil) > new Date()) {
      console.log(`Account is in active 24h cooldown until: ${new Date(account.cooldownUntil).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST)`);
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

  const [mapping] = await db
    .select()
    .from(schema.portalCardMappings)
    .where(eq(schema.portalCardMappings.cardId, candidate.cardId));

  const paymentDetails = mapping?.paymentDetailsEncrypted ? decryptPaymentDetails(mapping.paymentDetailsEncrypted, mapping.id) : null;
  console.log(`Payment Details Mode: ${paymentDetails ? paymentDetails.mode : 'None'}`);

  console.log('\n--- Step 2: Launching Browser with Isolated Account Profile ---');
  const userDataDir = getAccountProfilePath(account.id);
  console.log(`Profile Directory: ${userDataDir} (Account: ${account.label})`);
  const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: options?.headless ?? false,
    slowMo: 60,
    viewport: { width: 1366, height: 860 },
  });

  // Track any new tabs / popups that might open (e.g. payment gateway tab)
  let paymentPage: Page | null = null;
  context.on('page', (newPage) => {
    console.log(`[Popup/New Tab detected]: ${newPage.url()}`);
    paymentPage = newPage;
  });

  const page: Page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  // Listen for portal transaction responses
  let cooldownDetectedUntil: Date | null = null;
  page.on('response', async (res) => {
    if (res.url().includes('addUserTransaction')) {
      try {
        const text = await res.text();
        const json = JSON.parse(text);
        const inner = typeof json.payload === 'string' ? JSON.parse(json.payload) : json.payload;
        if (inner.code === 1 && inner.message && isPortalCooldownMessage(inner.message)) {
          console.log('\n⚠️ Portal 24-Hour Limit Detected:', inner.message);
          const parsedDate = parsePortalCooldownDate(inner.message);
          cooldownDetectedUntil = parsedDate ?? new Date(Date.now() + 24 * 60 * 60 * 1000);
          console.log(`Locked until (IST): ${cooldownDetectedUntil.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

          // Record cooldown in database
          await recordPortalAccountCooldown(db, account.id, cooldownDetectedUntil, 'daily_limit_reached');
          console.log('✓ Recorded cooldown in database! No future run will be attempted before this time.');
        }
      } catch (e) {
        console.error('Error parsing addUserTransaction response:', e);
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
      await loginButton.click();
      await page.waitForTimeout(500);
    }

    const emailInput = page.locator('input[type="email"]:visible').first();
    const passwordInput = page.locator('input[type="password"]:visible').first();
    await emailInput.fill(creds.loginId);
    await passwordInput.fill(creds.password);

    console.log('Waiting for reCAPTCHA solution / login...');
    for (let sec = 0; sec < 120; sec++) {
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
            await submitButton.click({ timeout: 3000 });
          }
        } catch {}
        break;
      }
    }
    if (jwtCookie) {
      console.log(`✓ Login complete! Session token saved in profile for ${account.label}.`);
    }
  } else {
    console.log(`✓ Active session exists in profile for "${account.label}". Login & CAPTCHA bypassed!`);
  }

  await page.waitForTimeout(1500);

  console.log('\n--- Step 3: Selecting PNB Card ---');
  const activeCardText = await page.locator('button.nav-dropdown-trigger').first().textContent().catch(() => '');
  if (!activeCardText?.includes('PNB')) {
    console.log('Selecting PNB card in dropdown...');
    await page.locator('button.nav-dropdown-trigger').first().click();
    await page.waitForTimeout(400);
    await page.locator('a.dropdown-item:has-text("PNB Salary Imperial")').first().click();
    await page.waitForTimeout(1500);
  } else {
    console.log('✓ PNB Salary Imperial card already selected.');
  }

  const targetCategory = benefitDetails.benefitType || 'Gym Access';
  console.log(`\n--- Step 4: Navigating to ${targetCategory} ---`);
  await page.locator('button.nav-dropdown-trigger:has-text("Explore Benefits")').click();
  await page.waitForTimeout(400);

  const categoryItem = page.locator(`a.dropdown-item:has-text("${targetCategory}")`).first();
  if (await categoryItem.isVisible({ timeout: 2000 })) {
    await categoryItem.click();
  } else {
    console.log(`Dropdown item for "${targetCategory}" not found directly. Checking first available item...`);
    const fallbackItem = page.locator(`a.dropdown-item`).first();
    await fallbackItem.click();
  }
  await page.waitForTimeout(2000);

  console.log(`\n--- Step 5: Clicking Redeem on Category Page (${benefitDetails.exactBenefit}) ---`);
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
  await redeemBtn.click();
  await page.waitForTimeout(1500);

  console.log('\n--- Step 6: Clicking Redeem Now on Benefit Page ---');
  const redeemNowBtn = page.locator('button:has-text("Redeem Now")').first();
  await redeemNowBtn.waitFor({ state: 'visible', timeout: 8000 });
  await redeemNowBtn.click();
  await page.waitForTimeout(1000);

  console.log('\n--- Step 7: Payment Confirmation Modal ---');
  const continueToPaymentBtn = page.locator('.payment-modal .payment-continue-btn, button:has-text("Continue to Payment"):visible').first();
  await continueToPaymentBtn.waitFor({ state: 'visible', timeout: 5000 });
  console.log('Clicking "Continue to Payment"...');
  await continueToPaymentBtn.click();

  console.log('Waiting for response / gateway redirect...');
  await page.waitForTimeout(5000);

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

  // Determine active payment page (either new tab or current page redirect)
  const activePaymentPage: Page = paymentPage ?? page;
  console.log(`Payment Page URL: ${activePaymentPage.url()}`);
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
  if (paymentDetails && paymentDetails.mode === 'full') {
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

  // Step 9: 3D-Secure Bank OTP Prompt
  console.log('\n--- Step 9: 3D-Secure Verification / OTP ---');
  await activePaymentPage.waitForTimeout(3000); // Allow bank ACS / 3DS page to settle

  // Resolve notification recipient: Telegram preferred, fallback to WhatsApp phone
  const [settings] = await db
    .select()
    .from(schema.automationSettings)
    .where(eq(schema.automationSettings.workspaceId, account.workspaceId));

  const telegramChatId = settings?.telegramChatId || null;
  const targetPhoneNumber = settings?.whatsappPhoneNumber || account.phoneNumber;
  if (telegramChatId) {
    console.log(`[gateway] OTP recipient: Telegram Chat ${telegramChatId}`);
  } else if (targetPhoneNumber) {
    console.log(`[gateway] OTP recipient: ${targetPhoneNumber} (${settings?.whatsappPhoneNumber ? 'workspace owner' : 'account default'})`);
  }

  const otpCompleted = await promptForOtpAndSubmit(
    activePaymentPage,
    {
      db,
      portalAccountId: account.id,
      attemptId: candidate.instanceId,
      telegramChatId,
      phoneNumber: targetPhoneNumber,
      cardName: cardRow?.cardName ?? 'RuPay Card',
      benefitName: benefitDetails.exactBenefit,
    },
    180000,
  );

  if (otpCompleted) {
    console.log('Monitoring transaction completion & booking reference...');
    for (let sec = 0; sec < 30; sec++) {
      await activePaymentPage.waitForTimeout(1000);
      const currUrl = activePaymentPage.url();
      if (currUrl.includes('success') || currUrl.includes('confirm') || currUrl.includes('booking') || currUrl.includes('truztee.com')) {
        const pageText = await activePaymentPage.evaluate(() => document.body.innerText).catch(() => '');
        const bookingMatch = pageText.match(/(?:booking|reference|order|transaction)\s*(?:id|no|#)?\s*[:\-]?\s*([A-Za-z0-9\-_]{6,30})/i);
        if (bookingMatch) {
          console.log(`\n🎉 Booking Reference Confirmed: ${bookingMatch[1]}`);
          if (telegramChatId) {
            const tg = getTelegramClient();
            await tg.sendBookingConfirmation({
              chatId: telegramChatId,
              cardName: cardRow?.cardName ?? 'RuPay Card',
              benefitName: benefitDetails.exactBenefit,
              bookingRef: bookingMatch[1],
            });
            console.log(`[gateway] Sent booking confirmation via Telegram to ${telegramChatId}.`);
          } else if (targetPhoneNumber) {
            const whatsapp = getWhatsAppClient();
            await whatsapp.sendBookingConfirmation({
              to: targetPhoneNumber,
              cardName: cardRow?.cardName ?? 'RuPay Card',
              benefitName: benefitDetails.exactBenefit,
              bookingRef: bookingMatch[1],
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
