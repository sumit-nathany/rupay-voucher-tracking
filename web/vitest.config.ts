import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    // The beforeAll hooks here spin up an in-memory Postgres and replay every
    // migration, and the suite runs many of those in parallel — 30s was
    // knife-edge and made unrelated files time out.
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
