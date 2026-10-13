import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Page, Frame, Locator } from 'playwright';
import { humanClick, humanType, humanDelay, humanHesitate } from './human-interaction';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE = path.resolve(__dirname, '../.learned-selectors.json');

export interface CandidateElement {
  frameIndex: number;
  frameUrl: string;
  tag: string;
  type?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  text?: string;
  ariaLabel?: string;
  selector: string;
  boundingBox?: { x: number; y: number; width: number; height: number } | null;
}

export interface LearnedSelectorStore {
  [domain: string]: {
    [action: string]: string;
  };
}
export function resolvePage(target: Page | Frame): Page {
  return 'page' in target ? (target as Frame).page() : (target as Page);
}

export function getAllTargets(target: Page | Frame): (Page | Frame)[] {
  const page = resolvePage(target);
  return [page, ...page.frames()];
}

/**
 * Checks if the current page or any frame is displaying an OTP / 3DS verification screen.
 */
export async function isOtpScreenPresent(target: Page | Frame): Promise<boolean> {
  const page = resolvePage(target);
  const targets = getAllTargets(page);
  for (const t of targets) {
    try {
      const hasOtpPrompt = await t.evaluate(() => {
        const text = (document.body?.innerText || '').toLowerCase();
        const inputs = Array.from(document.querySelectorAll('input'));
        const hasOtpText = text.includes('enter otp') || text.includes('one time password') || text.includes('resend otp') || text.includes('3d secure');
        const hasOtpInput = inputs.some((inp) => {
          const p = (inp.placeholder || '').toLowerCase();
          const n = (inp.name || '').toLowerCase();
          const id = (inp.id || '').toLowerCase();
          const ac = (inp.getAttribute('autocomplete') || '').toLowerCase();
          return p.includes('otp') || n.includes('otp') || id.includes('otp') || ac.includes('one-time-code');
        });
        return hasOtpText && (hasOtpInput || text.includes('enter otp to complete payment'));
      }).catch(() => false);
      if (hasOtpPrompt) return true;
    } catch {}
  }
  return false;
}

/**
 * Checks for contact details prompts (e.g. Razorpay Standard Checkout asking for mobile number)
 * and fills them to advance to the card entry screen. Never dismisses!
 * Never executes if the screen is an OTP screen!
 */
export async function handleContactDetailsIfPresent(
  target: Page | Frame,
  options?: { phoneNumber?: string | null; email?: string | null },
): Promise<boolean> {
  const page = resolvePage(target);

  // If already on an OTP screen, never treat it as contact details!
  if (await isOtpScreenPresent(page)) {
    return false;
  }

  let phone = options?.phoneNumber?.replace(/^\+91/, '').replace(/\D/g, '') || '';
  if (!phone || phone.length < 10) {
    phone = '8792839087';
  }
  const email = options?.email || 'coolfriendamit0506@gmail.com';

  for (let attempt = 0; attempt < 3; attempt++) {
    const targets = getAllTargets(target);
    for (const t of targets) {
      try {
        const phoneInput = t
          .locator(
            'input[placeholder*="mobile" i], input[placeholder*="phone" i], input[name="contact"], #contact, input#phone, input[name="phone"], input[type="tel"]:not([placeholder*="card" i]):not([name*="card" i]):not([autocomplete*="cc" i])',
          )
          .first();
        if (await phoneInput.isVisible({ timeout: 400 }).catch(() => false)) {
          const isCardOrOtpField = await phoneInput.evaluate((el: HTMLInputElement) => {
            const str = (el.name + ' ' + el.id + ' ' + el.placeholder + ' ' + (el.getAttribute('autocomplete') || '')).toLowerCase();
            return str.includes('card') || str.includes('cno') || str.includes('cc-') || str.includes('cvv') || str.includes('exp') || str.includes('otp') || str.includes('passcode');
          }).catch(() => false);
          if (isCardOrOtpField) continue;

          const currentVal = await phoneInput.inputValue().catch(() => '');
          if (!currentVal || currentVal.replace(/\D/g, '').length < 10) {
            console.log(`[gateway] Detected Contact Details screen. Filling mobile number of Rupay account (${phone})...`);
            await phoneInput.click().catch(() => {});
            await humanType(phoneInput, phone, { minCharDelayMs: 60, maxCharDelayMs: 120 });
            await page.waitForTimeout(400);
          } else {
            console.log(`[gateway] Mobile number already populated (${currentVal}). Proceeding...`);
          }

          const emailInput = t
            .locator('input[type="email"], input[placeholder*="email" i], input[name="email"]')
            .first();
          if (await emailInput.isVisible({ timeout: 400 }).catch(() => false)) {
            const currentEmail = await emailInput.inputValue().catch(() => '');
            if (!currentEmail || !currentEmail.includes('@')) {
              console.log(`[gateway] Filling email address (${email})...`);
              await emailInput.fill(email);
              await page.waitForTimeout(400);
            }
          }

          const continueBtn = t
            .locator(
              ':is(button, [role="button"], a):has-text("Continue"), :is(button, [role="button"], a):has-text("Proceed")',
            )
            .first();
          if (await continueBtn.isVisible({ timeout: 800 }).catch(() => false)) {
            console.log('[gateway] Clicking Continue on contact details modal (never dismissing)...');
            await humanClick(continueBtn, { hesitateBeforeMs: 400, pauseAfterMs: 1500 });
            await continueBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {});
            await page.waitForTimeout(1500);
            return true;
          }
        }
      } catch {}
    }
    await page.waitForTimeout(300);
  }
  return false;
}

