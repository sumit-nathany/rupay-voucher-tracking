import { Page, Frame } from 'playwright';
import { humanClick, humanType, humanHesitate, humanDelay } from './human-interaction';
import { getGeminiApiKey } from './llm-gateway-agent';

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

let capSolverDisabled = false;
let capMonsterDisabled = false;
let yesCaptchaDisabled = false;
let azCaptchaDisabled = false;

/**
 * Solves reCAPTCHA v2 using CapSolver API.
 */
/**
 * Solve the CAPTCHA with AZCaptcha.
 *
 * They give $0.10 of free credit once you verify your email — no card — and
 * 1,000 credits is $1, so $0.10 is about 100 reCAPTCHA v2 tokens at their
 * $1.00 per 1,000 rate. Their API is the same shape as 2Captcha's.
 */
export async function solveWithAzCaptcha(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
  userAgent?: string,
): Promise<string | null> {
  if (azCaptchaDisabled) return null;
  console.log('[captcha] Requesting AZCaptcha token for sitekey:', siteKey);
  try {
    const inRes = await fetch('https://azcaptcha.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'NoCaptchaTaskProxyless',
          websiteURL: pageUrl,
          websiteKey: siteKey,
          ...(userAgent ? { userAgent } : {}),
        },
      }),
    });
    const inData = (await inRes.json()) as {
      errorId: number;
      errorCode?: string;
      errorDescription?: string;
      taskId?: number;
    };
    if (inData.errorId !== 0 || !inData.taskId) {
      console.error('[captcha] AZCaptcha task creation error:', inData.errorDescription ?? inData.errorCode);
      const desc = `${inData.errorDescription ?? ''} ${inData.errorCode ?? ''}`.toLowerCase();
      if (desc.includes('key') || desc.includes('denied') || desc.includes('balance') || desc.includes('invalid')) {
        azCaptchaDisabled = true;
      }
      return null;
    }

    const taskId = inData.taskId;
    console.log(`[captcha] AZCaptcha task submitted (ID: ${taskId}). Polling for solution...`);

    // A measured AZCaptcha solve took 66 seconds, so a 60 second window was
    // too tight. 30 x 3s = 90s, which still leaves room inside the token's
    // two-minute lifetime.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const resRes = await fetch('https://azcaptcha.com/getTaskResult', {
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
        console.log('[captcha] AZCaptcha solved successfully!');
        return resData.solution.gRecaptchaResponse;
      }
      if (resData.errorId !== 0 && resData.errorId !== 1) {
        console.error('[captcha] AZCaptcha result error:', resData);
        return null;
      }
    }
  } catch (err) {
    console.error('[captcha] AZCaptcha network error:', err);
  }
  return null;
}

/**
 * Solve the CAPTCHA with YesCaptcha.
 *
 * They give 1,500 points on signup (about 100 reCAPTCHA v2 tokens, claimed
 * by asking their support), and 1,000 points is ¥1, so a v2 token costs
 * ¥0.015. The API is the same shape as 2Captcha's.
 */
export async function solveWithYesCaptcha(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
  userAgent?: string,
): Promise<string | null> {
  if (yesCaptchaDisabled) return null;
  console.log('[captcha] Requesting YesCaptcha token for sitekey:', siteKey);
  try {
    const inRes = await fetch('https://api.yescaptcha.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'NoCaptchaTaskProxyless',
          websiteURL: pageUrl,
          websiteKey: siteKey,
          ...(userAgent ? { userAgent } : {}),
        },
      }),
    });
    const inData = (await inRes.json()) as {
      errorId: number;
      errorCode?: string;
      errorDescription?: string;
      taskId?: number;
    };
    if (inData.errorId !== 0 || !inData.taskId) {
      console.error('[captcha] YesCaptcha task creation error:', inData.errorDescription);
      const desc = inData.errorDescription?.toLowerCase() ?? '';
      if (desc.includes('invalid') || desc.includes('denied') || desc.includes('balance') || desc.includes('key')) {
        yesCaptchaDisabled = true;
      }
      return null;
    }

    const taskId = inData.taskId;
    console.log(`[captcha] YesCaptcha task submitted (ID: ${taskId}). Polling for solution...`);

    // A measured AZCaptcha solve took 66 seconds, so a 60 second window was
    // too tight. 30 x 3s = 90s, which still leaves room inside the token's
    // two-minute lifetime.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const resRes = await fetch('https://api.yescaptcha.com/getTaskResult', {
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
        console.log('[captcha] YesCaptcha solved successfully!');
        return resData.solution.gRecaptchaResponse;
      }
      if (resData.errorId !== 0 && resData.errorId !== 1) {
        console.error('[captcha] YesCaptcha result error:', resData);
        return null;
      }
    }
  } catch (err) {
    console.error('[captcha] YesCaptcha network error:', err);
  }
  return null;
}

