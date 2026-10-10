import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  encryptPortalCredentials,
  decryptPortalCredentials,
  portalCredentialsSchema,
  type PortalCredentials,
} from './portal-credentials';

describe('portal-credentials encryption', () => {
  const origKey = process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY;
  const testKey = randomBytes(32).toString('base64');

  beforeEach(() => {
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = testKey;
  });

  afterEach(() => {
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = origKey;
  });

  const accountId = '550e8400-e29b-41d4-a716-446655440000';
  const credentials: PortalCredentials = {
    version: 1,
    loginId: 'user_12345',
    password: 'super-secret-password-999',
    extra: { pin: '1234' },
  };

  it('round trips valid credentials with correct AAD', () => {
    const cipher = encryptPortalCredentials(credentials, accountId);
    expect(cipher.startsWith('v1.')).toBe(true);
    const decrypted = decryptPortalCredentials(cipher, accountId);
    expect(decrypted).toEqual(credentials);
  });

  it('fails decryption when AAD (accountId) does not match', () => {
    const cipher = encryptPortalCredentials(credentials, accountId);
    const wrongAccountId = '660e8400-e29b-41d4-a716-446655440000';
    expect(() => decryptPortalCredentials(cipher, wrongAccountId)).toThrow('Failed to decrypt portal credentials');
  });

  it('fails when ciphertext is tampered', () => {
    const cipher = encryptPortalCredentials(credentials, accountId);
    const tampered = cipher.slice(0, -4) + 'AAAA';
    expect(() => decryptPortalCredentials(tampered, accountId)).toThrow();
  });

  it('fails when encrypted with wrong key length or missing key', () => {
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = 'invalid-short-key';
    expect(() => encryptPortalCredentials(credentials, accountId)).toThrow('must be 32 bytes');
  });

  it('validates schema requirements', () => {
    // Missing loginId
    expect(() =>
      portalCredentialsSchema.parse({
        version: 1,
        loginId: '',
        password: 'pwd',
      }),
    ).toThrow();
  });
});
