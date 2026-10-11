import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads environment files in priority order for the given target environment.
 * If targetEnv is 'preprod', it looks for .env.preprod first.
 * If targetEnv is 'prod' or 'production', it looks for .env.production first.
 * Always falls back to .env.local and .env.
 */
export function loadEnv(targetEnv?: string): { env: string; databaseUrl: string } {
  const env = targetEnv || process.env.APP_ENV || 'local';
  const cwd = process.cwd();

  const candidates = [
    resolve(cwd, `.env.${env}`),
    resolve(cwd, `../.env.${env}`),
    resolve(cwd, '.env.local'),
    resolve(cwd, '../.env.local'),
    resolve(cwd, '.env'),
    resolve(cwd, '../.env'),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      config({ path: p });
    }
  }

  const databaseUrl =
    (env === 'preprod' ? process.env.PREPROD_DATABASE_URL : undefined) ||
    (env === 'prod' || env === 'production' ? process.env.PROD_DATABASE_URL : undefined) ||
    process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error(
      env === 'preprod'
        ? 'PREPROD_DATABASE_URL (or DATABASE_URL in .env.preprod) is not set'
        : 'DATABASE_URL is not set'
    );
  }

  const PROD_REF = 'kdtkvzbkppdqjjqzinbi';
  const PREPROD_REF = 'vxqexizifbzknsscicck';

  if ((env === 'prod' || env === 'production') && databaseUrl.includes(PREPROD_REF)) {
    throw new Error(
      `[env] Target environment is '${env}', but resolved database URL points to pre-production project (${PREPROD_REF}). Check PROD_DATABASE_URL or .env.prod!`
    );
  }

  if (env === 'preprod' && databaseUrl.includes(PROD_REF)) {
    throw new Error(
      `[env] Target environment is 'preprod', but resolved database URL points to production project (${PROD_REF}). Aborting for safety!`
    );
  }

  return { env, databaseUrl };
}

/**
 * Masks password in a PostgreSQL connection string while preserving the username/project ref for verification.
 */
export function maskDatabaseUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return `${u.protocol}//${u.username}:****@${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return 'postgres://****@****';
  }
}
