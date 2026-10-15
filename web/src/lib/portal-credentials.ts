import { z } from 'zod';
import { decryptEnvelope, encryptEnvelope } from './crypto-keyring';

const KEY_ENV = 'PORTAL_CREDENTIAL_ENCRYPTION_KEY';

export const portalCredentialsSchema = z.object({
  version: z.literal(1),
  loginId: z.string().min(1, 'Login ID is required'),
  password: z.string().min(1, 'Password is required'),
  extra: z.record(z.string(), z.string()).optional(),
});

export type PortalCredentials = z.infer<typeof portalCredentialsSchema>;

export function encryptPortalCredentials(credentials: PortalCredentials, portalAccountId: string): string {
  // Validate schema before encryption
  const validated = portalCredentialsSchema.parse(credentials);
  return encryptEnvelope(JSON.stringify(validated), portalAccountId, KEY_ENV);
}

export function decryptPortalCredentials(ciphertext: string, portalAccountId: string): PortalCredentials {
  const rawJson = decryptEnvelope(ciphertext, portalAccountId, KEY_ENV, 'Failed to decrypt portal credentials');
  try {
    const parsed = JSON.parse(rawJson);
    return portalCredentialsSchema.parse(parsed);
  } catch {
    throw new Error('Decrypted credentials payload is invalid');
  }
}
