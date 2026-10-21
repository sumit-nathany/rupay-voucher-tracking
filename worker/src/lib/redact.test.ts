import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRedactedConsole, installLogRedaction, redactText } from './redact';

/**
 * The worker's logs go to Cloud Logging, where they are retained and
 * accessible to anyone with project access. The product rules are explicit
 * that portal credentials, JWTs, cookies, session IDs, OTPs, raw portal
 * payloads, voucher codes and booking IDs must never reach a log
 * (REQUIREMENTS.md §6). These tests are the regression net for that rule.
 */
describe('redactText', () => {
  it('removes JSON Web Tokens', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const out = redactText(`session token ${jwt} expired`);
    expect(out).not.toContain(jwt);
    expect(out).toContain('[REDACTED_JWT]');
  });

  it('removes RuPay order and booking identifiers', () => {
    const out = redactText('Tracked active order ID: RUPS-20260921-000417');
    expect(out).not.toContain('RUPS-20260921-000417');
    expect(out).toContain('[REDACTED_ORDER_ID]');
  });

  it('removes labelled booking references', () => {
    const out = redactText('bookingReference: BK-9F2A11C3 confirmed');
    expect(out).not.toContain('BK-9F2A11C3');
    expect(out).toContain('[REDACTED]');
  });

  it('removes cookie and authorization header values', () => {
    expect(redactText('Cookie: jwt=abc123def456; other=1')).not.toContain('abc123def456');
    expect(redactText('Authorization: Bearer sk-live-99887766')).not.toContain('sk-live-99887766');
  });

  it('removes labelled secrets', () => {
    for (const line of [
      'password: hunter2secret',
      'otp=482913',
      'pin: 7741',
      'cvv: 331',
      'api_key=AKIAIOSFODNN7EXAMPLE',
      'encryption_key: c2VjcmV0a2V5dmFsdWU=',
    ]) {
      const out = redactText(line);
      expect(out, `expected redaction for: ${line}`).toContain('[REDACTED]');
    }
  });

  it('removes card numbers, with and without separators', () => {
    expect(redactText('card 4111111111111111 charged')).not.toContain('4111111111111111');
    expect(redactText('card 4111 1111 1111 1111 charged')).not.toContain('1111 1111');
    expect(redactText('card 4111-1111-1111-1111 charged')).not.toContain('4111-1111');
  });

  it('removes phone numbers', () => {
    expect(redactText('sending OTP to +91 98765 43210')).not.toContain('98765 43210');
  });

  it('masks the local part of an email address but keeps the domain', () => {
    const out = redactText('account coolfriendamit0506@gmail.com is connected');
    expect(out).not.toContain('coolfriendamit0506@gmail.com');
    expect(out).toContain('gmail.com');
  });

  it('leaves ordinary operational text alone', () => {
    const line = '[worker] Batch run starting at 2026-10-21T00:49:06.229Z';
    expect(redactText(line)).toBe(line);
  });

  it('leaves short numbers and identifiers alone', () => {
    for (const line of ['instance 06d4e3a7-3439-47d6-aba5-30dea3c668e5', 'status: completed', 'count 42']) {
      expect(redactText(line)).toBe(line);
    }
  });

  it('does not redact a plain workspace or account id', () => {
    const id = 'c55818d7-7fcd-49a6-a270-cb908a9a0840';
    expect(redactText(`workspace ${id}`)).toBe(`workspace ${id}`);
  });
});

describe('createRedactedConsole', () => {
  function fakeConsole() {
    return {
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
  }

  it('scrubs strings written through every method', () => {
    const target = fakeConsole();
    const patched = createRedactedConsole(target);

    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      patched[method]('portal returned jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijkl');
    }

    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      const written = String(target[method].mock.calls[0][0]);
      expect(written, method).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(written, method).toContain('[REDACTED_JWT]');
    }
  });

  it('scrubs secrets inside object arguments', () => {
    const target = fakeConsole();
    const patched = createRedactedConsole(target);

    patched.log({ card: '4111111111111111', label: 'user@example.com' });

    const written = String(target.log.mock.calls[0][0]);
    expect(written).not.toContain('4111111111111111');
    expect(written).not.toContain('user@example.com');
  });

  it('scrubs error arguments', () => {
    const target = fakeConsole();
    const patched = createRedactedConsole(target);

    patched.error(new Error('login failed for user@example.com'));

    const written = String(target.error.mock.calls[0][0]);
    expect(written).not.toContain('user@example.com');
  });

  it('leaves ordinary operational text untouched', () => {
    const target = fakeConsole();
    const patched = createRedactedConsole(target);

    patched.log('[worker] Batch run starting at 2026-10-21T00:49:06.229Z');

    expect(String(target.log.mock.calls[0][0])).toBe(
      '[worker] Batch run starting at 2026-10-21T00:49:06.229Z',
    );
  });
});

describe('installLogRedaction', () => {
  it('replaces the console methods with redacting wrappers', () => {
    const before = console.log;
    installLogRedaction();
    expect(console.log).not.toBe(before);
  });

  it('is idempotent — installing twice does not double-wrap', () => {
    installLogRedaction();
    const afterFirst = console.log;
    installLogRedaction();
    expect(console.log).toBe(afterFirst);
  });
});
