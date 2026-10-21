/**
 * Bundles the ordering worker into a single ESM file.
 *
 * The worker imports shared domain code from `web/src` by relative path
 * (`../../web/src/...`) and those modules use the `@/` path alias. `tsc`
 * cannot rewrite path aliases in its emitted JavaScript, so a plain
 * `tsc` build would produce a bundle that Node cannot resolve at runtime.
 * esbuild resolves the alias at build time and leaves every `node_modules`
 * package external, so the runtime image only needs the worker's own
 * dependencies installed.
 *
 * Output: worker/dist/worker.js
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const entry = process.argv[2] ?? path.join(here, 'src', 'batch.ts');
const outfile = process.argv[3] ?? path.join(here, 'dist', 'worker.js');

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Keep every npm package external — they are resolved from worker/node_modules
  // at runtime. Only first-party source (including web/src) is bundled.
  packages: 'external',
  alias: {
    '@': path.join(repoRoot, 'web', 'src'),
  },
  tsconfig: path.join(here, 'tsconfig.build.json'),
  sourcemap: true,
  minify: false,
  // `require` is still reachable from CommonJS dependencies that esbuild leaves
  // external, so make it available inside the ESM output.
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'info',
});

console.log(`[build] wrote ${outfile}`);
