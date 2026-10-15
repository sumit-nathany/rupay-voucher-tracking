import { z } from 'zod';
import { decryptEnvelope, encryptEnvelope } from './crypto-keyring';

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

export function encryptPaymentDetails(details: PaymentDetails, mappingId: string): string {
  const validated = paymentDetailsSchema.parse(details);
  return encryptEnvelope(JSON.stringify(validated), mappingId, KEY_ENV);
}

export function decryptPaymentDetails(ciphertext: string, mappingId: string): PaymentDetails {
  const rawJson = decryptEnvelope(ciphertext, mappingId, KEY_ENV, 'Failed to decrypt card payment details');
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
