import { decryptEnvelope, encryptEnvelope } from './crypto-keyring';

const KEY_ENV = 'VOUCHER_ENCRYPTION_KEY';

export function encryptCode(plaintext: string, rowId: string): string {
  return encryptEnvelope(plaintext, rowId, KEY_ENV);
}

export function decryptCode(ciphertext: string, rowId: string): string {
  return decryptEnvelope(ciphertext, rowId, KEY_ENV, 'Failed to decrypt voucher code');
}
