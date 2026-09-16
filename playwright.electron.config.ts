import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: [
    'backup-verification.spec.ts',
    'critical-path.spec.ts',
    'css-visual-contracts.spec.ts',
    'knowledge-pdf-layout.spec.ts',
    'recovery-runtime-integrity.spec.ts',
    'radar-certificate.spec.ts',
    'setup-auth.spec.ts',
    'redesign-screenshots.spec.ts',
  ],
  timeout: 60 * 1000,
  expect: {
    timeout: 15 * 1000,
  },
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
  },
});
