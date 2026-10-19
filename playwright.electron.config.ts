import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60 * 1000,
  expect: {
    timeout: 15 * 1000,
  },
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
  },
});
