/**
 * Find where the site keeps reCAPTCHA's callback.
 *
 * The widget's iframe sits on top of the submit button, and the site's form
 * validator still rejects the token, so the site's own callback never ran.
 * This dumps the reCAPTCHA config structure and the page's own references to
 * it. It needs no token and no solve, so it runs in a few seconds.
 */
import { chromium } from 'playwright';

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

const dump = await page.evaluate(() => {
  const cfg = (window as any).___grecaptcha_cfg;
  const out: any = { cfgKeys: cfg ? Object.keys(cfg) : null, clients: {} };
  if (cfg?.clients) {
    for (const cid of Object.keys(cfg.clients)) {
      const c = cfg.clients[cid];
      out.clients[cid] = Object.keys(c).map((k) => ({
        key: k,
        type: typeof c[k],
        isFn: typeof c[k] === 'function',
        depth1FnNames: typeof c[k] === 'object' && c[k] ? Object.keys(c[k]).filter((kk) => typeof c[k][kk] === 'function') : undefined,
        depth2FnNames:
          typeof c[k] === 'object' && c[k]
            ? Object.keys(c[k])
                .map((kk) => (typeof c[k][kk] === 'object' && c[k][kk] ? Object.keys(c[k][kk]).filter((k3) => typeof c[k][kk][k3] === 'function') : []))
                .flat()
            : undefined,
      }));
    }
  }
  // The page's own markup: a data-callback attribute names the handler.
  out.dataCallbackEls = Array.from(document.querySelectorAll('[data-callback]')).map((el) => ({
    tag: el.tagName,
    cls: (el as HTMLElement).className,
    dataCallback: el.getAttribute('data-callback'),
    sitekey: el.getAttribute('data-sitekey'),
  }));
  // The widget's container, if the site rendered it with a callback.
  const w = document.querySelector('.g-recaptcha, [data-sitekey]') as HTMLElement | null;
  out.widget = w ? { tag: w.tagName, cls: w.className, html: w.outerHTML.slice(0, 400) } : null;
  return out;
});

console.log(JSON.stringify(dump, null, 1));

// Any inline script that mentions the captcha callback.
const scripts = await page.evaluate(() =>
  Array.from(document.querySelectorAll('script:not([src])'))
    .map((s) => s.textContent ?? '')
    .filter((t) => /recaptcha|grecaptcha/i.test(t))
    .map((t) => t.slice(0, 700)),
);
console.log('\n=== inline scripts mentioning recaptcha ===');
for (const s of scripts) console.log('---\n' + s);

await browser.close();
