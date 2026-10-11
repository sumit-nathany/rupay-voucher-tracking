import path from 'path';
import fs from 'fs';

/**
 * Returns the isolated browser profile directory for a specific RuPay portal account.
 * Format: worker/.browser-data/account_<portalAccountId>
 */
export function getAccountProfilePath(accountId: string, baseDir?: string): string {
  const root = baseDir ?? process.cwd();
  // Ensure we locate the .browser-data directory consistently inside worker
  const browserDataRoot = root.endsWith('worker')
    ? path.resolve(root, '.browser-data')
    : path.resolve(root, 'worker', '.browser-data');

  const profileDir = path.resolve(browserDataRoot, `account_${accountId}`);
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  return profileDir;
}

/**
 * Checks if a saved browser session directory exists for this account.
 */
export function hasExistingProfile(accountId: string, baseDir?: string): boolean {
  const profileDir = getAccountProfilePath(accountId, baseDir);
  return (
    fs.existsSync(path.join(profileDir, 'Default')) ||
    fs.existsSync(path.join(profileDir, 'Local State'))
  );
}