/**
 * Loads cached learned selectors from disk.
 */
export function loadLearnedSelectors(): LearnedSelectorStore {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf-8');
      return JSON.parse(data) as LearnedSelectorStore;
    }
  } catch (err) {
    console.warn('[llm-agent] Could not read selector cache:', err);
  }
  return {};
}

/**
 * Saves a learned working selector to disk for future runs.
 */
export function saveLearnedSelector(domain: string, action: string, selector: string): void {
  try {
    const store = loadLearnedSelectors();
    if (!store[domain]) {
      store[domain] = {};
    }
    store[domain][action] = selector;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(store, null, 2), 'utf-8');
    console.log(`[llm-agent] 🧠 Learned and cached selector for "${domain}" -> "${action}": ${selector}`);
  } catch (err) {
    console.warn('[llm-agent] Could not save selector cache:', err);
  }
}

/**
 * Extracts the hostname domain from a URL.
 */
export function getDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return 'unknown_domain';
  }
}

/**
 * Scans a Page or Frame for candidate interactive elements based on the intended action.
 */
export async function scanCandidates(
  page: Page,
  actionType: 'cvv' | 'pay_button' | 'otp_input' | 'otp_submit' | 'advance_payment',
): Promise<CandidateElement[]> {
  const frames = [page, ...page.frames()];
  const allCandidates: CandidateElement[] = [];

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const target = frames[frameIndex];
    const frameUrl = 'url' in target ? target.url() : page.url();

    try {
      const candidates = await target.evaluate(`
        (function(type) {
          function isVisible(el) {
            var style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          }

          var results = [];

          if (type === 'cvv') {
            var inputs = Array.from(document.querySelectorAll('input'));
            for (var i = 0; i < inputs.length; i++) {
              var el = inputs[i];
              if (!isVisible(el)) continue;
              var inputType = el.getAttribute('type') || 'text';
              var name = el.getAttribute('name') || '';
              var id = el.getAttribute('id') || '';
              var placeholder = el.getAttribute('placeholder') || '';
              var maxLen = el.getAttribute('maxlength') || '';
              var labelText = el.closest('label') ? (el.closest('label').textContent || '') : '';

              var isCvvCandidate =
                /cvv|cvc|security|code|verification/i.test(name) ||
                /cvv|cvc|security|code/i.test(id) ||
                /cvv|cvc/i.test(placeholder) ||
                /cvv|cvc/i.test(labelText) ||
                (maxLen === '3' || maxLen === '4') ||
                (inputType === 'password' && (maxLen === '3' || maxLen === '4' || placeholder.length <= 4));

              if (isCvvCandidate) {
                var sel = '';
                if (id) sel = '#' + id;
                else if (name) sel = 'input[name="' + name + '"]';
                else if (placeholder) sel = 'input[placeholder="' + placeholder + '"]';
                else sel = 'input[type="password"]';

                results.push({
                  tag: 'INPUT',
                  type: inputType,
                  id: id,
                  name: name,
                  placeholder: placeholder,
                  text: labelText.trim(),
                  selector: sel,
                });
              }
            }
          } else if (type === 'pay_button') {
            var clickables = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], a.btn'));
            for (var j = 0; j < clickables.length; j++) {
              var el = clickables[j];
              if (!isVisible(el)) continue;
              var text = (el.textContent || el.value || '').trim();
              var id = el.getAttribute('id') || '';
              var isPay =
                /pay|proceed|continue|submit|make\\s*payment|₹|inr/i.test(text) ||
                /pay|proceed|submit/i.test(id) ||
                /pay/i.test(el.className);

              if (isPay) {
                var sel = '';
                if (id) sel = '#' + id;
                else if (text) sel = el.tagName.toLowerCase() + ':has-text("' + text.slice(0, 20) + '")';
                else sel = el.tagName.toLowerCase();

                results.push({
                  tag: el.tagName,
                  id: id,
                  text: text,
                  selector: sel,
                });
              }
            }
          } else if (type === 'otp_input') {
            var inputs = Array.from(document.querySelectorAll('input'));
            for (var k = 0; k < inputs.length; k++) {
              var el = inputs[k];
              if (!isVisible(el)) continue;
              var inputType = el.getAttribute('type') || 'text';
              var name = el.getAttribute('name') || '';
              var id = el.getAttribute('id') || '';
              var placeholder = el.getAttribute('placeholder') || '';
              var autocomplete = el.getAttribute('autocomplete') || '';

              var isOtp =
                /otp|passcode|code|pin|one\\s*time/i.test(name) ||
                /otp|passcode|code|pin/i.test(id) ||
                /otp|passcode|code|pin/i.test(placeholder) ||
                autocomplete.includes('one-time-code') ||
                inputType === 'password';

              if (isOtp) {
                var sel = '';
                if (id) sel = '#' + id;
                else if (name) sel = 'input[name="' + name + '"]';
                else if (placeholder) sel = 'input[placeholder="' + placeholder + '"]';
                else sel = 'input[type="' + inputType + '"]';

                results.push({
                  tag: 'INPUT',
                  type: inputType,
                  id: id,
                  name: name,
                  placeholder: placeholder,
                  selector: sel,
                });
              }
            }
          } else if (type === 'otp_submit') {
            var buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn'));
            for (var m = 0; m < buttons.length; m++) {
              var el = buttons[m];
              if (!isVisible(el)) continue;
              var text = (el.textContent || el.value || '').trim();
              var id = el.getAttribute('id') || '';

              var isSubmit =
                /submit|verify|confirm|proceed|pay|continue/i.test(text) ||
                /submit|verify|confirm/i.test(id);

              if (isSubmit) {
                var sel = '';
                if (id) sel = '#' + id;
                else if (text) sel = el.tagName.toLowerCase() + ':has-text("' + text.slice(0, 20) + '")';
                else sel = el.tagName.toLowerCase();

                results.push({
                  tag: el.tagName,
                  id: id,
                  text: text,
                  selector: sel,
                });
              }
            }
          } else if (type === 'advance_payment') {
            var clickables = Array.from(
              document.querySelectorAll(
                'button, [role="button"], input[type="submit"], input[type="button"], a, [data-dismiss], [aria-label*="close" i], [aria-label*="dismiss" i], .close, .btn-close, [onclick], [tabindex="0"], [data-testid*="offer" i], [class*="offer" i], [class*="card" i]'
              )
            );
            for (var idx = 0; idx < clickables.length; idx++) {
              var el = clickables[idx];
              if (!isVisible(el)) continue;
              var text = (el.textContent || el.value || '').trim().replace(/\\s+/g, ' ');
              var id = el.getAttribute('id') || '';
              var ariaLabel = el.getAttribute('aria-label') || '';
              var title = el.getAttribute('title') || '';
              var candAttr = 'cand-' + idx;
              el.setAttribute('data-llm-cand-id', candAttr);

              var rect = el.getBoundingClientRect();
              results.push({
                tag: el.tagName,
                id: id,
                text: text.slice(0, 80),
                ariaLabel: (ariaLabel || title).slice(0, 80),
                selector: '[data-llm-cand-id="' + candAttr + '"]',
                boundingBox: {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                },
              });
            }
          }

          return results;
        })('${actionType}')
      `) as any;

      for (const c of candidates) {
        allCandidates.push({
          ...c,
          frameIndex,
          frameUrl,
        });
      }
    } catch (err) {
      console.warn(`[llm-agent] Warning evaluating frame #${frameIndex}:`, err);
    }
  }

  console.log(`[llm-agent] Scanned ${allCandidates.length} candidate elements across ${frames.length} frames.`);
  return allCandidates;
}

