import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

// Load .env.preprod with override: true so it supersedes .env.local
const preprodCandidates = [
  resolve(process.cwd(), '.env.preprod'),
  resolve(process.cwd(), '../.env.preprod'),
];

let loaded = false;
for (const p of preprodCandidates) {
  if (existsSync(p)) {
    console.log(`[dev:preprod] Loading preprod environment from: ${p}`);
    config({ path: p, override: true });
    loaded = true;
    break;
  }
}

if (!loaded) {
  console.warn('[dev:preprod] WARNING: .env.preprod not found! Falling back to defaults.');
}

process.env.APP_ENV = 'preprod';
if (process.env.PREPROD_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PREPROD_DATABASE_URL;
}

console.log('[dev:preprod] Starting Next.js dev server connected to PREPROD...');
console.log(`[dev:preprod] Supabase URL: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);

const child = spawn('npx', ['next', 'dev'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
