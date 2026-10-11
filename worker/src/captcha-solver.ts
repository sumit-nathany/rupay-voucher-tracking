import { Page, Frame } from 'playwright';
import { humanClick, humanType, humanHesitate, humanDelay } from './human-interaction';

/**
 * Solves reCAPTCHA v2 using 2Captcha API.
 */
export async function solveWith2Captcha(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
): Promise<string | null> {
  console.log('[captcha] Requesting 2Captcha token for sitekey:', siteKey);
  try {
    const inRes = await fetch(
      `https://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${siteKey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`,
    );
    const inData = (await inRes.json()) as { status: number; request: string };
    if (inData.status !== 1) {
      console.error('[captcha] 2Captcha error submitting task:', inData.request);
      return null;
    }

    const requestId = inData.request;
    console.log(`[captcha] 2Captcha task submitted (ID: ${requestId}). Polling for solution...`);

    // Poll every 5s for up to 90s
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const resRes = await fetch(
        `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${requestId}&json=1`,
      );
      const resData = (await resRes.json()) as { status: number; request: string };
      if (resData.status === 1) {
        console.log('[captcha] 2Captcha solved successfully!');
        return resData.request;
      }
      if (resData.request !== 'CAPCHA_NOT_READY') {
        console.error('[captcha] 2Captcha polling error:', resData.request);
        return null;
      }
    }
  } catch (err) {
    console.error('[captcha] 2Captcha network error:', err);
  }
  return null;
}

/**
 * Solves reCAPTCHA v2 using CapSolver API.
 */
export async function solveWithCapSolver(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
): Promise<string | null> {
  console.log('[captcha] Requesting CapSolver token for sitekey:', siteKey);
  try {
    const inRes = await fetch('https://api.capsolver.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'ReCaptchaV2TaskProxyLess',
          websiteURL: pageUrl,
          websiteKey: siteKey,
        },
      }),
    });
    const inData = (await inRes.json()) as { errorId: number; taskId?: string; errorDescription?: string };
    if (inData.errorId !== 0 || !inData.taskId) {
      console.error('[captcha] CapSolver task creation error:', inData.errorDescription);
      return null;
    }

    const taskId = inData.taskId;
    console.log(`[captcha] CapSolver task submitted (ID: ${taskId}). Polling for solution...`);

    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const resRes = await fetch('https://api.capsolver.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId }),
      });
      const resData = (await resRes.json()) as {
        errorId: number;
        status: string;
        solution?: { gRecaptchaResponse?: string };
      };
      if (resData.status === 'ready' && resData.solution?.gRecaptchaResponse) {
        console.log('[captcha] CapSolver solved successfully!');
        return resData.solution.gRecaptchaResponse;
      }
    }
  } catch (err) {
    console.error('[captcha] CapSolver network error:', err);
  }
  return null;
}

/**
 * Transcribes an audio buffer using Gemini multimodal API.
 */
