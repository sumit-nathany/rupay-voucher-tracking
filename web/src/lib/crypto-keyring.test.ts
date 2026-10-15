import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  decryptEnvelope,
  encryptEnvelope,
  getKeyFingerprint,
  getKeyring,
  getPrimaryKey,
  parseKeyBuffer,
} from './crypto-keyring';

const key1 = randomBytes(32).toString('base64');
const key2 = randomBytes(32).toString('base64');
const key3 = randomBytes(32).toString('base64');

describe('crypto-keyring', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.VOUCHER_ENCRYPTION_KEY;
    delete process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEYRING;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('parses valid 32-byte base64 keys and ignores invalid keys', () => {
    expect(parseKeyBuffer(key1)).not.toBeNull();
    expect(parseKeyBuffer(`base64:${key1}`)).not.toBeNull();
    expect(parseKeyBuffer('too-short')).toBeNull();
    expect(parseKeyBuffer(undefined)).toBeNull();
  });

  it('generates 8-character hex fingerprints', () => {
    const buf = parseKeyBuffer(key1)!;
    const fp = getKeyFingerprint(buf);
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
  });

  it('resolves primary key correctly', () => {
    process.env.VOUCHER_ENCRYPTION_KEY = key1;
    const primary = getPrimaryKey('VOUCHER_ENCRYPTION_KEY');
    expect(primary.fingerprint).toBe(getKeyFingerprint(parseKeyBuffer(key1)!));
  });

  it('deduplicates keys in the keyring', () => {
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = key1;
    process.env.VOUCHER_ENCRYPTION_KEY = key1; // duplicate
    process.env.ENCRYPTION_KEYRING = `${key1},${key2}`;

    const keyring = getKeyring('PORTAL_CREDENTIAL_ENCRYPTION_KEY');
    expect(keyring.length).toBe(2);
  });

  it('transparently decrypts ciphertext encrypted with an older/alternate key via keyring', () => {
    // Encrypt with key1
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = key1;
    const ciphertext = encryptEnvelope('secret-payload', 'aad-123', 'PORTAL_CREDENTIAL_ENCRYPTION_KEY');

    // Change active primary key to key2, but keep key1 in fallback keyring
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = key2;
    process.env.ENCRYPTION_KEYRING = key1;

    // Decrypt should succeed seamlessly by falling back to key1 in keyring
    const decrypted = decryptEnvelope(
      ciphertext,
      'aad-123',
      'PORTAL_CREDENTIAL_ENCRYPTION_KEY',
      'Failed to decrypt',
    );
    expect(decrypted).toBe('secret-payload');
  });

  it('fails decryption when no key in the keyring can authenticate the authTag', () => {
    // Encrypt with key1
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = key1;
    const ciphertext = encryptEnvelope('secret-payload', 'aad-123', 'PORTAL_CREDENTIAL_ENCRYPTION_KEY');

    // Only key2 and key3 are in the environment
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = key2;
    process.env.ENCRYPTION_KEYRING = key3;

    expect(() =>
      decryptEnvelope(
        ciphertext,
        'aad-123',
        'PORTAL_CREDENTIAL_ENCRYPTION_KEY',
        'Failed to decrypt',
      ),
    ).toThrow('Failed to decrypt');
  });

  it('fails decryption when AAD does not match even if key matches', () => {
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = key1;
    const ciphertext = encryptEnvelope('secret-payload', 'correct-aad', 'PORTAL_CREDENTIAL_ENCRYPTION_KEY');

    expect(() =>
      decryptEnvelope(
        ciphertext,
        'wrong-aad',
        'PORTAL_CREDENTIAL_ENCRYPTION_KEY',
        'Failed to decrypt',
      ),
    ).toThrow('Failed to decrypt');
  });
});
