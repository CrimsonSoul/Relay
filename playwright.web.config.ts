import { defineConfig, devices } from '@playwright/test';

const chromeUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const edgeUserAgent = `${chromeUserAgent} Edg/126.0.0.0`;
const safariUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Safari/605.1.15';

export default defineConfig({
  testDir: './tests/web',
  testMatch: '**/*.spec.ts',
  timeout: 90 * 1000,
  expect: { timeout: 20 * 1000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  reporter: [['list']],
  use: {
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], userAgent: chromeUserAgent },
    },
    {
      name: 'edge',
      use: { ...devices['Desktop Chrome'], userAgent: edgeUserAgent },
    },
    {
      name: 'safari',
      use: { ...devices['Desktop Safari'], userAgent: safariUserAgent },
    },
  ],
});
