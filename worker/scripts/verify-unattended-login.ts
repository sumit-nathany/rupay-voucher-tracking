/**
 * Confirm that an unattended portal login works with a third-party solver.
 *
 * This is the whole unattended-login path, and nothing else: no card is
 * added, no benefit is ordered, nothing is spent. It
 *
 *   1. opens the portal the way the worker does,
 *   2. opens the login modal and types the real credentials,
 *   3. clicks the reCAPTCHA checkbox,
 *   4. asks a third-party solver for a token,
 *   5. injects the token exactly the way the worker injects it,
 *   6. clicks "Sign In" and waits for the portal's session cookie.
 *
 * A `jwt` cookie at the end means the login was unattended and complete.
 *
 *   npx tsx --env-file ../web/.env.local scripts/verify-unattended-login.ts
 *   npx tsx --env-file ../web/.env.local scripts/verify-unattended-login.ts --headless
 *   npx tsx --env-file ../web/.env.local scripts/verify-unattended-login.ts --label someone@example.com
 */
import { chromium } from 'playwright';
import postgres from 'postgres';
import { decryptPortalCredentials } from '../../web/src/lib/portal-credentials';
import {
  captureRecaptchaCallback,
  injectRecaptchaToken,
  solveWithAzCaptcha,
  solveWithCapSolver,
} from '../src/captcha-solver';
import { humanClick, humanHesitate, humanType } from '../src/human-interaction';
import { installPageGlobals } from '../src/page-globals';

const PORTAL = 'https://rupayselect.truztee.com/#/offers';

const labelArg = process.argv.find((a) => a.startsWith('--label='))?.split('=')[1]?.trim();
const headless = process.argv.includes('--headless');

function pickProvider(): { name: string; key: string } | null {
  // AZCaptcha is the routed provider. CapSolver is here so the same
  // script can be used as a control run when only that key is present.
  const az = process.env.AZCAPTCHA_API_KEY;
  if (az) return { name: 'azcaptcha', key: az };
  const cap = process.env.CAPSOLVER_API_KEY;
  if (cap) return { name: 'capsolver', key: cap };
  return null;
}

