import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  decryptPaymentDetails,
  encryptPaymentDetails,
  maskPaymentSummary,
  type PaymentDetails,
} from './card-payment-details';

const KEY = randomBytes(32).toString('base64');
const mappingId = '550e8400-e29b-41d4-a716-446655440000';

let saved: string | undefined;

beforeEach(() => {
  saved = process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY;
  process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = KEY;
});

afterEach(() => {
  if (saved === undefined) delete process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = saved;
});

describe('card-payment-details crypto', () => {
  it('encrypts and decrypts full card details (Option A)', () => {
    const details: PaymentDetails = {
      version: 1,
      mode: 'full',
      cardNumber: '6521501234565159',
      expiryMonth: '08',
      expiryYear: '29',
      cvv: '123',
      nameOnCard: 'Sumit Nathany',
    };

    const cipher = encryptPaymentDetails(details, mappingId);
    expect(cipher.startsWith('v1.')).toBe(true);
    const decrypted = decryptPaymentDetails(cipher, mappingId);
    expect(decrypted).toEqual(details);

    const masked = maskPaymentSummary(decrypted);
    expect(masked).toEqual({
      mode: 'full',
      maskedCardNumber: '•••• •••• •••• 5159',
      expirySummary: '08/29',
      hasCvv: true,
      nameOnCard: 'Sumit Nathany',
    });
  });

  it('encrypts and decrypts saved card CVV-only details (Option B)', () => {
    const details: PaymentDetails = {
      version: 1,
      mode: 'saved_card',
      cvv: '456',
    };

    const cipher = encryptPaymentDetails(details, mappingId);
    const decrypted = decryptPaymentDetails(cipher, mappingId);
    expect(decrypted).toEqual(details);

    const masked = maskPaymentSummary(decrypted);
    expect(masked).toEqual({
      mode: 'saved_card',
      maskedCardNumber: null,
      expirySummary: null,
      hasCvv: true,
      nameOnCard: null,
    });
  });

  it('fails decryption when AAD (mappingId) does not match', () => {
    const details: PaymentDetails = {
      version: 1,
      mode: 'saved_card',
      cvv: '999',
    };
    const cipher = encryptPaymentDetails(details, mappingId);
    expect(() => decryptPaymentDetails(cipher, 'different-mapping-id')).toThrow(
      'Failed to decrypt card payment details',
    );
  });

  it('decrypts seamlessly using fallback keyring when active key changes', () => {
    const details: PaymentDetails = {
      version: 1,
      mode: 'full',
      cardNumber: '6521509999995110',
      cvv: '123',
    };
    // Encrypted with KEY
    const cipher = encryptPaymentDetails(details, mappingId);

    // Rotate primary key to a new key, putting KEY in ENCRYPTION_KEYRING
    const newKey = randomBytes(32).toString('base64');
    process.env.PORTAL_CREDENTIAL_ENCRYPTION_KEY = newKey;
    process.env.ENCRYPTION_KEYRING = KEY;

    const decrypted = decryptPaymentDetails(cipher, mappingId);
    expect(decrypted).toEqual(details);
  });
});
