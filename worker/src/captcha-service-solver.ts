/**
 * Solve the login CAPTCHA using the shared solving service.
 *
 * This is a *separate flow* from `captcha-solver.ts`, which stays exactly as
 * it is. The worker picks between them with one flag:
 *
 *   CAPTCHA_SERVICE_URL set   ->  this module
 *   CAPTCHA_SERVICE_URL unset ->  the existing local solver
 *
 * How it works: the service opens the portal's login page in its own
 * browser, solves the challenge there, and hands back a token. We put that
 * token into *our* page, so the form submits with it.
 *
 * A token is bound to the sitekey and the page's origin, not to the browser
 * that obtained it, so this works for the portal. (Google's own properties
 * are the exception — they also check the address the token came from.)
 */

import type { Page } from 'playwright';
import { CAPTCHA_SERVICE_URL, solveViaService } from './captcha-service-client';

export interface ServiceSolveOptions {
  /** Text of a button to click on the page before solving, e.g. "Login". */
  loginButton?: string;
}

/** The portal's reCAPTCHA sitekey, read from the page. */
export const PORTAL_SITEKEY = '6Ldhf84rAAAAAFx1OwOS2HfC7cMutRGcBmi0WPCF';

/**
 * Extract the reCAPTCHA sitekey from the page.
 *
 * The widget may render with a `[data-sitekey]` attribute, or it may appear as
 * a `g-recaptcha` element with the key set via the `data-sitekey` attribute,
 * or the widget may be inside an iframe whose `src` contains `?k=<sitekey>`.
 * We try each in turn. If all fail, we fall back to the portal's known sitekey.
 */
async function extractSiteKey(page: Page): Promise<string | null> {
  // Wait for the reCAPTCHA widget to appear on the page.
  try {
    await page.waitForSelector('.g-recaptcha, [data-sitekey], iframe[src*="google.com/recaptcha"]', {
      state: 'attached',
      timeout: 15000,
    });
  } catch {
    // Widget didn't appear within the timeout; fall through to known sitekey.
  }

  return page.evaluate(() => {
    const el = document.querySelector('[data-sitekey]') as HTMLElement | null;
    if (el) return el.getAttribute('data-sitekey');

    const iframe = document.querySelector(
      'iframe[src*="google.com/recaptcha"]',
    ) as HTMLIFrameElement | null;
    const match = iframe?.src?.match(/[?&]k=([^&]+)/);
    if (match) return match[1];

    return null;
  });
}

/**
 * The page the service opens to reach the login form.
 *
 * The portal has no `#/login` route: the login form is a modal that opens on
 * the offers page, and `#/login` renders an empty shell with no inputs and
 * no reCAPTCHA widget. So the service is pointed at `#/offers` and clicks the
 * Login button to open the modal.
 */
export const CAPTCHA_SERVICE_PAGE_URL =
  process.env.CAPTCHA_SERVICE_PAGE_URL || 'https://rupayselect.truztee.com/#/offers';

/**
 * Put a token into the page so the form can submit with it.
 *
 * The invisible variant of the widget keeps a callback in
 * `___grecaptcha_cfg`, and the callback is nested two levels deep
 * (`clients[id][key][key].callback`), so the search goes that deep. The
 * checkbox variant does not need a callback at all — the form reads the
 * textarea.
 */
export async function injectToken(page: Page, token: string): Promise<boolean> {
  return await page.evaluate((sol) => {
    const textarea = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.value = sol;
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const cfg = (window as any).___grecaptcha_cfg;
    if (cfg?.clients) {
      for (const cid of Object.keys(cfg.clients)) {
        const client = cfg.clients[cid];
        if (!client || typeof client !== 'object') continue;
        for (const key of Object.keys(client)) {
          const level1 = client[key];
          if (!level1 || typeof level1 !== 'object') continue;

          // clients[id][key].callback
          if (typeof level1.callback === 'function') {
            level1.callback(sol);
            return true;
          }

          // clients[id][key][key].callback
          for (const key2 of Object.keys(level1)) {
            const level2 = level1[key2];
            if (level2 && typeof level2 === 'object' && typeof level2.callback === 'function') {
              level2.callback(sol);
              return true;
            }
          }
        }
      }
    }
    return Boolean(textarea && textarea.value === sol);
  }, token);
}

/**
 * Ask the service to solve the challenge on the current page, and put the
 * token into this page.
 *
 * @returns true when a token was delivered to the page.
 */
export async function solveRecaptchaViaService(
  page: Page,
  opts: ServiceSolveOptions = {},
): Promise<boolean> {
  if (!CAPTCHA_SERVICE_URL) {
    throw new Error('CAPTCHA_SERVICE_URL is not set; cannot use the solving service');
  }

  const pageUrl = opts.loginButton ? CAPTCHA_SERVICE_PAGE_URL : page.url();

   // Extract the reCAPTCHA sitekey so the solving backend (e.g. YesCaptcha)
  // can create a properly-scoped task. The token is bound to the sitekey and
  // page origin, so the backend needs it to request a valid token.
  let siteKey = await extractSiteKey(page);
  if (siteKey) {
    console.log(`[captcha-service] extracted reCAPTCHA sitekey: ${siteKey}`);
  } else {
    console.warn(
      '[captcha-service] could not read sitekey from the page; falling back to the portal\'s known sitekey',
    );
    siteKey = PORTAL_SITEKEY;
    console.log(`[captcha-service] using known sitekey: ${siteKey}`);
  }

  console.log(`[captcha-service] asking the service to solve ${pageUrl}`);
  const result = await solveViaService(pageUrl, opts.loginButton, siteKey);
  console.log(
    `[captcha-service] solved via "${result.method}" in ${result.elapsedMs}ms; injecting the token`,
  );

  const injected = await injectToken(page, result.token!);
  if (!injected) {
    throw new Error('[captcha-service] could not put the token into the page');
  }
  console.log('[captcha-service] token delivered to the page');
  return true;
}
