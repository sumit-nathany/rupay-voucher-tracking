/**
 * Local harness for the login flow.
 *
 * Runs the *worker's own* code — `injectRecaptchaToken` from captcha-solver
 * and the humanised interaction helpers — against the real portal, with the
 * network and the DOM visible. That makes a change testable in a minute
 * instead of an eighteen-minute build-and-deploy round trip.
 *
 *   AZCAPTCHA_API_KEY=... npx tsx scripts/local-signin.ts [--headed] [--keep]
 */
import { chromium } from 'playwright';
import { captureRecaptchaCallback, injectRecaptchaToken } from '../src/captcha-solver';
import { humanClick, humanType, humanDelay } from '../src/human-interaction';

const PORTAL = 'https://rupayselect.truztee.com/#/offers';
const SITEKEY = '6Ldhf84rAAAAAFx1OwOS2HfC7cMutRGcBmi0WPCF';
const headed = process.argv.includes('--headed');

async function azToken(): Promise<string> {
  const clientKey = process.env.AZCAPTCHA_API_KEY;
  if (!clientKey) throw new Error('AZCAPTCHA_API_KEY is not set');
  const create = await fetch('https://azcaptcha.com/createTask', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clientKey,
      task: {
        type: 'NoCaptchaTaskProxyless',
        websiteURL: 'https://rupayselect.truztee.com/',
        websiteKey: SITEKEY,
      },
    }),
  }).then((r) => r.json() as any);
  if (create.errorId !== 0) throw new Error(`createTask: ${JSON.stringify(create)}`);
  for (let i = 0; i < 70; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await fetch('https://azcaptcha.com/getTaskResult', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientKey, taskId: create.taskId }),
    }).then((r) => r.json() as any);
    if (res.status === 'ready' && res.solution?.gRecaptchaResponse) {
      console.log(`  token after ${(i + 1) * 3}s`);
      return res.solution.gRecaptchaResponse;
    }
    if (res.errorId && res.errorId !== 1) throw new Error(JSON.stringify(res));
  }
  throw new Error('timed out waiting for the token');
}

const browser = await chromium.launch({
  headless: !headed,
  channel: 'chrome',
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
});
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });
const page = await ctx.newPage();

const requests: string[] = [];
page.on('request', (r) => requests.push(`${r.method()} ${r.url().replace(/^https?:\/\//, '').slice(0, 90)}`));
page.on('response', async (r) => {
  if (r.request().method() === 'POST') {
    console.log(`  <- ${r.status()} ${r.url().replace(/^https?:\/\//, '').slice(0, 90)}`);
  }
});
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/requestStorageAccess|favicon/.test(t)) {
    console.log('  [console error]', t.slice(0, 220));
  }
});

console.log('opening the portal...');
await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(4000);

const loginButton = page.locator('button:has-text("Login")').first();
if (await loginButton.isVisible().catch(() => false)) {
  console.log('clicking Login');
  await loginButton.click();
  await page.waitForTimeout(3500);
}

const anchor = page.frames().find((f) => f.url().includes('/recaptcha/api2/anchor'));
if (!anchor) {
  console.log('NO ANCHOR — the widget did not render');
  console.log('frames:', page.frames().map((f) => f.url().slice(0, 70)));
  console.log('body:', (await page.evaluate(() => document.body?.innerText ?? '')).slice(0, 400));
  await browser.close();
  process.exit(1);
}

const captured = await captureRecaptchaCallback(page);
console.log('captured the site callback before the challenge:', captured);

console.log('clicking the checkbox');
await anchor.locator('#recaptcha-anchor, .recaptcha-checkbox').first().click({ timeout: 10000 });
await page.waitForTimeout(3000);

const bframe = page.frames().find((f) => f.url().includes('/recaptcha/api2/bframe'));
console.log('challenge shown:', Boolean(bframe));

console.log('getting a token from AZCaptcha...');
const token = await azToken();

console.log('injecting with the worker\'s own function');
const injected = await injectRecaptchaToken(page, token);
console.log('  injectRecaptchaToken ->', injected);

const state = await page.evaluate(() => {
  const cfg = (window as any).___grecaptcha_cfg;
  const list: string[] = [];
  const seen = new Set<any>();
  const walk = (node: any, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'function') list.push(`${depth}:${k}`);
      else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  if (cfg?.clients) walk(cfg.clients, 0);
  const ta = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
  return {
    textareaLen: ta?.value.length ?? 0,
    clientIds: cfg?.clients ? Object.keys(cfg.clients) : [],
    clientKeys: cfg?.clients ? Object.keys(cfg.clients).map((c) => Object.keys(cfg.clients[c])) : [],
    functions: list,
  };
});
console.log('  grecaptcha cfg:', JSON.stringify(state, null, 1));

const btn = page.locator('button.btn-login-submit, button:has-text("Sign In"):visible').first();
const info = await btn.evaluate((el) => ({
  tag: el.tagName,
  cls: (el as HTMLElement).className,
  text: (el.textContent ?? '').trim().slice(0, 40),
  disabled: (el as HTMLButtonElement).disabled,
  outer: el.outerHTML.slice(0, 260),
  rect: (() => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
  // what is actually on top of the button's centre?
  topAtCentre: (() => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top ? `${top.tagName}.${(top as HTMLElement).className}`.slice(0, 90) : null;
  })(),
})).catch((e) => ({ err: String(e).slice(0, 120) }));
console.log('  submit button:', JSON.stringify(info, null, 1));

requests.length = 0;
console.log('clicking Sign In');
await btn.click({ timeout: 8000 }).catch(async (e) => {
  console.log('  click err:', String(e).split('\n')[0].slice(0, 120));
  console.log('  -> the element is covered; dispatching the click on it directly');
  await btn.evaluate((el) => (el as HTMLElement).click());
});
await page.waitForTimeout(9000);

console.log('requests after the click:');
for (const r of requests) console.log('   ', r);
const jwt = (await ctx.cookies()).find((c) => c.name === 'jwt');
console.log('jwt cookie:', jwt ? 'PRESENT' : 'absent');

if (!process.argv.includes('--keep')) await browser.close();