/**
 * Calls Gemini Vision API to identify target element index from screenshot and candidates list.
 */
export async function consultGeminiVision(
  screenshotBase64: string,
  candidates: CandidateElement[],
  taskDescription: string,
  apiKey: string,
): Promise<{ candidateIndex: number; action: string; reasoning: string } | null> {
  const models = ['gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-3.7-flash'];

  for (const model of models) {
    try {
      console.log(`[llm-agent] Consulting Gemini Vision (${model}) for task: "${taskDescription}"...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const simplifiedCandidates = candidates.map((c, i) => ({
        index: i,
        tag: c.tag,
        type: c.type,
        id: c.id,
        name: c.name,
        placeholder: c.placeholder,
        text: c.text,
        frameUrl: c.frameUrl,
      }));

      const prompt = `You are an automated web agent helper inspecting a live payment gateway or 3DS authentication screen.
Task: ${taskDescription}

Candidate interactive elements extracted from DOM:
${JSON.stringify(simplifiedCandidates, null, 2)}

Look at the screenshot and find which candidate element index is the exact target to perform this task.
Respond ONLY with a valid JSON object matching this schema:
{
  "found": true | false,
  "candidateIndex": number,
  "action": "click" | "fill",
  "reasoning": "brief explanation"
}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: 'image/png',
                    data: screenshotBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: 'application/json',
          },
        }),
      });

      if (!res.ok) {
        console.warn(`[llm-agent] Gemini model ${model} responded with ${res.status}: ${res.statusText}`);
        continue;
      }

      const json = (await res.json()) as any;
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text);
        if (parsed.found && typeof parsed.candidateIndex === 'number' && parsed.candidateIndex < candidates.length) {
          console.log(`[llm-agent] 🎯 Gemini identified candidate #${parsed.candidateIndex}: ${parsed.reasoning}`);
          return parsed;
        }
      }
    } catch (err) {
      console.warn(`[llm-agent] Gemini vision evaluation error with ${model}:`, err);
    }
  }

  return null;
}

/**
 * Resolves and enters CVV into the payment gateway using learned cache, heuristic candidates, or Gemini vision.
 */
export async function resolveAndFillCvv(
  page: Page,
  cvv: string,
): Promise<boolean> {
  const domain = getDomain(page.url());
  const store = loadLearnedSelectors();
  const cachedSel = store[domain]?.['saved_card_cvv'] || store[domain]?.['cvv'];

  // 1. Try cached selector first
  if (cachedSel) {
    console.log(`[llm-agent] Trying cached CVV selector: "${cachedSel}" on ${domain}...`);
    for (const frame of [page, ...page.frames()]) {
      try {
        const loc = frame.locator(cachedSel).first();
        if (await loc.isVisible({ timeout: 1000 })) {
          await humanHesitate(300, 600);
          await humanType(loc, cvv, { minCharDelayMs: 90, maxCharDelayMs: 180 });
          console.log(`[llm-agent] ✓ CVV filled successfully using cached selector!`);
          return true;
        }
      } catch {}
    }
  }

  // 2. Scan DOM candidates across all frames
  console.log(`[llm-agent] Scanning DOM for CVV input candidates...`);
  const candidates = await scanCandidates(page, 'cvv');

  // If there's an obvious candidate with id or name containing cvv
  const directMatch = candidates.find(
    (c) => /cvv|cvc/i.test(c.id || '') || /cvv|cvc/i.test(c.name || '') || /cvv|cvc/i.test(c.placeholder || ''),
  );

  if (directMatch) {
    const targetFrame = [page, ...page.frames()][directMatch.frameIndex] || page;
    const loc = targetFrame.locator(directMatch.selector).first();
    if (await loc.isVisible({ timeout: 1000 })) {
      await humanHesitate(400, 700);
      await humanType(loc, cvv, { minCharDelayMs: 90, maxCharDelayMs: 180 });
      saveLearnedSelector(domain, 'saved_card_cvv', directMatch.selector);
      return true;
    }
  }

  // 3. Fallback to Gemini Vision if API key is present
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey && candidates.length > 0) {
    const screenshotBuf = await page.screenshot();
    const geminiDecision = await consultGeminiVision(
      screenshotBuf.toString('base64'),
      candidates,
      'Find the CVV or Security Code input field for the card',
      apiKey,
    );

    if (geminiDecision) {
      const best = candidates[geminiDecision.candidateIndex];
      const targetFrame = [page, ...page.frames()][best.frameIndex] || page;
      const loc = targetFrame.locator(best.selector).first();
      if (await loc.isVisible({ timeout: 1500 })) {
        await humanHesitate(400, 700);
        await humanType(loc, cvv, { minCharDelayMs: 90, maxCharDelayMs: 180 });
        saveLearnedSelector(domain, 'saved_card_cvv', best.selector);
        return true;
      }
    }
  }

  return false;
}

