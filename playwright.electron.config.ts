
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['critical-path.spec.ts'],
  timeout: 60 * 1000,
  expect: {
    timeout: 15 * 1000
  },
  workers: 1,
  reporter: [['list']],
});
