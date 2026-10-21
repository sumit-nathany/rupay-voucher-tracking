#!/usr/bin/env node
/**
 * Reads a single value out of a dotenv file and prints it.
 *
 *   node read-env.mjs <env-file> <KEY>
 *
 * Why this exists instead of `grep KEY= file | cut -d= -f2-`: dotenv values
 * may be wrapped in quotes, and a naive cut leaves the quotes attached, which
 * produces a malformed database URL that fails much later with a confusing
 * "Invalid URL". This parses the file the way dotenv does.
 */
import { readFileSync } from 'node:fs';

const [file, key] = process.argv.slice(2);
if (!file || !key) {
  console.error('usage: read-env.mjs <env-file> <KEY>');
  process.exit(2);
}

let raw;
try {
  raw = readFileSync(file, 'utf8');
} catch {
  console.error(`read-env.mjs: cannot read ${file}`);
  process.exit(2);
}

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"');
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1);
  }
  return v;
}

for (const line of raw.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const withoutExport = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
  const eq = withoutExport.indexOf('=');
  if (eq === -1) continue;
  if (withoutExport.slice(0, eq).trim() !== key) continue;

  let value = withoutExport.slice(eq + 1);
  // A trailing unquoted comment is not part of the value.
  if (!value.trim().startsWith('"') && !value.trim().startsWith("'")) {
    const hash = value.indexOf(' #');
    if (hash !== -1) value = value.slice(0, hash);
  }
  process.stdout.write(unquote(value));
  process.exit(0);
}

console.error(`read-env.mjs: ${key} not found in ${file}`);
process.exit(1);
