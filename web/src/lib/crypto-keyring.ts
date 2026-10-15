import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION_V1 = 'v1';
const VERSION_V2 = 'v2';
const IV_LEN = 12;
const TAG_LEN = 16;

export interface KeyEntry {
  key: Buffer;
  name: string;
  fingerprint: string;
}

/**
 * Normalizes a base64 key string into a 32-byte Buffer.
 * Returns null if the string is empty or not exactly 32 bytes.
 */
export function parseKeyBuffer(rawKey: string | undefined): Buffer | null {
  if (!rawKey) return null;
  const trimmed = rawKey.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) return null;
  const b64 = trimmed.startsWith('base64:') ? trimmed.slice(7) : trimmed;
  try {
    const buf = Buffer.from(b64, 'base64');
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Returns a deterministic 8-character hex fingerprint of a key buffer.
 */
export function getKeyFingerprint(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 8);
}

/**
 * Resolves the primary active key for a given environment variable name.
 * Falls back to VOUCHER_ENCRYPTION_KEY if the primary name is not set.
 */
export function getPrimaryKey(primaryEnvVar: string): KeyEntry {
  const raw = process.env[primaryEnvVar] || process.env.VOUCHER_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(`${primaryEnvVar} is not set`);
  }
  const buf = parseKeyBuffer(raw);
  if (!buf) {
    throw new Error(
      `${primaryEnvVar} must be 32 bytes, base64-encoded`,
    );
  }
  return {
    key: buf,
    name: process.env[primaryEnvVar] ? primaryEnvVar : 'VOUCHER_ENCRYPTION_KEY',
    fingerprint: getKeyFingerprint(buf),
  };
}

/**
 * Resolves all candidate keys (primary + cross-domain fallbacks + ENCRYPTION_KEYRING).
 * Deduplicated by key fingerprint.
 */
export function getKeyring(primaryEnvVar: string): KeyEntry[] {
  const candidates: Array<{ raw: string | undefined; name: string }> = [];

  // 1. Primary requested key
  if (process.env[primaryEnvVar]) {
    candidates.push({ raw: process.env[primaryEnvVar], name: primaryEnvVar });
  }

  // 2. Standard cross-domain keys
  for (const envName of [
    'VOUCHER_ENCRYPTION_KEY',
    'PORTAL_CREDENTIAL_ENCRYPTION_KEY',
    'PROD_VOUCHER_ENCRYPTION_KEY',
    'PREPROD_VOUCHER_ENCRYPTION_KEY',
  ]) {
    if (envName !== primaryEnvVar && process.env[envName]) {
      candidates.push({ raw: process.env[envName], name: envName });
    }
  }

  // 3. Fallback keyring list (comma or space separated)
  const keyringEnv = process.env.ENCRYPTION_KEYRING;
  if (keyringEnv) {
    const items = keyringEnv.split(/[\s,]+/).filter(Boolean);
    items.forEach((item, idx) => {
      candidates.push({ raw: item, name: `ENCRYPTION_KEYRING[${idx}]` });
    });
  }

  const result: KeyEntry[] = [];
  const seenFingerprints = new Set<string>();

  for (const c of candidates) {
    const buf = parseKeyBuffer(c.raw);
    if (!buf) continue;
    const fp = getKeyFingerprint(buf);
    if (!seenFingerprints.has(fp)) {
      seenFingerprints.add(fp);
      result.push({ key: buf, name: c.name, fingerprint: fp });
    }
  }

  if (result.length === 0) {
    throw new Error(
      `No valid encryption keys found for ${primaryEnvVar} or VOUCHER_ENCRYPTION_KEY`,
    );
  }

  return result;
}

/**
 * Encrypts plaintext with AES-256-GCM using the primary key for the specified domain.
 * Formats as "v1." + base64(iv[12] || tag[16] || ciphertext).
 */
export function encryptEnvelope(
  plaintext: string,
  aad: string,
  primaryEnvVar: string,
): string {
  const { key } = getPrimaryKey(primaryEnvVar);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${VERSION_V1}.${Buffer.concat([iv, tag, ct]).toString('base64')}`;
}

/**
 * Decrypts ciphertext with AES-256-GCM using the primary key first,
 * falling back transparently to all keys in the keyring if the primary fails.
 */
export function decryptEnvelope(
  ciphertext: string,
  aad: string,
  primaryEnvVar: string,
  genericErrorMessage: string,
): string {
  let targetFingerprint: string | null = null;
  let rawB64: string;

  if (ciphertext.startsWith(`${VERSION_V2}.`)) {
    // Format: v2.<fingerprint>.<base64>
    const parts = ciphertext.split('.');
    if (parts.length === 3) {
      targetFingerprint = parts[1];
      rawB64 = parts[2];
    } else {
      throw new Error('Malformed v2 ciphertext');
    }
  } else if (ciphertext.startsWith(`${VERSION_V1}.`)) {
    rawB64 = ciphertext.slice(`${VERSION_V1}.`.length);
  } else {
    throw new Error('Unsupported ciphertext format');
  }

  const buf = Buffer.from(rawB64, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('Malformed ciphertext');
  }

  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const aadBuf = Buffer.from(aad, 'utf8');

  const keyring = getKeyring(primaryEnvVar);

  // If ciphertext specifies a fingerprint, prioritize the key matching it
  const prioritizedKeys = [...keyring].sort((a, b) => {
    if (targetFingerprint) {
      if (a.fingerprint === targetFingerprint) return -1;
      if (b.fingerprint === targetFingerprint) return 1;
    }
    return 0;
  });

  for (const { key } of prioritizedKeys) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
      decipher.setAAD(aadBuf);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
      return pt;
    } catch {
      // Continue to next key in keyring
    }
  }

  // If all keys in keyring fail authentication
  throw new Error(genericErrorMessage);
}
