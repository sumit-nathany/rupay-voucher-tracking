import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, or } from 'drizzle-orm';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext, Page } from 'playwright';

chromium.use(StealthPlugin());
import * as schema from '../../web/src/db/schema';
import type { Database } from '../../web/src/lib/context';
import { decryptPortalCredentials } from '../../web/src/lib/portal-credentials';
import { getAccountProfilePath } from './browser-profile';

async function runLoginHelper() {
  const dbUrl = process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('Fatal: DATABASE_URL or WORKER_DATABASE_URL is required');
    process.exit(1);
  }

  const client = postgres(dbUrl, { max: 1 });
  const db = drizzle(client, { schema }) as unknown as Database;

  // Check if a specific account was requested via CLI: --account=<id or label>
  const accountArg = process.argv.find((a) => a.startsWith('--account='))?.split('=')[1]?.trim();

  const accounts = await db
    .select()
    .from(schema.portalAccounts)
    .where(eq(schema.portalAccounts.status, 'connected'));

  if (accounts.length === 0) {
    console.log('No connected portal accounts found in database.');
    await client.end();
    return;
  }

  let selectedAccount = accounts[0];
  if (accountArg) {
    const match = accounts.find((a) => a.id === accountArg || a.label.toLowerCase() === accountArg.toLowerCase());
    if (!match) {
      console.error(`Account "${accountArg}" not found among connected accounts:`, accounts.map((a) => a.label));
      await client.end();
      process.exit(1);
    }
    selectedAccount = match;
  }

  console.log(`\n======================================================`);
  console.log(`🔑 RuPay Portal Profile Login Session Initializer`);
  console.log(`Account: ${selectedAccount.label} (${selectedAccount.id})`);
  const profileDir = getAccountProfilePath(selectedAccount.id);
  console.log(`Profile: ${profileDir}`);
  console.log(`======================================================\n`);

  const creds = decryptPortalCredentials(selectedAccount.credentialsEncrypted, selectedAccount.id);

  const launchArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--no-sandbox',
    '--disable-infobars',
  ];

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless: false,
      slowMo: 50,
      viewport: { width: 1280, height: 800 },
      ignoreDefaultArgs: ['--enable-automation'],
      args: launchArgs,
    });
  } catch (err) {
    console.warn('[login-helper] Launching with system Google Chrome failed, falling back to bundled Chromium:', err);
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      slowMo: 50,
      viewport: { width: 1280, height: 800 },
      ignoreDefaultArgs: ['--enable-automation'],
      args: launchArgs,
    });
  }

  const page: Page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  console.log('Navigating to RuPay Select portal...');
  await page.goto('https://rupayselect.truztee.com/#/offers', { waitUntil: 'networkidle' });

  // Check if session is already active
  const cookies = await context.cookies();
  let jwtCookie = cookies.find((c) => c.name === 'jwt');

  if (jwtCookie) {
    console.log(`\n🎉 Active session already exists in this profile for "${selectedAccount.label}"!`);
    console.log(`No re-login required. Scheduled runs will use this session automatically.`);
    await page.waitForTimeout(2000);
    await context.close();
    await client.end();
    return;
  }

  console.log('Starting sign-in...');
  const loginButton = page.locator('button:has-text("Login")').first();
  if (await loginButton.isVisible()) {
    await loginButton.click();
    await page.waitForTimeout(500);
  }

  const emailInput = page.locator('input[type="email"]:visible').first();
  const passwordInput = page.locator('input[type="password"]:visible').first();
  await emailInput.fill(creds.loginId);
  await passwordInput.fill(creds.password);

  console.log('\n👉 Credentials entered automatically.');
  console.log('👉 Please solve the Google reCAPTCHA in the open browser window and click Sign In.');
  console.log('Waiting for login confirmation (up to 120s)...');

  let success = false;
  for (let sec = 0; sec < 120; sec++) {
    await page.waitForTimeout(1000);
    const updatedCookies = await context.cookies();
    jwtCookie = updatedCookies.find((c) => c.name === 'jwt');
    if (jwtCookie) {
      success = true;
      break;
    }

    // Also click Sign In automatically if user solved captcha
    const captchaSolved = await page.evaluate(() => {
      const textarea = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
      return Boolean(textarea && textarea.value.length > 0);
    });

    if (captchaSolved) {
      try {
        const submitButton = page.locator('button.btn-login-submit, button:has-text("Sign In"):visible').first();
        if (await submitButton.isVisible()) {
          await submitButton.click({ timeout: 2000 });
        }
      } catch {}
    }
  }

  if (success) {
    console.log(`\n🎉 Login successful! Session token captured.`);
    console.log(`✓ Profile stored in: ${profileDir}`);
    console.log(`Future scheduled runs will now automatically bypass login & CAPTCHA for ${selectedAccount.label}.`);
    await page.waitForTimeout(2000);
  } else {
    console.log('\n⚠️ Login timed out or was not completed within 120 seconds.');
  }

  await context.close();
  await client.end();
}

runLoginHelper().catch((err) => {
  console.error('Login helper error:', err);
  process.exit(1);
});