/**
 * Resolves and clicks the primary Pay / Proceed button using learned cache, candidates, or Gemini vision.
 */
export async function resolveAndClickPay(
  page: Page,
): Promise<boolean> {
  const domain = getDomain(page.url());
  const store = loadLearnedSelectors();
  const cachedSel = store[domain]?.['pay_button'];

  // 1. Try cached selector
  if (cachedSel) {
    console.log(`[llm-agent] Trying cached Pay button selector: "${cachedSel}" on ${domain}...`);
    for (const frame of [page, ...page.frames()]) {
      try {
        const loc = frame.locator(cachedSel).first();
        if (await loc.isVisible({ timeout: 1000 })) {
          await humanClick(loc, { hesitateBeforeMs: 400, pauseAfterMs: 1500 });
          console.log(`[llm-agent] ✓ Clicked Pay button using cached selector!`);
          return true;
        }
      } catch {}
    }
  }

  // 2. Scan DOM candidates
  console.log(`[llm-agent] Scanning DOM for Pay button candidates...`);
  const candidates = await scanCandidates(page, 'pay_button');

  // Look for strong match (e.g., Pay ₹1 or Pay button)
  const strongMatch = candidates.find(
    (c) => /pay\s*₹|pay\s*1|make\s*payment|proceed/i.test(c.text || '') || /btn-pay|btn_pay/i.test(c.id || ''),
  );

  if (strongMatch) {
    const targetFrame = [page, ...page.frames()][strongMatch.frameIndex] || page;
    const loc = targetFrame.locator(strongMatch.selector).first();
    if (await loc.isVisible({ timeout: 1000 })) {
      await humanClick(loc, { hesitateBeforeMs: 400, pauseAfterMs: 1500 });
      saveLearnedSelector(domain, 'pay_button', strongMatch.selector);
      return true;
    }
  }

  // 3. Fallback to Gemini Vision if available
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey && candidates.length > 0) {
    const screenshotBuf = await page.screenshot();
    const geminiDecision = await consultGeminiVision(
      screenshotBuf.toString('base64'),
      candidates,
      'Find the primary button to submit payment or proceed (e.g. Pay, Make Payment, Proceed)',
      apiKey,
    );

    if (geminiDecision) {
      const best = candidates[geminiDecision.candidateIndex];
      const targetFrame = [page, ...page.frames()][best.frameIndex] || page;
      const loc = targetFrame.locator(best.selector).first();
      if (await loc.isVisible({ timeout: 1500 })) {
        await humanClick(loc, { hesitateBeforeMs: 400, pauseAfterMs: 1500 });
        saveLearnedSelector(domain, 'pay_button', best.selector);
        return true;
      }
    }
  }

  return false;
}

/**
 * Resolves OTP input on bank ACS page using learned cache, candidate scan, or Gemini vision.
 */
export async function resolveOtpInput(
  page: Page,
): Promise<{ target: Page | Frame; locator: Locator } | null> {
  const domain = getDomain(page.url());
  const store = loadLearnedSelectors();
  const cachedSel = store[domain]?.['otp_input'];

  // 1. Try cached selector
  if (cachedSel) {
    for (const frame of [page, ...page.frames()]) {
      try {
        const loc = frame.locator(cachedSel).first();
        if (await loc.isVisible({ timeout: 1000 })) {
          console.log(`[llm-agent] ✓ Located OTP input via cached selector: "${cachedSel}"`);
          return { target: frame, locator: loc };
        }
      } catch {}
    }
  }

  // 2. Scan DOM candidates
  const candidates = await scanCandidates(page, 'otp_input');
  const directMatch = candidates.find(
    (c) => /otp|passcode|code|pin/i.test(c.id || '') || /otp|passcode|code|pin/i.test(c.name || ''),
  );

  if (directMatch) {
    const targetFrame = [page, ...page.frames()][directMatch.frameIndex] || page;
    const loc = targetFrame.locator(directMatch.selector).first();
    if (await loc.isVisible({ timeout: 1000 })) {
      saveLearnedSelector(domain, 'otp_input', directMatch.selector);
      return { target: targetFrame, locator: loc };
    }
  }

  // 3. Fallback to Gemini Vision if available
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey && candidates.length > 0) {
    const screenshotBuf = await page.screenshot();
    const geminiDecision = await consultGeminiVision(
      screenshotBuf.toString('base64'),
      candidates,
      'Find the bank 3DS OTP input field where the 6-digit or 4-digit SMS OTP should be typed',
      apiKey,
    );

    if (geminiDecision) {
      const best = candidates[geminiDecision.candidateIndex];
      const targetFrame = [page, ...page.frames()][best.frameIndex] || page;
      const loc = targetFrame.locator(best.selector).first();
      if (await loc.isVisible({ timeout: 1500 })) {
        saveLearnedSelector(domain, 'otp_input', best.selector);
        return { target: targetFrame, locator: loc };
      }
    }
  }

  return null;
}

