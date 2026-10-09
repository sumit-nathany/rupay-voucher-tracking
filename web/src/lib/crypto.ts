import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// Format: "v1." + base64(iv[12] || tag[16] || ciphertext). AAD = row id.
const VERSION = 'v1';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_ENV = 'VOUCHER_ENCRYPTION_KEY';

function getKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw) throw new Error(`${KEY_ENV} is not set`);
  const b64 = raw.startsWith('base64:') ? raw.slice('base64:'.length) : raw;
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must be 32 bytes, base64-encoded (got ${key.length} bytes)`);
  }
  return key;
}

export function encryptCode(plaintext: string, rowId: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(rowId, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}.${Buffer.concat([iv, tag, ct]).toString('base64')}`;
}

export function decryptCode(ciphertext: string, rowId: string): string {
  const key = getKey();
  const prefix = `${VERSION}.`;
  if (!ciphertext.startsWith(prefix)) throw new Error('Unsupported ciphertext format');
  const buf = Buffer.from(ciphertext.slice(prefix.length), 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('Malformed ciphertext');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
    decipher.setAAD(Buffer.from(rowId, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // Deliberately generic: never echo key, plaintext, or underlying details.
    throw new Error('Failed to decrypt voucher code');
  }
}
