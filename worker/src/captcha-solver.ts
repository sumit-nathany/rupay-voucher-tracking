/**
 * reCAPTCHA callback capture / token injection utilities.
 *
 * The worker delegates all solving to the external ReCaptcha Solver service.
 * These helpers capture the site's reCAPTCHA callback before a challenge
 * replaces it, and inject a token returned by the service into the page.
 *
 * The worker never solves a CAPTCHA itself.
 */
import { Page } from 'playwright';

/**
 * The captcha provider in use.
 *
 * The only supported value is "service": the worker always delegates to the
 * external solving service at CAPTCHA_SERVICE_URL. Local solver backends
 * (AZCaptcha, CapMonster, etc.) have been removed.
 */
export const CAPTCHA_PROVIDER = (process.env.CAPTCHA_PROVIDER || 'service').toLowerCase();

/**
 * Whether the external solving service is configured.
 *
 * The worker refuses to start a browser run unless this is set — without it,
 * there is no way to solve the login challenge, and an unattended run would
 * silently do nothing.
 */
export function captchaServiceConfigured(): boolean {
  return Boolean(process.env.CAPTCHA_SERVICE_URL);
}

// ── Callback capture ──────────────────────────────────────────────────────────

/**
 * Stash the site's reCAPTCHA callback before a challenge can replace it.
 *
 * When the widget renders, reCAPTCHA keeps the site's handler at
 * `___grecaptcha_cfg.clients[id].A.callback`. As soon as the checkbox is
 * clicked and a challenge opens, that slot is taken over by reCAPTCHA's own
 * challenge handler — so by the time we have a token, the site's callback is
 * gone and calling whatever is left in that tree does nothing useful.
 *
 * So take a reference to it while it is still the site's, and keep it.
 *
 * Only the success callback is taken, and only the first one found in each
 * client. The same tree also holds `expired-callback` — which resets the
 * form when it fires — and zone internals with a `callback` key of their
 * own. Calling either of those with a token breaks the login, so they are
 * left alone.
 */
export async function captureRecaptchaCallback(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const w = window as any;
    if (Array.isArray(w.__captchaCallbacks) && w.__captchaCallbacks.length > 0) {
      return true;
    }
    w.__captchaCallbacks = [];
    const cfg = w.___grecaptcha_cfg;
    if (cfg?.clients) {
      for (const cid of Object.keys(cfg.clients)) {
        const seen = new Set<any>();
        const stack: any[] = [[cfg.clients[cid], 0]];
        while (stack.length > 0) {
          const frame = stack.pop();
          const node = frame[0];
          const depth = frame[1];
          if (!node || typeof node !== 'object' || depth > 4) continue;
          if (seen.has(node)) continue;
          seen.add(node);
          const children: any[] = [];
          let found = false;
          for (const key of Object.keys(node)) {
            const val = node[key];
            if (typeof val === 'function') {
              if (key === 'callback') {
                w.__captchaCallbacks.push(val);
                found = true;
                break;
              }
            } else if (val && typeof val === 'object') {
              children.push([val, depth + 1]);
            }
          }
          if (found) break;
          for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
        }
      }
    }
    return w.__captchaCallbacks.length > 0;
  });
}

/**
 * Inject a solved g-recaptcha-response token into the page and fire the
 * site's callback.
 */
export async function injectRecaptchaToken(page: Page, token: string): Promise<boolean> {
  return await page.evaluate((sol) => {
    const textarea = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.value = sol;
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const w = window as any;
    let fired = false;
    const stashed: any[] = Array.isArray(w.__captchaCallbacks) ? w.__captchaCallbacks : [];
    for (const cb of stashed) {
      try {
        cb(sol);
        fired = true;
      } catch {
        // A callback that throws is not the one we wanted; keep going.
      }
    }

    // Fall back to the live configuration, in case the widget was rendered
    // after we stashed the callback.
    if (!fired) {
      const cfg = w.___grecaptcha_cfg;
      if (cfg?.clients) {
        for (const cid of Object.keys(cfg.clients)) {
          for (const cb of [cfg.clients[cid]?.A?.A?.callback, cfg.clients[cid]?.A?.callback]) {
            if (typeof cb === 'function') {
              try {
                cb(sol);
                fired = true;
              } catch {
                // keep going
              }
            }
          }
        }
      }
    }

    return fired || Boolean(textarea && textarea.value === sol);
  }, token);
}

// ── Solver orchestration ──────────────────────────────────────────────────────

/**
 * Auto-solve reCAPTCHA v2.
 *
 * The worker never solves CAPTCHAs itself. This function exists only for
 * local development sign-in flows; in production it always delegates to the
 * external solving service, which is handled by `captcha-service-solver.ts`.
 */
export async function autoSolveRecaptcha(_page: Page): Promise<boolean> {
  throw new Error(
    'autoSolveRecaptcha is disabled. The worker delegates all CAPTCHA solving ' +
      'to the external solving service (CAPTCHA_SERVICE_URL). ' +
      'For local development, use local-signin.ts instead.',
  );
}