export interface GatewayScreenAnalysis {
  state: 'TOKENIZATION_MODAL' | 'BANK_OTP_SCREEN' | 'CARD_INPUT_SCREEN' | 'PROCESSING_OR_LOADING' | 'ORDER_SUCCESS' | 'CARD_INPUT_ERROR' | 'OFFERS_POPUP' | 'UNKNOWN';
  description: string;
  action: 'click_secure_and_pay' | 'click_opt_out' | 'dismiss_popup' | 'wait_for_otp' | 'none';
  targetButtonText?: string;
}

/**
 * Uses Gemini Vision to analyze the current payment screen state.
 */
export async function analyzeGatewayScreenWithLLM(
  screenshotBase64: string,
  apiKey: string,
): Promise<GatewayScreenAnalysis | null> {
  const models = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const prompt = `You are an expert payment gateway analyzer helping an automated checkout agent in India.
Analyze this screenshot of the current payment checkout screen.

Classify the screen into one of these states:
1. "BANK_OTP_SCREEN": An authentic 3D-Secure / Bank OTP verification page is visible (explicitly asking for SMS OTP / 3DS passcode, bank logo like PNB/SBI/HDFC/Axis/ICICI/PayU/Razorpay/Wibmo, OTP input box, submit/verify button). The page indicates that the bank is asking for OTP to authorize the transaction.
2. "CARD_INPUT_SCREEN": The user or gateway is on the card details entry screen (entering card number, expiry, CVV, or choosing a saved debit/credit card). This is NOT an OTP screen.
3. "TOKENIZATION_MODAL": An RBI card tokenization modal/popup is visible (e.g., "Secure your card with Rupay", "Secure & Pay", "Opt out for now", "Save this card as per RBI guidelines").
4. "OFFERS_POPUP": An offer modal or promotions overlay is displayed (e.g. "Save more with payment offers", discounts popup, skip/continue prompt).
5. "PROCESSING_OR_LOADING": A loading spinner, processing animation, "Please wait while we redirect you to your bank", or waiting for bank response.
6. "ORDER_SUCCESS": Order confirmed / success page / transaction reference displayed.
7. "CARD_INPUT_ERROR": An error banner or validation error on the card form (e.g. invalid CVV, expired card, declined).
8. "UNKNOWN": Any other screen.

Respond in valid JSON only with this schema:
{
  "state": "BANK_OTP_SCREEN" | "CARD_INPUT_SCREEN" | "TOKENIZATION_MODAL" | "OFFERS_POPUP" | "PROCESSING_OR_LOADING" | "ORDER_SUCCESS" | "CARD_INPUT_ERROR" | "UNKNOWN",
  "description": "brief 1-sentence description of what is on screen",
  "action": "click_secure_and_pay" | "click_opt_out" | "dismiss_popup" | "wait_for_otp" | "none",
  "targetButtonText": "text of the button to click (e.g. 'Secure & Pay', 'Opt out for now', 'Continue without offer', 'Skip', or close button)"
}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(12000),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: 'image/png',
                    data: screenshotBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: 'application/json',
          },
        }),
      });

      if (!res.ok) {
        continue;
      }

      const json = (await res.json()) as any;
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text) as GatewayScreenAnalysis;
        return parsed;
      }
    } catch {
      // try next model
    }
  }

  return null;
}

export interface LlmAdvancePaymentResult {
  handled: boolean;
  reachedOtp: boolean;
  reachedSuccess: boolean;
  description: string;
}

/**
 * Autonomous LLM Vision Agent:
 * Whenever the automation is stuck or navigating an unknown pre/post payment screen:
 * Takes a screenshot, extracts all clickable candidate elements across frames, and asks Gemini Vision:
 * "Which element should be clicked to move forward in completing the payment?"
 */
export async function askLlmToAdvancePayment(
  page: Page,
  apiKey: string,
  options?: { phoneNumber?: string | null; email?: string | null },
): Promise<LlmAdvancePaymentResult> {
  const screenshotBuf = await page.screenshot({ timeout: 5000 }).catch(() => null);
  if (!screenshotBuf) {
    return { handled: false, reachedOtp: false, reachedSuccess: false, description: 'Screenshot capture failed' };
  }
  try {
    fs.writeFileSync(path.resolve(process.cwd(), 'payment-screen-current.png'), screenshotBuf);
  } catch {}

  const candidates = await scanCandidates(page, 'advance_payment');
  const simplifiedCandidates = candidates.slice(0, 65).map((c, i) => ({
    index: i,
    tag: c.tag,
    id: c.id || undefined,
    text: c.text?.slice(0, 60) || undefined,
    ariaLabel: c.ariaLabel || undefined,
  }));

  const prompt = `You are an automated browser payment agent completing a ₹1 RuPay card checkout.
Look at the attached screenshot of the current payment screen.

We extracted these candidate clickable elements from the page and child iframes:
${JSON.stringify(simplifiedCandidates, null, 2)}

Your task: Determine what state the screen is in and which element to interact with to MOVE FORWARD toward completing payment.

Rules:
1. If this screen is the Bank 3D-Secure OTP verification page (asking for SMS OTP / 3DS passcode, bank logo like PNB/SBI/HDFC/PayU/Wibmo):
   Set "screenType": "BANK_OTP_SCREEN", "action": "otp_ready".
2. If this screen is Order Confirmed / Success / Booking Confirmed:
   Set "screenType": "ORDER_SUCCESS", "action": "order_confirmed".
3. If this screen is asking for Contact details (e.g. mobile number, phone number, email, or "Enter mobile number to continue"):
   DO NOT dismiss or close the modal! Select the "Continue", "Proceed", or phone input button/field to enter phone number and continue.
4. If this screen is blocked by an Offers Popup (e.g. "Save more with payment offers"), promo modal, or offer limit error:
   The promo offer limit has been exceeded, so we must PROCEED WITHOUT THE OFFER or REMOVE/DISMISS the offer.
   Identify which candidate index from the list MUST be clicked to continue without offer, remove offer, or close the modal (e.g. "Continue without offer", "Pay without offer", "Remove", click the checked offer tile to deselect, or close "×").
   Set "screenType": "MODAL_OR_FORM", "action": "click_element", "targetIndex": <number>.
5. If this screen is the Payment Gateway form or review screen with a "Pay ₹1", "Pay ₹2", "Pay Now", "Make Payment", or "Pay" button:
   Select that candidate index to click the Pay button and submit payment.
   Set "screenType": "MODAL_OR_FORM", "action": "click_element", "targetIndex": <number>.
6. If this screen is an RBI Tokenization modal ("Secure your card with Rupay" / "Secure & Pay" / "Opt out"):
   Select the candidate index for "Secure & Pay" or "Opt out for now".
   Set "screenType": "MODAL_OR_FORM", "action": "click_element", "targetIndex": <number>.
7. If this is a loading spinner or processing screen:
   Set "screenType": "PROCESSING", "action": "wait".

Respond ONLY in valid JSON matching this schema:
{
  "screenType": "BANK_OTP_SCREEN" | "ORDER_SUCCESS" | "MODAL_OR_FORM" | "PROCESSING" | "UNKNOWN",
  "description": "brief 1-sentence description of what is on screen",
  "action": "click_element" | "wait" | "otp_ready" | "order_confirmed",
  "targetIndex": number,
  "reasoning": "why clicking this element moves the payment forward"
}`;

  const models = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash'];
  for (const model of models) {
    try {
      console.log(`[llm-agent] 🧠 Consulting Gemini Vision (${model}) to advance payment...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: 'image/png',
                    data: screenshotBuf.toString('base64'),
                  },
                },
              ],
            },
          ],
          generationConfig: {
            response_mime_type: 'application/json',
          },
        }),
      });

      if (!res.ok) continue;

      const json = (await res.json()) as any;
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;

      const parsed = JSON.parse(text);
      console.log(`[llm-agent] Visual Analysis: [${parsed.screenType}] - "${parsed.description}"`);

      if (parsed.screenType === 'BANK_OTP_SCREEN' || parsed.action === 'otp_ready') {
        return { handled: true, reachedOtp: true, reachedSuccess: false, description: parsed.description };
      }

      if (parsed.screenType === 'ORDER_SUCCESS' || parsed.action === 'order_confirmed') {
        return { handled: true, reachedOtp: false, reachedSuccess: true, description: parsed.description };
      }

      if (parsed.action === 'click_element' && typeof parsed.targetIndex === 'number' && parsed.targetIndex >= 0 && parsed.targetIndex < candidates.length) {
        const target = candidates[parsed.targetIndex];
        if (!target) {
          console.warn(`[llm-agent] Candidate #${parsed.targetIndex} not found in array (length: ${candidates.length}).`);
          return { handled: false, reachedOtp: false, reachedSuccess: false, description: parsed.description };
        }

        // Guard: Never click a close/dismiss button if a contact details modal or phone input is present!
        const isDismissTarget =
          /close|dismiss|✕|×/i.test(target.text || '') ||
          /close|dismiss/i.test(target.ariaLabel || '') ||
          /close|dismiss/i.test(target.selector);
        const hasPhoneInput = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('input')).some((inp) => {
            const p = (inp.placeholder || '').toLowerCase();
            const n = (inp.name || '').toLowerCase();
            const t = (inp.type || '').toLowerCase();
            return t === 'tel' || p.includes('mobile') || p.includes('phone') || n.includes('contact');
          });
        }).catch(() => false);

        if (isDismissTarget && hasPhoneInput) {
          console.warn('[llm-agent] 🛑 Blocked attempt to dismiss Contact Details modal! Filling phone number and clicking Continue instead.');
          await handleContactDetailsIfPresent(page, { phoneNumber: options?.phoneNumber, email: options?.email });
          return { handled: true, reachedOtp: false, reachedSuccess: false, description: 'Handled contact popup instead of dismissing' };
        }

        const targetFrame = [page, ...page.frames()][target.frameIndex] || page;
        const loc = targetFrame.locator(target.selector).first();
        console.log(`[llm-agent] 🎯 LLM chose element #${parsed.targetIndex} ("${target.text || target.ariaLabel || target.selector}"): ${parsed.reasoning}`);
        
        let clicked = false;
        try {
          if (await loc.isVisible({ timeout: 1500 })) {
            await humanClick(loc, { hesitateBeforeMs: 400, pauseAfterMs: 2000 });
            await loc.evaluate((el: HTMLElement) => el.click()).catch(() => {});
            clicked = true;
          }
        } catch (clickErr) {
          console.warn(`[llm-agent] Locator click warning:`, clickErr);
        }

        if (!clicked && target.boundingBox) {
          try {
            const centerX = target.boundingBox.x + target.boundingBox.width / 2;
            const centerY = target.boundingBox.y + target.boundingBox.height / 2;
            console.log(`[llm-agent] Clicking element #${parsed.targetIndex} via mouse coordinates (${centerX}, ${centerY})...`);
            await page.mouse.click(centerX, centerY);
            clicked = true;
          } catch {}
        }

        return { handled: true, reachedOtp: false, reachedSuccess: false, description: parsed.description };
      }

      if (parsed.action === 'wait') {
        return { handled: true, reachedOtp: false, reachedSuccess: false, description: parsed.description };
      }
    } catch (err) {
      console.warn(`[llm-agent] Error during Gemini Vision advancement (${model}):`, err);
    }
  }

  return { handled: false, reachedOtp: false, reachedSuccess: false, description: 'LLM did not identify action' };
}

