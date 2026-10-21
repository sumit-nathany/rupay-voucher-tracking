/**
 * Where does the token have to go for the site's form to accept it?
 *
 * The site renders the widget with `grecaptcha.render()`, and its callback
 * lives at `___grecaptcha_cfg.clients[id].A.callback`. Calling it is not
 * enough, because the site's handler most likely reads the token back with
 * `grecaptcha.getResponse(id)` — and that reads reCAPTCHA's *own* state, not
 * whatever we put in a textarea.
 *
 * This uses a dummy token, so it runs in seconds with no solve.
 */
import { chromium } from 'playwright';

const DUMMY = '03AD_TEST_TOKEN_ABCDEF';
const PORTAL = 'https://rupayselect.truztee.com/#/offers';

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'en-US' });
const page = await ctx.newPage();

await page.goto(PORTAL, { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForTimeout(3500);
const loginButton = page.locator('button:has-text("Login")').first();
if (await loginButton.isVisible().catch(() => false)) {
  await loginButton.click();
  await page.waitForTimeout(3000);
}

const anchor = page.frames().find((f) => f.url().includes('/recaptcha/api2/anchor'));
console.log('anchor frame:', Boolean(anchor));
await anchor?.locator('#recaptcha-anchor, .recaptcha-checkbox').first().click({ timeout: 10000 });
await page.waitForTimeout(2500);

const top = await page.evaluate(() => {
  const ta = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
  const g = (window as any).grecaptcha;
  let getResponse: any = null;
  try { getResponse = g ? g.getResponse(0) : 'no grecaptcha'; } catch (e) { getResponse = `threw ${e}`; }
  return {
    topTextareaPresent: Boolean(ta),
    topTextareaLen: ta?.value.length ?? 0,
    topTextareaOuter: ta?.outerHTML.slice(0, 200) ?? null,
    getResponse: String(getResponse).slice(0, 80),
    hasGrecaptcha: Boolean(g),
    grecaptchaKeys: g ? Object.keys(g) : [],
  };
});
console.log('top page:', JSON.stringify(top, null, 1));

if (anchor) {
  const inner = await anchor.evaluate(() => {
    const ta = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
    return { present: Boolean(ta), len: ta?.value.length ?? 0, outer: ta?.outerHTML.slice(0, 200) ?? null };
  });
  console.log('anchor frame textarea:', JSON.stringify(inner, null, 1));

  // Put the dummy token in the anchor iframe's textarea, then ask reCAPTCHA.
  const after = await anchor.evaluate((tok) => {
    const ta = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
    if (ta) { ta.value = tok; ta.dispatchEvent(new Event('change', { bubbles: true })); }
    const g = (window as any).grecaptcha;
    let gr: any = null;
    try { gr = g ? g.getResponse(0) : 'no grecaptcha'; } catch (e) { gr = `threw ${e}`; }
    return { set: Boolean(ta), getResponse: String(gr).slice(0, 80) };
  }, DUMMY);
  console.log('after setting the anchor textarea:', JSON.stringify(after));
}

// Now try the whole thing from the top page: set the parent textarea, call
// the site's callback, then ask reCAPTCHA for the response.
const round = await page.evaluate((tok) => {
  const out: any = {};
  const g = (window as any).grecaptcha;
  const cfg = (window as any).___grecaptcha_cfg;
  const ta = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
  if (ta) { ta.value = tok; ta.dispatchEvent(new Event('change', { bubbles: true })); }
  out.topSet = Boolean(ta);
  try { out.getResponseBeforeCallback = String(g.getResponse(0)).slice(0, 60); } catch (e) { out.getResponseBeforeCallback = String(e).slice(0, 60); }

  // Call the site's callback the way the worker does.
  const client = cfg?.clients?.[0];
  const cb = client?.A?.callback;
  out.hasCallback = typeof cb === 'function';
  if (typeof cb === 'function') {
    try { cb(tok); out.called = true; } catch (e) { out.callbackThrew = String(e).slice(0, 120); }
  }
  try { out.getResponseAfterCallback = String(g.getResponse(0)).slice(0, 60); } catch (e) { out.getResponseAfterCallback = String(e).slice(0, 60); }
  out.clientKeys = client ? Object.keys(client) : [];
  // Where might reCAPTCHA keep the response? Look for string fields.
  const hunt = (node: any, path: string, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 3) return;
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string' && v.length > 20) out[`str:${path}.${k}`] = v.slice(0, 40);
      else if (v && typeof v === 'object') hunt(v, `${path}.${k}`, depth + 1);
    }
  };
  hunt(client, 'client', 0);
  return out;
}, DUMMY);
console.log('round trip:', JSON.stringify(round, null, 1));

await browser.close();
