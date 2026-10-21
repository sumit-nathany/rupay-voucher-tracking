/**
 * Log redaction for the ordering worker.
 *
 * The worker drives a real browser against a live banking portal, so its
 * logs can contain anything the portal page, its network responses, or the
 * portal's own console output happen to contain. The product rules are
 * explicit that portal credentials, JWTs, cookies, session IDs, OTPs, raw
 * portal payloads, voucher codes and booking IDs must never be written to
 * logs (see REQUIREMENTS.md §6 and AGENTS.md "Security non-negotiables").
 *
 * Rather than auditing and editing several hundred call sites, redaction is
 * applied once, at the console boundary. Every `console.log` / `warn` /
 * `error` / `info` call in the worker — including output captured from the
 * page's own `console` events — passes through {@link redactText} first.
 *
 * This is a safety net, not the primary defence: the runner should still
 * avoid logging raw payloads in the first place (see `browser-runner.ts`,
 * which logs portal response bodies). Both layers must hold.
 */

interface RedactionRule {
  readonly pattern: RegExp;
  readonly replacement: string;
}

/**
 * Ordered rules. The first match for a given span wins, so the more
 * specific patterns come first.
 */
const RULES: RedactionRule[] = [
  // JSON Web Tokens — three base64url segments.
  { pattern: /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g, replacement: '[REDACTED_JWT]' },
  // RuPay order / booking identifiers (RUPS-*, RUP*).
  { pattern: /\bRUP[A-Z0-9-]{3,}\b/gi, replacement: '[REDACTED_ORDER_ID]' },
  // Bearer tokens and explicit auth headers.
  { pattern: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replacement: '$1 [REDACTED_TOKEN]' },
  // Cookie and authorization headers, in any casing, with any separator.
  {
    pattern: /((?:set-)?cookie|authorization|x-api-key|set-cookie)\s*[:=]\s*[^\s,;"']+/gi,
    replacement: '$1=[REDACTED]',
  },
  // Labelled secrets. Covers password, passcode, otp, pin, cvv, secret, token.
  {
    pattern:
      /\b(password|passcode|passwd|pwd|otp|pin|cvv|cvc|secret|token|api[_-]?key|encryption[_-]?key|credential)\b\s*[:=]\s*("?)[^\s"',;}]+\2/gi,
    replacement: '$1=[REDACTED]',
  },
  // Booking references. The portal's own order ids are covered above; this
  // catches a reference printed under a label of its own.
  {
    pattern:
      /\b(booking|booking[_-]?(ref|reference|id)|bookingref|bookingreference)\b\s*[:=]\s*("?)[^\s"',;}]+\2/gi,
    replacement: '$1=[REDACTED]',
  },
  // Card numbers: 13-19 digits, optionally separated by spaces or dashes.
  // Requires a non-alphanumeric boundary so UUIDs and timestamps are safe.
  { pattern: /(?<![A-Za-z0-9])(?:\d[ -]?){13,19}(?![A-Za-z0-9])/g, replacement: '[REDACTED_CARD]' },
  // Indian mobile numbers, with or without the country code.
  { pattern: /(?<![A-Za-z0-9])(\+?91[-\s]?)?[6-9]\d{4}[-\s]?\d{5}(?![A-Za-z0-9])/g, replacement: '[REDACTED_PHONE]' },
  // Email addresses — keep the domain, mask the local part.
  {
    pattern: /\b([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    replacement: '$1***@$3',
  },
];

/**
 * Scrub sensitive material out of a single string.
 */
export function redactText(input: string): string {
  let out = input;
  for (const { pattern, replacement } of RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function redactArgs(args: unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === 'string') return redactText(arg);
    if (arg instanceof Error) {
      return new Error(redactText(`${arg.name}: ${arg.message}`));
    }
    if (arg && typeof arg === 'object') {
      try {
        return redactText(JSON.stringify(arg));
      } catch {
        return arg;
      }
    }
    return arg;
  });
}

let installed = false;

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;

/** The subset of the console this module wraps. */
export type ConsoleLike = Pick<Console, (typeof METHODS)[number]>;

/**
 * Build a console whose every method redacts its arguments first.
 *
 * Exposed separately from {@link installLogRedaction} so the wrapping can be
 * tested without depending on how a test runner intercepts console output.
 */
export function createRedactedConsole(target: ConsoleLike): ConsoleLike {
  const out = {} as ConsoleLike;
  for (const method of METHODS) {
    const original = target[method].bind(target);
    out[method] = ((...args: unknown[]) => {
      original(...redactArgs(args));
    }) as ConsoleLike[typeof method];
  }
  return out;
}

/**
 * Wrap the console so that everything the worker prints is redacted.
 * Idempotent — calling it twice does not double-wrap.
 */
export function installLogRedaction(): void {
  if (installed) return;
  installed = true;

  const patched = createRedactedConsole(console);
  for (const method of METHODS) {
    console[method] = patched[method];
  }
}
