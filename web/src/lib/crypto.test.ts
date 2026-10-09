import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptCode, encryptCode } from './crypto';

const KEY = randomBytes(32).toString('base64');
const SECRET = 'GIFT-CODE-SECRET-1234567890';
let saved: string | undefined;

beforeEach(() => {
  saved = process.env.VOUCHER_ENCRYPTION_KEY;
  process.env.VOUCHER_ENCRYPTION_KEY = KEY;
});
afterEach(() => {
  if (saved === undefined) delete process.env.VOUCHER_ENCRYPTION_KEY;
  else process.env.VOUCHER_ENCRYPTION_KEY = saved;
});

const errOf = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected throw');
};

describe('crypto', () => {
  it('round-trips, including unicode and empty strings', () => {
    for (const s of [SECRET, '', 'pïn-✓']) {
      expect(decryptCode(encryptCode(s, 'row-1'), 'row-1')).toBe(s);
    }
  });
  it('produces a versioned self-describing string', () => {
    const c = encryptCode(SECRET, 'row-1');
    expect(c.startsWith('v1.')).toBe(true);
    const raw = Buffer.from(c.slice(3), 'base64');
    expect(raw.length).toBe(12 + 16 + Buffer.byteLength(SECRET));
    expect(c).not.toContain(SECRET);
  });
  it('two encryptions of the same input differ', () => {
    expect(encryptCode(SECRET, 'row-1')).not.toBe(encryptCode(SECRET, 'row-1'));
  });
  it('wrong rowId fails to decrypt', () => {
    const c = encryptCode(SECRET, 'row-1');
    expect(() => decryptCode(c, 'row-2')).toThrow();
  });
  it('tampered ciphertext fails', () => {
    const c = encryptCode(SECRET, 'row-1');
    const buf = Buffer.from(c.slice(3), 'base64');
    buf[buf.length - 1] ^= 1;
    expect(() => decryptCode(`v1.${buf.toString('base64')}`, 'row-1')).toThrow();
    const buf2 = Buffer.from(c.slice(3), 'base64');
    buf2[12] ^= 1; // tag
    expect(() => decryptCode(`v1.${buf2.toString('base64')}`, 'row-1')).toThrow();
  });
  it('rejects unknown version and truncated input', () => {
    expect(() => decryptCode('v9.AAAA', 'r')).toThrow();
    expect(() => decryptCode('v1.AAAA', 'r')).toThrow();
  });
  it('fails under a different key', () => {
    const c = encryptCode(SECRET, 'row-1');
    process.env.VOUCHER_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    expect(() => decryptCode(c, 'row-1')).toThrow();
  });
  it('accepts a base64: prefixed key', () => {
    process.env.VOUCHER_ENCRYPTION_KEY = `base64:${KEY}`;
    expect(decryptCode(encryptCode(SECRET, 'r'), 'r')).toBe(SECRET);
  });
  it('errors clearly when key missing, without leaking anything', () => {
    delete process.env.VOUCHER_ENCRYPTION_KEY;
    const e = errOf(() => encryptCode(SECRET, 'r'));
    expect(e.message).toMatch(/VOUCHER_ENCRYPTION_KEY/);
    expect(e.message).not.toContain(SECRET);
  });
  it('errors on wrong key length without including the key', () => {
    const bad = randomBytes(16).toString('base64');
    process.env.VOUCHER_ENCRYPTION_KEY = bad;
    const e = errOf(() => encryptCode(SECRET, 'r'));
    expect(e.message).toMatch(/32 bytes/);
    expect(e.message).not.toContain(bad);
    expect(e.message).not.toContain(SECRET);
  });
  it('plaintext never appears in decrypt error messages', () => {
    const c = encryptCode(SECRET, 'row-1');
    const e1 = errOf(() => decryptCode(c, 'row-2'));
    const buf = Buffer.from(c.slice(3), 'base64');
    buf[buf.length - 1] ^= 1;
    const e2 = errOf(() => decryptCode(`v1.${buf.toString('base64')}`, 'row-1'));
    for (const e of [e1, e2]) {
      expect(e.message).not.toContain(SECRET);
      expect(e.message).not.toContain(KEY);
    }
  });
});
