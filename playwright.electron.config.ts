
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '*.spec.ts',
  timeout: 60 * 1000,
  expect: {
    timeout: 10 * 1000
  },
  reporter: [['list']],
});
