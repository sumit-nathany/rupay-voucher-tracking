/**
 * Reproduce the failing sign-in locally, with the network visible.
 *
 * Opens the portal's login page, clicks the checkbox, gets a token from
 * AZCaptcha, injects it the way the worker does, and then clicks the submit
 * button — reporting what the DOM looks like, whether the site's reCAPTCHA
 * callback fired, and what requests went out.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PORTAL = 'https://rupayselect.truztee.com/#/login';
const SITEKEY = '6Ldhf84rAAAAAFx1OwOS2HfC7cMutRGcBmi0WPCF';

function key(): string {
  const env = readFileSync('/Users/snathany/sumit_workdir/Personal/rupay-voucher-tracking/web/.env.local', 'utf8');
  const m = env.match(/GEMINI_API_KEY\s*=\s*(.+)/);
  return (m?.[1] ?? '').trim();
}

async function azToken(): Promise<string> {
  const clientKey = process.env.AZCAPTCHA_API_KEY;
  if (!clientKey) throw new Error('no AZCAPTCHA_API_KEY');
  const create = await fetch('https://azcaptcha.com/createTask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientKey,
      task: { type: 'NoCaptchaTaskProxyless', websiteURL: 'https://rupayselect.truztee.com/', websiteKey: SITEKEY },
    }),
  }).then((r) => r.json() as any);
  console.log('createTask ->', create.errorId, create.taskId);
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch('https://azcaptcha.com/getTaskResult', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientKey, taskId: create.taskId }),
    }).then((r) => r.json() as any);
    if (res.status === 'ready' && res.solution?.gRecaptchaResponse) return res.solution.gRecaptchaResponse;
    if (res.errorId && res.errorId !== 1) throw new Error(JSON.stringify(res));
  }
  throw new Error('timed out');
}

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });
const page = await ctx.newPage();

const posts: string[] = [];
page.on('request', (r) => {
  if (r.method() === 'POST') posts.push(`${r.method()} ${r.url()}`);
});
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/requestStorageAccess/.test(t)) console.log('  [console error]', t.slice(0, 200));
});

await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(4000);

const anchor = page.frames().find((f) => f.url().includes('/recaptcha/api2/anchor'));
if (!anchor) { console.log('NO ANCHOR'); await browser.close(); process.exit(1); }
await anchor.locator('#recaptcha-anchor, .recaptcha-checkbox').first().click({ timeout: 10000 });
await page.waitForTimeout(2500);

const bframe = page.frames().find((f) => f.url().includes('/recaptcha/api2/bframe'));
console.log('challenge shown:', Boolean(bframe));

console.log('getting a token from AZCaptcha...');
const t0 = Date.now();
const token = await azToken();
console.log(`token in ${((Date.now() - t0) / 1000).toFixed(0)}s, sha=${createHash('sha256').update(token).digest('hex').slice(0, 10)}`);

// Inject exactly the way the worker does, but report what happened.
const injected = await page.evaluate((sol) => {
  const textarea = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
  if (textarea) {
    textarea.value = sol;
    textarea.dispatchEvent(new Event('change', { bubbles: true }));
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  const cfg = (window as any).___grecaptcha_cfg;
  const found: string[] = [];
  const seen = new Set<any>();
  const walk = (node: any, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (typeof val === 'function') {
        found.push(`${depth}:${key}`);
        try { val(sol); } catch (e) { found.push(`threw:${String(e).slice(0, 60)}`); }
      } else if (val && typeof val === 'object') walk(val, depth + 1);
    }
  };
  if (cfg?.clients) walk(cfg.clients, 0);
  return {
    textareaFound: Boolean(textarea),
    textareaLen: textarea?.value.length ?? 0,
    cfgPresent: Boolean(cfg),
    clientKeys: cfg?.clients ? Object.keys(cfg.clients).map((c) => Object.keys(cfg.clients[c])) : [],
    functionsFound: found,
  };
}, token);
console.log('injection:', JSON.stringify(injected, null, 1));

// What does the submit control look like?
const btn = page.locator('button.btn-login-submit, button:has-text("Sign In"):visible').first();
console.log('submit button:', JSON.stringify({
  count: await page.locator('button.btn-login-submit, button:has-text("Sign In"):visible').count(),
  visible: await btn.isVisible().catch((e) => `err ${String(e).slice(0, 60)}`),
  enabled: await btn.isEnabled().catch((e) => `err ${String(e).slice(0, 60)}`),
  tag: await btn.evaluate((el) => el.tagName).catch(() => '?'),
  cls: await btn.evaluate((el) => el.className).catch(() => '?'),
  text: (await btn.textContent().catch(() => ''))?.trim().slice(0, 40),
  outer: (await btn.evaluate((el) => el.outerHTML).catch(() => ''))?.slice(0, 300),
}, null, 1));

posts.length = 0;
await btn.click({ timeout: 10000 }).catch((e) => console.log('  click err:', String(e).slice(0, 120)));
await page.waitForTimeout(6000);
console.log('POSTs after the click:', posts.length ? posts : '(none)');

await browser.close();