/**
 * Monitors the gateway transition after clicking "Proceed to Pay".
 * Handles RBI Tokenization modals, offers popups, and unknown pre-payment screens via Autonomous LLM Vision Agent,
 * and only resolves once the genuine Bank 3D-Secure OTP screen or confirmation screen is reached.
 */
export async function handlePostPaymentTransition(
  page: Page,
  options?: {
    maxWaitSec?: number;
    apiKey?: string;
    phoneNumber?: string | null;
    email?: string | null;
  },
): Promise<{ reachedOtp: boolean; reachedSuccess: boolean; reason?: string }> {
  const maxWaitSec = options?.maxWaitSec ?? 60;
  const apiKey = options?.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  console.log('[gateway] Monitoring post-payment state and handling transitions with Autonomous LLM Vision Agent...');

  for (let sec = 0; sec < maxWaitSec; sec += 3) {
    await page.waitForTimeout(2500);

    const currUrl = page.url();

    // 1. Fast check: confirmed/success page text
    if (currUrl.includes('success') || currUrl.includes('confirm') || currUrl.includes('booking')) {
      const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (/(?:booking|reference|order|transaction)\s*(?:id|no|#)?\s*[:\-]?\s*([A-Za-z0-9\-_]{6,30})/i.test(pageText)) {
        console.log('[gateway] ✓ Order confirmation already reached!');
        return { reachedOtp: false, reachedSuccess: true };
      }
    }

    // 1b. Fast check: Bank 3D-Secure OTP screen is already reached!
    if (await isOtpScreenPresent(page)) {
      console.log('[gateway] ✓ Bank 3D-Secure OTP screen detected via DOM indicators!');
      return { reachedOtp: true, reachedSuccess: false };
    }

    // 2. Fast check: Contact Details popup (Enter mobile number to continue)
    // CRITICAL: NEVER dismiss this popup! Enter the RuPay account phone number and click Continue.
    const contactHandled = await handleContactDetailsIfPresent(page, {
      phoneNumber: options?.phoneNumber,
      email: options?.email,
    });
    if (contactHandled) {
      console.log('[gateway] Contact details submitted. Continuing transition...');
      continue;
    }

    // 2. Fast-path check: Is the RBI Tokenization Modal or Offers Popup visible in DOM across frames?
    let modalHandled = false;
    for (const t of [page, ...page.frames()]) {
      const secureAndPayBtn = t.locator(':is(button, [role="button"], a, div):has-text("Secure & Pay")').first();
      const optOutBtn = t.locator(':is(button, [role="button"], a, div):has-text("Opt out for now")').first();
      const modalHeader = t.locator(':is(h1, h2, h3, h4, div, span):has-text("Secure your card")').first();

      const isModalVisible =
        (await secureAndPayBtn.isVisible().catch(() => false)) ||
        (await modalHeader.isVisible().catch(() => false));

      if (isModalVisible) {
        console.log('[gateway] 🛡️ Detected RBI Tokenization Modal ("Secure your card with Rupay").');
        if (await secureAndPayBtn.isVisible().catch(() => false)) {
          console.log('[gateway] Clicking "Secure & Pay" with human cursor...');
          await humanClick(secureAndPayBtn, { hesitateBeforeMs: 400, pauseAfterMs: 2000 });
        } else if (await optOutBtn.isVisible().catch(() => false)) {
          console.log('[gateway] Clicking "Opt out for now" with human cursor...');
          await humanClick(optOutBtn, { hesitateBeforeMs: 400, pauseAfterMs: 2000 });
        }
        modalHandled = true;
        break;
      }
    }
    if (modalHandled) continue;

    // 2b. Check for Razorpay "Save more with payment offers" popup or offer limit error
    for (const t of [page, ...page.frames()]) {
      const offersHeader = t.locator(':is(h1, h2, h3, h4, div, span):has-text("Save more with payment offers")').first();
      const hasOfferError = await page.evaluate(() => {
        const text = document.body.innerText || '';
        return text.includes('exceeded the limit to use this offer') || text.includes('Save more with payment offers');
      }).catch(() => false);

      if (hasOfferError || (await offersHeader.isVisible().catch(() => false))) {
        console.log('[gateway] Detected Razorpay offer limit notice / offers popup.');
        
        // 1. If "Continue without offer" or "Pay without offer" is visible, click it!
        const continueWithoutOffer = t.locator(':is(button, [role="button"], a):has-text("Continue without offer"), :is(button, [role="button"], a):has-text("Pay without offer")').first();
        if (await continueWithoutOffer.isVisible().catch(() => false)) {
          console.log('[gateway] Clicking "Continue without offer"...');
          await humanClick(continueWithoutOffer, { hesitateBeforeMs: 400, pauseAfterMs: 2000 });
          modalHandled = true;
          break;
        }

        // 2. Dismiss offers popup via close button
        const closeBtn = t.locator('button[aria-label*="Close" i], button.btn-close, button.close, :is(button, [role="button"]):has-text("✕"), :is(button, [role="button"]):has-text("×")').first();
        if (await closeBtn.isVisible().catch(() => false)) {
          console.log('[gateway] Dismissing offers popup...');
          await humanClick(closeBtn, { hesitateBeforeMs: 300, pauseAfterMs: 1200 });
          await closeBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {});
        }

        // 3. Remove/uncheck the applied offer under "Available Offers" so payment proceeds cleanly
        const offerCard = t.locator(':is([data-testid*="offer" i], [class*="offer" i], div):has-text("RuPay Select Program")').first();
        const removeOfferBtn = t.locator(':is(button, a, span):has-text("Remove offer"), :is(button, a, span):has-text("Remove")').first();
        if (await removeOfferBtn.isVisible().catch(() => false)) {
          console.log('[gateway] Clicking "Remove offer"...');
          await humanClick(removeOfferBtn, { hesitateBeforeMs: 300, pauseAfterMs: 1000 });
        } else if (await offerCard.isVisible().catch(() => false)) {
          console.log('[gateway] Clicking selected offer card to deselect it...');
          await humanClick(offerCard, { hesitateBeforeMs: 300, pauseAfterMs: 1000 });
          await offerCard.evaluate((el: HTMLElement) => el.click()).catch(() => {});
        }

        // 4. Re-click the Pay button without the expired promo offer
        const payBtn = t.locator(':is(button, [role="button"]):has-text("Pay")').first();
        if (await payBtn.isVisible().catch(() => false)) {
          console.log('[gateway] Re-clicking "Pay" without the exceeded promo offer...');
          await humanClick(payBtn, { hesitateBeforeMs: 600, pauseAfterMs: 2500 });
          await payBtn.evaluate((el: HTMLElement) => el.click()).catch(() => {});
        }
        modalHandled = true;
        break;
      }
    }
    if (modalHandled) continue;

    // 3. Primary Autonomous LLM Visual Assessment & Click Action
    if (apiKey) {
      const decision = await askLlmToAdvancePayment(page, apiKey, {
        phoneNumber: options?.phoneNumber,
        email: options?.email,
      });
      if (decision.reachedOtp) {
        console.log('[gateway-llm] ✓ LLM Vision confirmed Bank 3D-Secure OTP screen!');
        return { reachedOtp: true, reachedSuccess: false };
      }
      if (decision.reachedSuccess) {
        console.log('[gateway-llm] ✓ LLM Vision confirmed Order Confirmation!');
        return { reachedOtp: false, reachedSuccess: true };
      }
      if (decision.handled) {
        continue; // Successfully clicked element to dismiss blocker / advance flow
      }
    } else {
      // Fallback only if no Gemini API key configured: external bank ACS domain + OTP field
      const isExternalAcs = !currUrl.includes('juspay.in') && (
        currUrl.includes('acs') ||
        currUrl.includes('bank') ||
        currUrl.includes('cardsecurity') ||
        currUrl.includes('enstage') ||
        currUrl.includes('wibmo')
      );
      const hasOtpField = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        return inputs.some((inp) => {
          const name = (inp.name || '').toLowerCase();
          const id = (inp.id || '').toLowerCase();
          const ph = (inp.placeholder || '').toLowerCase();
          return name.includes('otp') || id.includes('otp') || ph.includes('otp');
        });
      }).catch(() => false);

      if (isExternalAcs && hasOtpField) {
        console.log(`[gateway] ✓ External bank ACS OTP page reached (URL: ${currUrl})`);
        return { reachedOtp: true, reachedSuccess: false };
      }
    }
  }

  console.log('[gateway] Timed out waiting for bank OTP screen.');
  return { reachedOtp: false, reachedSuccess: false, reason: 'Bank OTP screen was not detected within timeout' };
}