export async function transcribeAudioWithGemini(
  audioBuffer: Buffer,
  apiKey: string,
): Promise<string | null> {
  const models = ['gemini-2.5-flash', 'gemini-1.5-flash'];
  const base64Audio = audioBuffer.toString('base64');

  for (const model of models) {
    try {
      console.log(`[captcha] Transcribing reCAPTCHA audio using Gemini multimodal (${model})...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'Listen to this audio challenge carefully. Transcribe ONLY the numbers or words spoken. Return just the plain transcribed text and nothing else.',
                },
                {
                  inline_data: {
                    mime_type: 'audio/mp3',
                    data: base64Audio,
                  },
                },
              ],
            },
          ],
        }),
      });

      if (!res.ok) {
        console.warn(`[captcha] Gemini model ${model} responded with ${res.status}: ${res.statusText}`);
        continue;
      }

      const json = (await res.json()) as any;
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) {
        console.log(`[captcha] Gemini transcription result: "${text}"`);
        return text;
      }
    } catch (err) {
      console.error(`[captcha] Gemini transcription error with ${model}:`, err);
    }
  }
  return null;
}

/**
 * Injects a solved g-recaptcha-response token into the page and fires the verification callback.
 */
export async function injectRecaptchaToken(page: Page, token: string): Promise<boolean> {
  return await page.evaluate((sol) => {
    const textarea = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.value = sol;
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Try finding and invoking the client-side reCAPTCHA callback
    const anyWin = window as any;
    if (typeof anyWin.___grecaptcha_cfg !== 'undefined') {
      const clients = anyWin.___grecaptcha_cfg.clients;
      if (clients) {
        for (const cid of Object.keys(clients)) {
          const client = clients[cid];
          for (const key of Object.keys(client)) {
            const val = client[key];
            if (val && typeof val === 'object' && typeof val.callback === 'function') {
              val.callback(sol);
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
 * Attempts to solve reCAPTCHA via the audio challenge bypass.
 */
export async function solveRecaptchaViaAudio(
  page: Page,
  geminiApiKey: string,
): Promise<boolean> {
  console.log('[captcha] Attempting reCAPTCHA Audio Challenge bypass...');
  try {
    // 1. Locate the bframe (challenge popup iframe)
    const bframe = page.frames().find((f) => f.url().includes('recaptcha/api2/bframe'));
    if (!bframe) {
      console.log('[captcha] Challenge bframe not found.');
      return false;
    }

    // 2. Click the audio challenge button
    const audioBtn = bframe.locator('#recaptcha-audio-button, button#recaptcha-audio-button').first();
    if (await audioBtn.isVisible({ timeout: 2000 })) {
      await humanClick(audioBtn, { hesitateBeforeMs: 400, pauseAfterMs: 1200 });
    }

    await humanDelay(1500, 2500);

    // Check if Google blocked audio queries ("Your computer or network may be sending automated queries")
    const blockedMsg = await bframe.locator('.rc-d mosaic-warning, .rc-audiochallenge-error-message').first().textContent().catch(() => '');
    if (blockedMsg?.includes('automated queries')) {
      console.warn('[captcha] Google blocked audio challenge:', blockedMsg.trim());
      return false;
    }

    // 3. Obtain audio download link
    const downloadLink = bframe.locator('.rc-audiochallenge-tdownload-link').first();
    let audioUrl = await downloadLink.getAttribute('href').catch(() => null);
    if (!audioUrl) {
      const audioElement = bframe.locator('audio#player, audio[src]').first();
      audioUrl = await audioElement.getAttribute('src').catch(() => null);
    }

    if (!audioUrl) {
      console.warn('[captcha] Could not retrieve audio challenge URL.');
      return false;
    }

    console.log('[captcha] Downloading audio challenge file...');
    const audioRes = await fetch(audioUrl);
    const audioBuf = Buffer.from(await audioRes.arrayBuffer());

    // 4. Transcribe audio
    const transcription = await transcribeAudioWithGemini(audioBuf, geminiApiKey);
    if (!transcription) return false;

    // 5. Enter transcription into input
    const responseInput = bframe.locator('#audio-response').first();
    await humanType(responseInput, transcription, { minCharDelayMs: 90, maxCharDelayMs: 180 });
    await humanHesitate(400, 800);

    // 6. Click verify
    const verifyBtn = bframe.locator('#recaptcha-verify-button').first();
    await humanClick(verifyBtn, { hesitateBeforeMs: 400, pauseAfterMs: 1500 });

    await page.waitForTimeout(1500);

    const isSolved = await page.evaluate(() => {
      const textarea = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
      return Boolean(textarea && textarea.value.length > 0);
    });

    return isSolved;
  } catch (err) {
    console.error('[captcha] Audio challenge bypass error:', err);
    return false;
  }
}

/**
 * Main reCAPTCHA Orchestrator:
 * 1. Locates the anchor iframe and clicks the checkbox naturally.
 * 2. If it immediately passes (green checkmark), returns true.
 * 3. If a challenge is presented:
 *    - Uses 2Captcha / CapSolver if API key is in environment.
 *    - Uses Audio Challenge + Gemini if GEMINI_API_KEY is present.
 *    - Otherwise logs clearly and monitors for human/manual click.
 */
export async function autoSolveRecaptcha(page: Page): Promise<boolean> {
  const isAlreadySolved = await page.evaluate(() => {
    const textarea = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
    return Boolean(textarea && textarea.value.length > 0);
  });
  if (isAlreadySolved) return true;

  console.log('[captcha] Inspecting reCAPTCHA on page...');

  // 1. Find anchor iframe
  let anchorFrame = page.frames().find((f) => f.url().includes('recaptcha/api2/anchor'));
  if (!anchorFrame) {
    try {
      await page.waitForSelector('iframe[src*="recaptcha/api2/anchor"]', { timeout: 3500 });
      anchorFrame = page.frames().find((f) => f.url().includes('recaptcha/api2/anchor'));
    } catch {}
  }

  if (anchorFrame) {
    const checkbox = anchorFrame.locator('.recaptcha-checkbox, #recaptcha-anchor').first();
    if (await checkbox.isVisible({ timeout: 2000 })) {
      console.log('[captcha] Clicking reCAPTCHA checkbox naturally...');
      await humanClick(checkbox, { hesitateBeforeMs: 400, pauseAfterMs: 1500 });
    }
  }

  await humanDelay(1500, 2500);

  // Check if anchor immediately passed (1-click solve)
  const passedImmediately = await page.evaluate(() => {
    const textarea = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
    return Boolean(textarea && textarea.value.length > 0);
  });
  if (passedImmediately) {
    console.log('✓ reCAPTCHA passed immediately (1-click green checkmark)!');
    return true;
  }

  // 2. Extract sitekey if needed for API solvers
  const siteKey = await page.evaluate(() => {
    const el = document.querySelector('[data-sitekey]') as HTMLElement | null;
    if (el) return el.getAttribute('data-sitekey');
    const iframe = document.querySelector('iframe[src*="google.com/recaptcha"]') as HTMLIFrameElement | null;
    if (iframe?.src) {
      const match = iframe.src.match(/[?&]k=([^&]+)/);
      if (match) return match[1];
    }
    return null;
  });

  const pageUrl = page.url();

  // 3. Strategy A: 2Captcha API
  const twoCaptchaKey = process.env.TWOCAPTCHA_API_KEY;
  if (twoCaptchaKey && siteKey) {
    console.log('[captcha] Using 2Captcha service...');
    const token = await solveWith2Captcha(twoCaptchaKey, siteKey, pageUrl);
    if (token) {
      await injectRecaptchaToken(page, token);
      return true;
    }
  }

  // 4. Strategy B: CapSolver API
  const capSolverKey = process.env.CAPSOLVER_API_KEY;
  if (capSolverKey && siteKey) {
    console.log('[captcha] Using CapSolver service...');
    const token = await solveWithCapSolver(capSolverKey, siteKey, pageUrl);
    if (token) {
      await injectRecaptchaToken(page, token);
      return true;
    }
  }

  // 5. Strategy C: Audio Challenge with Gemini
  const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (geminiApiKey) {
    console.log('[captcha] Using Audio Challenge bypass with Gemini multimodal...');
    const solved = await solveRecaptchaViaAudio(page, geminiApiKey);
    if (solved) return true;
  }

  console.log('[captcha] Automated solver strategies completed. Standing by for challenge completion...');
  return false;
}
