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

  const pageUrl = opts.loginButton
    ? 'https://rupayselect.truztee.com/#/login'
    : page.url();

  console.log(`[captcha-service] asking the service to solve ${pageUrl}`);
  const result = await solveViaService(pageUrl, opts.loginButton);
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