/**
 * Validates with Gemini Vision whether the active page is currently displaying
 * an authentic Bank 3D-Secure OTP verification prompt.
 */
export async function verifyBankOtpScreenWithLLM(
  page: Page,
  options?: { maxWaitSec?: number; apiKey?: string },
): Promise<boolean> {
  const maxWaitSec = options?.maxWaitSec ?? 15;
  const apiKey = options?.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    console.warn('[gateway-llm] No GEMINI_API_KEY available for visual OTP verification.');
    return false;
  }

  const deadline = Date.now() + maxWaitSec * 1000;
  while (Date.now() < deadline) {
    try {
      const screenshotBuf = await page.screenshot();
      const analysis = await analyzeGatewayScreenWithLLM(screenshotBuf.toString('base64'), apiKey);
      if (analysis?.state === 'BANK_OTP_SCREEN') {
        console.log(`[gateway-llm] ✓ LLM Vision verified authentic Bank OTP screen: "${analysis.description}"`);
        return true;
      }
      console.log(`[gateway-llm] Screen verification status: [${analysis?.state ?? 'UNKNOWN'}] - ${analysis?.description ?? 'N/A'}`);
    } catch (err) {
      console.warn('[gateway-llm] Visual check error:', err);
    }
    await page.waitForTimeout(2500);
  }

  return false;
}