/**
 * Solve the CAPTCHA with CapMonster.
 *
 * CapMonster is the cheapest of the three token services at $0.60 per 1,000
 * solves, with the proxy included in that price, and it has the simplest
 * request shape of the three.
 *
 * The API is the same idea as the others: create a task, poll for the
 * result. The response is capped at a couple of minutes by the service, and
 * the token is valid for two minutes once issued, so the polling window and
 * the token's lifetime are the same order — we take the token as soon as it
 * is ready.
 */
export async function solveWithCapMonster(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
  userAgent?: string,
): Promise<string | null> {
  if (capMonsterDisabled) return null;
  console.log('[captcha] Requesting CapMonster token for sitekey:', siteKey);
  try {
    const inRes = await fetch('https://api.capmonster.cloud/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'RecaptchaV2Task',
          websiteURL: pageUrl,
          websiteKey: siteKey,
          ...(userAgent ? { userAgent } : {}),
        },
      }),
    });
    const inData = (await inRes.json()) as {
      errorId: number;
      errorCode?: string;
      errorDescription?: string;
      taskId?: number;
    };
    if (inData.errorId !== 0 || !inData.taskId) {
      console.error('[captcha] CapMonster task creation error:', inData.errorDescription);
      if (
        inData.errorDescription?.toLowerCase().includes('invalid') ||
        inData.errorDescription?.toLowerCase().includes('insufficient') ||
        inData.errorDescription?.toLowerCase().includes('denied') ||
        inData.errorDescription?.toLowerCase().includes('balance')
      ) {
        capMonsterDisabled = true;
      }
      return null;
    }

    const taskId = inData.taskId;
    console.log(`[captcha] CapMonster task submitted (ID: ${taskId}). Polling for solution...`);

    // A measured AZCaptcha solve took 66 seconds, so a 60 second window was
    // too tight. 30 x 3s = 90s, which still leaves room inside the token's
    // two-minute lifetime.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const resRes = await fetch('https://api.capmonster.cloud/getTaskResult', {
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
        console.log('[captcha] CapMonster solved successfully!');
        return resData.solution.gRecaptchaResponse;
      }
      if (resData.errorId !== 0 && resData.errorId !== 1) {
        console.error('[captcha] CapMonster result error:', resData);
        return null;
      }
    }
  } catch (err) {
    console.error('[captcha] CapMonster network error:', err);
  }
  return null;
}

