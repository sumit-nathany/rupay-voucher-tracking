/**
 * Client for the reCAPTCHA solving service.
 *
 * This is a *separate* path from `captcha-solver.ts`, which stays exactly as
 * it is. When `CAPTCHA_SERVICE_URL` is set, the worker asks the service to
 * solve the challenge; when it is not, the existing local solver runs.
 *
 * The service is a Cloud Run service in the same project, so it can be
 * called with an identity token. The shared secret is sent as well, because
 * the service checks both.
 */

/** Where the solving service lives. Unset means "do not use it". */
export const CAPTCHA_SERVICE_URL = process.env.CAPTCHA_SERVICE_URL || '';

/** The shared secret the service expects in `X-Solver-Key`. */
export const CAPTCHA_SERVICE_KEY = process.env.CAPTCHA_SERVICE_KEY || '';

/** How long to wait for a solve. A cold instance can take a while. */
const SOLVE_TIMEOUT_MS = Number(process.env.CAPTCHA_SERVICE_TIMEOUT_MS || 180_000);

export interface SolverServiceResult {
  solved: boolean;
  token: string | null;
  elapsedMs: number;
  /** "one-click" when the checkbox was accepted outright, "ia-solver" otherwise. */
  method: string;
  detail: string | null;
}

/** Fetch a Google Cloud ID token, when running on Cloud Run. */
async function getIdentityToken(): Promise<string | null> {
  const metadata = process.env.GCE_METADATA_HOST || 'metadata.google.internal';
  try {
    const res = await fetch(
      `http://${metadata}/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(
        process.env.CAPTCHA_SERVICE_URL || '',
      )}&format=full`,
      { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    return (await res.text()).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Ask the service to solve the reCAPTCHA on a page.
 *
 * @param pageUrl The page carrying the challenge.
 * @param loginButton Text of a button to click first, e.g. "Login".
 */
export async function solveViaService(
  pageUrl: string,
  loginButton?: string,
): Promise<SolverServiceResult> {
  if (!CAPTCHA_SERVICE_URL) {
    throw new Error('CAPTCHA_SERVICE_URL is not set');
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (CAPTCHA_SERVICE_KEY) headers['x-solver-key'] = CAPTCHA_SERVICE_KEY;

  // On Cloud Run the service is private, so it wants an identity token.
  const identity = await getIdentityToken();
  if (identity) headers.authorization = `Bearer ${identity}`;

  const res = await fetch(`${CAPTCHA_SERVICE_URL.replace(/\/+$/, '')}/v1/solve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ pageUrl, loginButton }),
    signal: AbortSignal.timeout(SOLVE_TIMEOUT_MS),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`solver service returned ${res.status}: ${text.slice(0, 300)}`);
  }

  const body = JSON.parse(text) as SolverServiceResult;
  if (!body.solved || !body.token) {
    throw new Error(`solver service did not solve the challenge: ${body.detail || 'unknown reason'}`);
  }
  return body;
}

/** Is the service configured and reachable? */
export async function isSolverServiceConfigured(): Promise<boolean> {
  if (!CAPTCHA_SERVICE_URL) return false;
  try {
    const res = await fetch(`${CAPTCHA_SERVICE_URL.replace(/\/+$/, '')}/v1/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