async function main() {
  const dbUrl = process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL or WORKER_DATABASE_URL is required');

  const provider = pickProvider();
  if (!provider) {
    throw new Error(
      'No solver key. Set AZCAPTCHA_API_KEY (the routed provider) in web/.env.local.',
    );
  }
  console.log(`[verify] solver provider: ${provider.name}`);

  const sql = postgres(dbUrl, { max: 1 });
  const rows = await sql`
    select id, label, credentials_encrypted
    from app.portal_accounts
    where status = 'connected'
    order by created_at
  `;
  await sql.end();

  const account = labelArg
    ? rows.find((r: any) => r.label === labelArg)
    : rows[0];
  if (!account) {
    throw new Error(
      `No connected portal account${labelArg ? ` labelled ${labelArg}` : ''}. ` +
        `Available: ${rows.map((r: any) => r.label).join(', ')}`,
    );
  }
  console.log(`[verify] portal account: ${account.label}`);

  const creds = decryptPortalCredentials(account.credentials_encrypted, account.id);

  // A fresh profile every run: a persistent profile keeps the portal's
  // session cookie, and a run that starts already logged in has no login
  // form to test.
  const profileDir = `/tmp/verify-login-${account.id}-${Date.now()}`;
  const context = await chromium.launchPersistentContext(profileDir, {
      channel: 'chrome',
      headless,
      slowMo: 15,
      viewport: { width: 1366, height: 860 },
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-infobars',
      ],
    },
  );
  await installPageGlobals(context);
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  const posts: string[] = [];
  const allRequests: string[] = [];
  page.on('request', (r) => {
    allRequests.push(`${r.method()} ${r.url()}`);
    if (r.method() === 'POST' && r.url().includes('truztee')) posts.push(r.url());
  });

  // 1. The portal, then the login modal.
  await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  console.log('[verify] portal loaded');

  const loginButton = page.locator('button:has-text("Login"), a:has-text("Login")').first();
  await loginButton.waitFor({ state: 'visible', timeout: 20000 });
  await humanClick(loginButton, { hesitateBeforeMs: 400, pauseAfterMs: 800 });
  console.log('[verify] login modal opened');

  // 2. The real credentials, typed the way the worker types them.
  const emailInput = page.locator('input[type="email"]:visible').first();
  const passwordInput = page.locator('input[type="password"]:visible').first();
  await emailInput.waitFor({ state: 'visible', timeout: 10000 });
  await humanType(emailInput, creds.loginId, { minCharDelayMs: 60, maxCharDelayMs: 110 });
  await humanHesitate(400, 800);
  await humanType(passwordInput, creds.password, { minCharDelayMs: 60, maxCharDelayMs: 110 });
  console.log('[verify] credentials typed');

  // 3. The captcha. Take the site's callback before the challenge replaces it.
  const captured = await captureRecaptchaCallback(page);
  console.log(`[verify] captured the site's reCAPTCHA callback: ${captured ? 'yes' : 'no'}`);

  const anchor = page.frames().find((f) => f.url().includes('/recaptcha/api2/anchor'));
  if (!anchor) throw new Error('no reCAPTCHA anchor frame on the page');
  await anchor
    .locator('#recaptcha-anchor, .recaptcha-checkbox')
    .first()
    .click({ timeout: 10000 });
  console.log('[verify] checkbox clicked');

  await page.waitForTimeout(2500);

  // A checkbox pass needs no solver at all.
  const passedImmediately = await page.evaluate(() => {
    const ta = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
    return Boolean(ta && ta.value.length > 0);
  });
  console.log(`[verify] passed on the checkbox alone: ${passedImmediately}`);

  // 4. The sitekey, taken the way the worker takes it.
  const siteKey = await page.evaluate(() => {
    const el = document.querySelector('[data-sitekey]') as HTMLElement | null;
    if (el) return el.getAttribute('data-sitekey');
    const iframe = document.querySelector(
      'iframe[src*="google.com/recaptcha"]',
    ) as HTMLIFrameElement | null;
    const match = iframe?.src?.match(/[?&]k=([^&]+)/);
    return match ? match[1] : null;
  });
  console.log(`[verify] sitekey: ${siteKey}`);
  if (!siteKey) throw new Error('could not read the sitekey from the page');

  // 5. The token, from the routed provider.
  const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => undefined);
  const t0 = Date.now();
  const token =
    provider.name === 'azcaptcha'
      ? await solveWithAzCaptcha(provider.key, siteKey, page.url(), userAgent)
      : await solveWithCapSolver(provider.key, siteKey, page.url());
  if (!token) throw new Error(`${provider.name} did not return a token`);
  console.log(
    `[verify] token from ${provider.name} in ${((Date.now() - t0) / 1000).toFixed(0)}s (${token.length} chars)`,
  );

  // 6. Inject it the way the worker injects it.
  const injected = await injectRecaptchaToken(page, token);
  console.log(`[verify] token injected: ${injected}`);

  await page.waitForTimeout(1500);

  // 7. Sign In.
  const candidates = page.locator('button.btn-login-submit, button:has-text("Sign In")');
  const count = await candidates.count();
  console.log(`[verify] submit candidates: ${count}`);
  for (let i = 0; i < count; i++) {
    const b = candidates.nth(i);
    console.log(
      `[verify]   #${i} ${JSON.stringify({
        visible: await b.isVisible().catch(() => false),
        enabled: await b.isEnabled().catch(() => false),
        text: (await b.textContent().catch(() => '') ?? '').trim().slice(0, 30),
        cls: (await b.getAttribute('class').catch(() => '') ?? '').slice(0, 60),
      })}`,
    );
  }

  const submitButton = page
    .locator('button.btn-login-submit:visible, button:has-text("Sign In"):visible')
    .first();
  const enabled = await submitButton.isEnabled().catch(() => false);
  console.log(`[verify] submit button enabled: ${enabled}`);
  posts.length = 0;
  allRequests.length = 0;
  await submitButton.click({ timeout: 10000 }).catch((e) => {
    console.log(`[verify] click fell back: ${String(e).split('\n')[0]}`);
    return submitButton.evaluate((el) => (el as HTMLElement).click());
  });
  await page.waitForTimeout(8000);

  console.log('[verify] requests after the click:');
  for (const r of allRequests) console.log(`[verify]   ${r.replace(/^https?:\/\//, '').slice(0, 110)}`);
  const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
  const complaint = bodyText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /invalid|incorrect|expired|captcha|error|try again/i.test(l))
    .slice(0, 5);
  if (complaint.length) console.log(`[verify] page says: ${JSON.stringify(complaint)}`);

  // 8. The session cookie is the verdict.
  let jwt = undefined as any;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    jwt = (await context.cookies()).find((c) => c.name === 'jwt');
    if (jwt) break;
  }

  const loggedIn = Boolean(jwt);
  console.log(`[verify] portal POSTs after Sign In: ${posts.length}`);
  console.log(`[verify] jwt cookie: ${loggedIn ? 'issued — unattended login succeeded' : 'NOT issued'}`);
  console.log(`[verify] url now: ${page.url()}`);

  await context.close();
  if (!loggedIn) process.exit(1);
}

main().catch(async (err) => {
  console.error('[verify] FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
