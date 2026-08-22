import { defineConfig } from 'vitest/config';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Throwaway config for coordinator-run verification against a real PocketBase.
// Kept out of vitest.config.ts so these slow, binary-dependent checks never run
// in the normal suite.
export default defineConfig({
  test: {
    environment: 'node',
    silent: 'passed-only',
    include: ['verification/**/*.test.ts'],
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@main': resolve(__dirname, 'src/main'),
    },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
