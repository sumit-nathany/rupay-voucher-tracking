import path from 'path';
import fs from 'fs';

/**
 * Returns the isolated browser profile directory for a specific RuPay portal account.
 * Format: worker/.browser-data/account_<portalAccountId>
 *
 * `WORKER_PROFILE_DIR` overrides the root. The deployed Cloud Run Job sets it
 * to a throwaway path so that no portal session is ever persisted between
 * executions — the job logs in fresh every time and the profile is discarded
 * when the execution ends.
 */
export function getAccountProfilePath(accountId: string, baseDir?: string): string {
  const override = baseDir ?? process.env.WORKER_PROFILE_DIR;
  if (override) {
    // Explicit root: profiles live directly under it, one directory per account.
    const profileDir = path.resolve(override, `account_${accountId}`);
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }
    return profileDir;
  }

  const root = process.cwd();
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
