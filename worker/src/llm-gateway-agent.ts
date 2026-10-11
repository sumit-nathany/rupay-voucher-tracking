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
  actionType: 'cvv' | 'pay_button' | 'otp_input' | 'otp_submit',
): Promise<CandidateElement[]> {
  const frames = [page, ...page.frames()];
  const allCandidates: CandidateElement[] = [];

  for (let frameIndex = 0; frameIndex < frames.length; frameIndex++) {
    const target = frames[frameIndex];
    const frameUrl = 'url' in target ? target.url() : page.url();

    try {
      const candidates = await target.evaluate((type) => {
        const isVisible = (el: HTMLElement) => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        };

        const results: Array<{
          tag: string;
          type?: string;
          id?: string;
          name?: string;
          placeholder?: string;
          text?: string;
          ariaLabel?: string;
          selector: string;
        }> = [];

        if (type === 'cvv') {
          const inputs = Array.from(document.querySelectorAll('input'));
          for (const el of inputs) {
            if (!isVisible(el)) continue;
            const inputType = el.getAttribute('type') || 'text';
            const name = el.getAttribute('name') || '';
            const id = el.getAttribute('id') || '';
            const placeholder = el.getAttribute('placeholder') || '';
            const maxLen = el.getAttribute('maxlength') || '';
            const labelText = el.closest('label')?.textContent || '';

            const isCvvCandidate =
              /cvv|cvc|security|code|verification/i.test(name) ||
              /cvv|cvc|security|code/i.test(id) ||
              /cvv|cvc/i.test(placeholder) ||
              /cvv|cvc/i.test(labelText) ||
              (maxLen === '3' || maxLen === '4') ||
              (inputType === 'password' && (maxLen === '3' || maxLen === '4' || placeholder.length <= 4));

            if (isCvvCandidate) {
              let sel = '';
              if (id) sel = `#${id}`;
              else if (name) sel = `input[name="${name}"]`;
              else if (placeholder) sel = `input[placeholder="${placeholder}"]`;
              else sel = 'input[type="password"]';

              results.push({
                tag: 'INPUT',
                type: inputType,
                id,
                name,
                placeholder,
                text: labelText.trim(),
                selector: sel,
              });
            }
          }
        } else if (type === 'pay_button') {
          const clickables = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], a.btn'));
          for (const el of clickables) {
            if (!isVisible(el as HTMLElement)) continue;
            const text = el.textContent?.trim() || (el as HTMLInputElement).value || '';
            const id = el.getAttribute('id') || '';
            const isPay =
              /pay|proceed|continue|submit|make\s*payment|₹|inr/i.test(text) ||
              /pay|proceed|submit/i.test(id) ||
              /pay/i.test(el.className);

            if (isPay) {
              let sel = '';
              if (id) sel = `#${id}`;
              else if (text) sel = `${el.tagName.toLowerCase()}:has-text("${text.slice(0, 20)}")`;
              else sel = el.tagName.toLowerCase();

              results.push({
                tag: el.tagName,
                id,
                text,
                selector: sel,
              });
            }
          }
        } else if (type === 'otp_input') {
          const inputs = Array.from(document.querySelectorAll('input'));
          for (const el of inputs) {
            if (!isVisible(el)) continue;
            const inputType = el.getAttribute('type') || 'text';
            const name = el.getAttribute('name') || '';
            const id = el.getAttribute('id') || '';
            const placeholder = el.getAttribute('placeholder') || '';
            const autocomplete = el.getAttribute('autocomplete') || '';

            const isOtp =
              /otp|passcode|code|pin|one\s*time/i.test(name) ||
              /otp|passcode|code|pin/i.test(id) ||
              /otp|passcode|code|pin/i.test(placeholder) ||
              autocomplete.includes('one-time-code') ||
              inputType === 'password';

            if (isOtp) {
              let sel = '';
              if (id) sel = `#${id}`;
              else if (name) sel = `input[name="${name}"]`;
              else if (placeholder) sel = `input[placeholder="${placeholder}"]`;
              else sel = `input[type="${inputType}"]`;

              results.push({
                tag: 'INPUT',
                type: inputType,
                id,
                name,
                placeholder,
                selector: sel,
              });
            }
          }
        } else if (type === 'otp_submit') {
          const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn'));
          for (const el of buttons) {
            if (!isVisible(el as HTMLElement)) continue;
            const text = el.textContent?.trim() || (el as HTMLInputElement).value || '';
            const id = el.getAttribute('id') || '';

            const isSubmit =
              /submit|verify|confirm|proceed|pay|continue/i.test(text) ||
              /submit|verify|confirm/i.test(id);

            if (isSubmit) {
              let sel = '';
              if (id) sel = `#${id}`;
              else if (text) sel = `${el.tagName.toLowerCase()}:has-text("${text.slice(0, 20)}")`;
              else sel = el.tagName.toLowerCase();

              results.push({
                tag: el.tagName,
                id,
                text,
                selector: sel,
              });
            }
          }
        }

        return results;
      }, actionType);

      for (const c of candidates) {
        allCandidates.push({
          ...c,
          frameIndex,
          frameUrl,
        });
      }
    } catch {}
  }

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
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];

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
