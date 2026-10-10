import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

const VERSION = 'v1';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_ENV = 'PORTAL_CREDENTIAL_ENCRYPTION_KEY';

export const portalCredentialsSchema = z.object({
  version: z.literal(1),
  loginId: z.string().min(1, 'Login ID is required'),
  password: z.string().min(1, 'Password is required'),
  extra: z.record(z.string(), z.string()).optional(),
});

export type PortalCredentials = z.infer<typeof portalCredentialsSchema>;

function getKey(): Buffer {
  const raw = process.env[KEY_ENV] || process.env.VOUCHER_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(`${KEY_ENV} is not set`);
  }
  const b64 = raw.startsWith('base64:') ? raw.slice('base64:'.length) : raw;
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must be 32 bytes, base64-encoded (got ${key.length} bytes)`);
  }
  return key;
}

export function encryptPortalCredentials(credentials: PortalCredentials, portalAccountId: string): string {
  // Validate schema before encryption
  const validated = portalCredentialsSchema.parse(credentials);
  const plaintext = JSON.stringify(validated);

  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(portalAccountId, 'utf8'));

  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${VERSION}.${Buffer.concat([iv, tag, ct]).toString('base64')}`;
}

export function decryptPortalCredentials(ciphertext: string, portalAccountId: string): PortalCredentials {
  const key = getKey();
  const prefix = `${VERSION}.`;
  if (!ciphertext.startsWith(prefix)) {
    throw new Error('Unsupported ciphertext format');
  }

  const buf = Buffer.from(ciphertext.slice(prefix.length), 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('Malformed ciphertext');
  }

  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);

  let rawJson: string;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
    decipher.setAAD(Buffer.from(portalAccountId, 'utf8'));
    decipher.setAuthTag(tag);
    rawJson = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // Deliberately generic: never echo keys, credentials, or underlying details
    throw new Error('Failed to decrypt portal credentials');
  }

  try {
    const parsed = JSON.parse(rawJson);
    return portalCredentialsSchema.parse(parsed);
  } catch {
    throw new Error('Decrypted credentials payload is invalid');
  }
}