export async function solveWithCapSolver(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
): Promise<string | null> {
  if (capSolverDisabled) return null;
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
      if (inData.errorDescription?.includes('invalid') || inData.errorDescription?.includes('insufficient') || inData.errorDescription?.includes('denied')) {
        capSolverDisabled = true;
      }
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
 * Solves reCAPTCHA v2 using NopeCHA Token API.
 */
export async function solveWithNopeCHA(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
): Promise<string | null> {
  console.log('[captcha] Requesting NopeCHA token for sitekey:', siteKey);
  try {
    const res = await fetch('https://api.nopecha.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: apiKey,
        type: 'recaptcha2',
        sitekey: siteKey,
        url: pageUrl,
      }),
    });
    const data = (await res.json()) as { data?: string; error?: number; message?: string };
    if (!data.data) {
      console.warn('[captcha] NopeCHA job submission error:', data.message || data.error);
      return null;
    }

    const jobId = data.data;
    console.log(`[captcha] NopeCHA task submitted (ID: ${jobId}). Polling for solution...`);

    // Poll every 2s for up to 60s
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const pollRes = await fetch(
        `https://api.nopecha.com/token?key=${encodeURIComponent(apiKey)}&id=${encodeURIComponent(jobId)}`,
      );
      const pollData = (await pollRes.json()) as { data?: string; error?: number; message?: string };
      if (pollData.data && typeof pollData.data === 'string' && pollData.data.length > 30) {
        console.log('[captcha] NopeCHA solved successfully!');
        return pollData.data;
      }
    }
  } catch (err) {
    console.error('[captcha] NopeCHA network error:', err);
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
  const models = ['gemini-3.5-transcribe', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'];
  const base64Audio = audioBuffer.toString('base64');

  for (const model of models) {
    try {
      console.log(`[captcha] Transcribing reCAPTCHA audio using Gemini multimodal (${model})...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: 'You are an accurate audio transcription system for a reCAPTCHA audio challenge. Transcribe the spoken numbers or words in this audio challenge completely from start to finish. Output ONLY the transcribed numbers or words separated by single spaces (e.g. "4 8 2 1 9" or "word word"). Do not add any punctuation, quotes, markdown, or explanatory text.',
                },
                {
                  inlineData: {
                    mimeType: 'audio/mp3',
                    data: base64Audio,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: 100,
            temperature: 0.1,
          },
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[captcha] Gemini model ${model} responded with ${res.status}: ${errText.slice(0, 150)}`);
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
 * Attempts to solve reCAPTCHA via browser audio capture / playback without external downloads.
 */
export async function solveRecaptchaViaAudio(
  page: Page,
  geminiApiKey: string,
): Promise<boolean> {
  console.log('[captcha] Attempting non-intrusive reCAPTCHA Audio capture...');
  let latestCapturedAudio: Buffer | null = null;

  // 1. Passively capture audio payloads from the browser's own network stream
  const responseHandler = async (response: any) => {
    try {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';
      if (
        contentType.includes('audio') ||
        url.includes('audio.mp3') ||
        url.includes('/payload?pk=') ||
        url.includes('/recaptcha/api2/payload')
      ) {
        const body = await response.body().catch(() => null);
        if (body && body.length > 500) {
          latestCapturedAudio = body;
          console.log(`[captcha] Passively intercepted audio payload from browser network (${body.length} bytes).`);
        }
      }
    } catch {}
  };

  page.on('response', responseHandler);

  try {
    // 2. Locate the bframe (challenge popup iframe)
    let bframe = page.frames().find((f) => f.url().includes('recaptcha/api2/bframe'));
    if (!bframe) {
      for (let i = 0; i < 6; i++) {
        await page.waitForTimeout(500);
        bframe = page.frames().find((f) => f.url().includes('recaptcha/api2/bframe'));
        if (bframe) break;
      }
    }
    if (!bframe) {
      console.log('[captcha] Challenge bframe not found.');
      return false;
    }

    // 3. Switch to audio mode if not already active
    const audioBtn = bframe.locator('#recaptcha-audio-button, button#recaptcha-audio-button').first();
    if (await audioBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await humanClick(audioBtn, { hesitateBeforeMs: 400, pauseAfterMs: 1200 });
      await humanDelay(1500, 2500);
    }

    const maxRounds = 5;

    for (let round = 1; round <= maxRounds; round++) {
      if (page.isClosed()) return false;

      // Stop if already authenticated
      const cookies = await page.context().cookies().catch(() => []);
      if (cookies.some((c) => c.name === 'jwt')) {
        console.log('[captcha] Active JWT session cookie detected. Stopping audio solver.');
        return true;
      }

      const hasLoginOrCaptcha = await page.evaluate(() => {
        const emailInput = document.querySelector('input[type="email"], input[type="password"]');
        const bframe = document.querySelector('iframe[src*="recaptcha"]');
        return Boolean(emailInput || bframe);
      }).catch(() => false);

      if (!hasLoginOrCaptcha) {
        console.log('[captcha] Login form / reCAPTCHA iframe no longer present on page.');
        return true;
      }

      console.log(`[captcha] Audio challenge round ${round} of ${maxRounds}...`);

      // Check if already solved
      const isSolved = await page.evaluate(() => {
        const textarea = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
        return Boolean(textarea && textarea.value.length > 0);
      }).catch(() => false);
      if (isSolved) {
        console.log(`[captcha] ✓ reCAPTCHA solved after round ${round - 1}!`);
        return true;
      }

      // Check if Google blocked audio queries ("Your computer or network may be sending automated queries")
      const blockedMsg = await bframe.locator('.rc-dostitle, .rc-audiochallenge-error-message, div:has-text("automated queries")').first().textContent().catch(() => '');
      if (blockedMsg?.includes('automated queries')) {
        console.warn('[captcha] Google blocked audio challenge:', blockedMsg.trim());
        const imageBtn = bframe.locator('#recaptcha-image-button, button#recaptcha-image-button').first();
        if (await imageBtn.isVisible().catch(() => false)) {
          await humanClick(imageBtn, { hesitateBeforeMs: 300, pauseAfterMs: 600 }).catch(() => {});
        }
        console.log('👉 Google blocked audio endpoint; switched back to visual puzzle. Standing by for manual or external visual puzzle resolution...');
        return false;
      }

      // Reset captured audio for this round
      latestCapturedAudio = null;

      // 4. Trigger audio playback inside browser (clicking PLAY button naturally)
      const playBtn = bframe.locator('button:has-text("PLAY"), .rc-audiochallenge-play-button, button.rc-button-audio').first();
      if (await playBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await humanClick(playBtn, { hesitateBeforeMs: 300, pauseAfterMs: 600 });
      } else {
        // Alternatively trigger playback on in-page audio element
        await bframe.evaluate(() => {
          const audio = document.querySelector('audio#player, audio[src]') as HTMLAudioElement | null;
          if (audio) audio.play().catch(() => {});
        }).catch(() => {});
      }

      // Wait up to 5 seconds for the browser's audio stream to be captured
      for (let w = 0; w < 10; w++) {
        if (latestCapturedAudio) break;
        await page.waitForTimeout(500);
      }

      // 5. Fallback: If not intercepted via network listener, read buffer in-page via window.fetch
      if (!latestCapturedAudio) {
        const base64Audio = await bframe.evaluate(async () => {
          try {
            const audioEl = document.querySelector('audio#player, audio[src], source[src]') as HTMLAudioElement | HTMLSourceElement | null;
            const url = (audioEl as HTMLAudioElement)?.src || audioEl?.getAttribute('src');
            if (!url) return null;
            const res = await window.fetch(url, { credentials: 'include' });
            const blob = await res.blob();
            return await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(((reader.result as string) || '').split(',')[1] || '');
              reader.readAsDataURL(blob);
            });
          } catch {
            return null;
          }
        }).catch(() => null);

        if (base64Audio) {
          latestCapturedAudio = Buffer.from(base64Audio, 'base64');
          console.log(`[captcha] Retrieved audio payload via in-page browser fetch (${latestCapturedAudio.length} bytes).`);
        }
      }

      if (!latestCapturedAudio) {
        console.warn(`[captcha] Could not capture browser audio in round ${round}.`);
        return false;
      }

      // 6. Transcribe audio with Gemini
      console.log(`[captcha] Transcribing browser audio with Gemini...`);
      const transcription = await transcribeAudioWithGemini(latestCapturedAudio, geminiApiKey);
      if (!transcription) {
        console.warn(`[captcha] Transcription failed in round ${round}.`);
        const reloadBtn = bframe.locator('#recaptcha-reload-button').first();
        if (await reloadBtn.isVisible().catch(() => false)) {
          await humanClick(reloadBtn, { hesitateBeforeMs: 300, pauseAfterMs: 1000 });
        }
        continue;
      }

      // 7. Enter transcription into input naturally
      const cleanTranscription = transcription.replace(/["'\.,;]/g, '').trim();
      console.log(`[captcha] Entering transcription: "${cleanTranscription}"`);
      const responseInput = bframe.locator('#audio-response').first();
      await responseInput.fill('');
      await humanType(responseInput, cleanTranscription, { minCharDelayMs: 80, maxCharDelayMs: 160 });
      await humanHesitate(400, 800);

      // 8. Click verify
      const verifyBtn = bframe.locator('#recaptcha-verify-button').first();
      await humanClick(verifyBtn, { hesitateBeforeMs: 400, pauseAfterMs: 1500 });
      await humanDelay(1500, 2500);

      const checkSolved = await page.evaluate(() => {
        const textarea = document.querySelector('textarea#g-recaptcha-response') as HTMLTextAreaElement | null;
        return Boolean(textarea && textarea.value.length > 0);
      });
      if (checkSolved) {
        console.log(`[captcha] ✓ reCAPTCHA successfully solved in round ${round}!`);
        return true;
      }

      const feedback = await bframe.locator('.rc-audiochallenge-error-message').first().textContent().catch(() => '');
      if (feedback) {
        console.log(`[captcha] reCAPTCHA feedback after round ${round}: "${feedback.trim()}"`);
      }
    }

    return false;
  } catch (err) {
    console.error('[captcha] Audio challenge capture error:', err);
    return false;
  } finally {
    page.off('response', responseHandler);
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

  // 3. Strategy 1: CapMonster API
  //
  // The cheapest of the three by a distance — $0.60 per 1,000 with the
  // proxy included in the price — and it has the simplest shape.
  const capMonsterKey = process.env.CAPMONSTER_API_KEY;
  if (capMonsterKey && siteKey) {
    console.log('[captcha] Using CapMonster service...');
    const token = await solveWithCapMonster(
      capMonsterKey,
      siteKey,
      pageUrl,
      await page.evaluate(() => navigator.userAgent).catch(() => undefined),
    );
    if (token) {
      await injectRecaptchaToken(page, token);
      return true;
    }
  }

  // 4. Strategy 2: YesCaptcha — 1,500 free points on signup, about 100
  //    v2 tokens, claimed by asking their support.
  const yesCaptchaKey = process.env.YESCAPTCHA_API_KEY;
  if (yesCaptchaKey && siteKey) {
    console.log('[captcha] Using YesCaptcha service...');
    const token = await solveWithYesCaptcha(
      yesCaptchaKey,
      siteKey,
      pageUrl,
      await page.evaluate(() => navigator.userAgent).catch(() => undefined),
    );
    if (token) {
      await injectRecaptchaToken(page, token);
      return true;
    }
  }

  // 5. Strategy 3: AZCaptcha — $0.10 of free credit once you verify your
  //    email, no card needed.
  const azCaptchaKey = process.env.AZCAPTCHA_API_KEY;
  if (azCaptchaKey && siteKey) {
    console.log('[captcha] Using AZCaptcha service...');
    const token = await solveWithAzCaptcha(
      azCaptchaKey,
      siteKey,
      pageUrl,
      await page.evaluate(() => navigator.userAgent).catch(() => undefined),
    );
    if (token) {
      await injectRecaptchaToken(page, token);
      return true;
    }
  }

  // 6. Strategy 4: CapSolver API
  const capSolverKey = process.env.CAPSOLVER_API_KEY;
  if (capSolverKey && siteKey) {
    console.log('[captcha] Using CapSolver service...');
    const token = await solveWithCapSolver(capSolverKey, siteKey, pageUrl);
    if (token) {
      await injectRecaptchaToken(page, token);
      return true;
    }
  }

  // 7. Strategy 5: NopeCHA Token API
  const nopechaKey = process.env.NOPECHA_API_KEY;
  if (nopechaKey && siteKey) {
    console.log('[captcha] Using NopeCHA Token service...');
    const token = await solveWithNopeCHA(nopechaKey, siteKey, pageUrl);
    if (token) {
      await injectRecaptchaToken(page, token);
      return true;
    }
  }

  // 8. Strategy 6: 2Captcha API
  const twoCaptchaKey = process.env.TWOCAPTCHA_API_KEY;
  if (twoCaptchaKey && siteKey) {
    console.log('[captcha] Using 2Captcha service...');
    const token = await solveWith2Captcha(twoCaptchaKey, siteKey, pageUrl);
    if (token) {
      await injectRecaptchaToken(page, token);
      return true;
    }
  }

  // 9. Strategy C: Browser Audio Capture & Gemini Transcription (Zero external downloads)
  const geminiApiKey = getGeminiApiKey();
  if (geminiApiKey) {
    console.log('[captcha] Attempting in-browser audio capture & Gemini transcription...');
    const solved = await solveRecaptchaViaAudio(page, geminiApiKey);
    if (solved) return true;
  }

  console.log('[captcha] Standing by for manual or external visual puzzle completion in browser...');
  console.log('👉 Please solve the visual puzzle in the Chrome window — the automation will automatically resume as soon as it is verified.');
  return false;
}

// ── Preflight ───────────────────────────────────────────────────────────────

export interface SolverBackendStatus {
  service: 'capmonster' | 'yescaptcha' | 'azcaptcha' | 'capsolver' | '2captcha' | 'nopecha';
  configured: boolean;
  /** null = not configured, so not checked. false = configured but rejected. */
  usable: boolean | null;
  detail?: string;
}

/**
 * Checks that each configured solving service actually accepts its key.
 *
 * A rejected key is the single most common cause of a failed unattended run,
 * and it is invisible until the runner has already opened a browser, waited
 * out a challenge and burned several minutes per account. Checking the
 * credentials up front turns that into a one-line error.
 *
 * Only the account balance endpoint is called — no CAPTCHA is solved.
 */
export async function checkSolverBackends(): Promise<SolverBackendStatus[]> {
  const results: SolverBackendStatus[] = [];

  const capMonsterKey = process.env.CAPMONSTER_API_KEY;
  results.push({ service: 'capmonster', configured: Boolean(capMonsterKey), usable: null });
  if (capMonsterKey) {
    try {
      const res = await fetch('https://api.capmonster.cloud/getBalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: capMonsterKey }),
      });
      const json = (await res.json()) as { errorId?: number; errorCode?: string; errorDescription?: string; balance?: number };
      const ok = json.errorId === 0;
      results[results.length - 1] = {
        service: 'capmonster',
        configured: true,
        usable: ok,
        detail: ok ? `balance $${json.balance}` : `${json.errorCode ?? 'error'}: ${json.errorDescription ?? 'rejected'}`,
      };
    } catch (err) {
      results[results.length - 1] = {
        service: 'capmonster',
        configured: true,
        usable: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const yesKey = process.env.YESCAPTCHA_API_KEY;
  results.push({ service: 'yescaptcha', configured: Boolean(yesKey), usable: null });
  if (yesKey) {
    try {
      const res = await fetch('https://api.yescaptcha.com/getBalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: yesKey }),
      });
      const json = (await res.json()) as { errorId?: number; errorCode?: string; errorDescription?: string; balance?: number };
      const ok = json.errorId === 0;
      results[results.length - 1] = {
        service: 'yescaptcha',
        configured: true,
        usable: ok,
        detail: ok ? `balance ${json.balance} points` : `${json.errorCode ?? 'error'}: ${json.errorDescription ?? 'rejected'}`,
      };
    } catch (err) {
      results[results.length - 1] = {
        service: 'yescaptcha',
        configured: true,
        usable: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const azKey = process.env.AZCAPTCHA_API_KEY;
  results.push({ service: 'azcaptcha', configured: Boolean(azKey), usable: null });
  if (azKey) {
    try {
      const res = await fetch('https://azcaptcha.com/getBalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: azKey }),
      });
      const json = (await res.json()) as { errorId?: number; errorCode?: string; errorDescription?: string; balance?: number };
      const ok = json.errorId === 0;
      results[results.length - 1] = {
        service: 'azcaptcha',
        configured: true,
        usable: ok,
        detail: ok ? `balance $${json.balance}` : `${json.errorCode ?? 'error'}: ${json.errorDescription ?? 'rejected'}`,
      };
    } catch (err) {
      results[results.length - 1] = {
        service: 'azcaptcha',
        configured: true,
        usable: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const capKey = process.env.CAPSOLVER_API_KEY;
  results.push({ service: 'capsolver', configured: Boolean(capKey), usable: null });
  if (capKey) {
    try {
      const res = await fetch('https://api.capsolver.com/getBalance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: capKey }),
      });
      const json = (await res.json()) as { errorId?: number; errorCode?: string; errorDescription?: string; balance?: number };
      const ok = json.errorId === 0;
      results[results.length - 1] = {
        service: 'capsolver',
        configured: true,
        usable: ok,
        detail: ok ? `balance ${json.balance}` : `${json.errorCode ?? 'error'}: ${json.errorDescription ?? 'rejected'}`,
      };
    } catch (err) {
      results[results.length - 1] = {
        service: 'capsolver',
        configured: true,
        usable: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const twoKey = process.env.TWOCAPTCHA_API_KEY;
  results.push({ service: '2captcha', configured: Boolean(twoKey), usable: null });
  if (twoKey) {
    try {
      const res = await fetch(
        `https://api.2captcha.com/getbalance?key=${encodeURIComponent(twoKey)}`,
      );
      const body = (await res.text()).trim();
      const ok = /^[0-9.]+$/.test(body);
      results[results.length - 1] = {
        service: '2captcha',
        configured: true,
        usable: ok,
        detail: ok ? `balance ${body}` : body.slice(0, 120),
      };
    } catch (err) {
      results[results.length - 1] = {
        service: '2captcha',
        configured: true,
        usable: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const nopeKey = process.env.NOPECHA_API_KEY;
  results.push({ service: 'nopecha', configured: Boolean(nopeKey), usable: null });
  if (nopeKey) {
    try {
      const res = await fetch(
        `https://api.nopecha.com/getBalance?key=${encodeURIComponent(nopeKey)}`,
      );
      const body = (await res.text()).trim();
      const ok = /^[0-9.]+$/.test(body);
      results[results.length - 1] = {
        service: 'nopecha',
        configured: true,
        usable: ok,
        detail: ok ? `balance ${body}` : body.slice(0, 120),
      };
    } catch (err) {
      results[results.length - 1] = {
        service: 'nopecha',
        configured: true,
        usable: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return results;
}
