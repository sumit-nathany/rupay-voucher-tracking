import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

const VERSION = 'v1';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_ENV = 'PORTAL_CREDENTIAL_ENCRYPTION_KEY';

export const paymentDetailsSchema = z.object({
  version: z.literal(1),
  /** 'full': enter full 16-digit card number, exp, cvv. 'saved_card': card is already saved on payment gateway, enter CVV only. */
  mode: z.enum(['full', 'saved_card']).default('full'),
  cardNumber: z.string().optional(),
  expiryMonth: z.string().optional(),
  expiryYear: z.string().optional(),
  cvv: z.string().optional(),
  nameOnCard: z.string().optional(),
});

export type PaymentDetails = z.infer<typeof paymentDetailsSchema>;

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

export function encryptPaymentDetails(details: PaymentDetails, mappingId: string): string {
  const validated = paymentDetailsSchema.parse(details);
  const plaintext = JSON.stringify(validated);

  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(mappingId, 'utf8'));

  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${VERSION}.${Buffer.concat([iv, tag, ct]).toString('base64')}`;
}

export function decryptPaymentDetails(ciphertext: string, mappingId: string): PaymentDetails {
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
    decipher.setAAD(Buffer.from(mappingId, 'utf8'));
    decipher.setAuthTag(tag);
    rawJson = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Failed to decrypt card payment details');
  }

  try {
    const parsed = JSON.parse(rawJson);
    return paymentDetailsSchema.parse(parsed);
  } catch {
    throw new Error('Decrypted payment details payload is invalid');
  }
}

export function maskPaymentSummary(details: PaymentDetails | null) {
  if (!details) return null;
  const cleanNum = details.cardNumber?.replace(/\D/g, '');
  const last4 = cleanNum && cleanNum.length >= 4 ? cleanNum.slice(-4) : null;
  return {
    mode: details.mode,
    maskedCardNumber: last4 ? `•••• •••• •••• ${last4}` : null,
    expirySummary: details.expiryMonth && details.expiryYear ? `${details.expiryMonth}/${details.expiryYear.slice(-2)}` : null,
    hasCvv: Boolean(details.cvv),
    nameOnCard: details.nameOnCard || null,
  };
}

export function isValidPaymentDetails(details: PaymentDetails | null | undefined): boolean {
  if (!details) return false;
  if (details.mode === 'saved_card') {
    return Boolean(details.cvv && details.cvv.trim().length >= 3);
  }
  const cleanNum = details.cardNumber?.replace(/\D/g, '') || '';
  return (
    cleanNum.length >= 15 &&
    Boolean(details.expiryMonth && details.expiryYear) &&
    Boolean(details.cvv && details.cvv.trim().length >= 3)
  );
}
