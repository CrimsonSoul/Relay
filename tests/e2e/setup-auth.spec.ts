import { _electron as electron, test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mainEntry = path.join(__dirname, '../../dist/main/index.js');

test.describe('Setup Screen & Auth Flow', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>>;
  let window: Awaited<ReturnType<typeof electronApp.firstWindow>>;
  let tempDataDir: string;

  test.beforeEach(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-e2e-setup-'));
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    if (tempDataDir) {
      fs.rmSync(tempDataDir, { recursive: true, force: true });
    }
  });

  async function launchApp() {
    const launchEnv = { ...process.env, NODE_ENV: 'test' };
    delete (launchEnv as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE;

    electronApp = await electron.launch({
      args: ['--user-data-dir=' + tempDataDir, mainEntry],
      env: launchEnv,
    });

    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  }

  /** Click the mode card by its tag text (Primary Station / Remote Station) */
  const selectMode = async (tag: 'Primary Station' | 'Remote Station') => {
    await window.locator('.setup-mode-card', { hasText: tag }).click();
    await expect(window.locator('text=Configure Relay')).toBeVisible();
  };

  /** Fill the passphrase input (targets the actual text input, not the eye toggle) */
  const fillPassphrase = async (value: string) => {
    await window.locator('.setup-config__password-wrap input').fill(value);
  };

  test('Shows setup screen on first launch', async () => {
    await launchApp();

    await expect(window.locator('text=Primary Station')).toBeVisible();
    await expect(window.locator('text=Remote Station')).toBeVisible();
    await expect(window.locator('text=How will this instance be used?')).toBeVisible();
  });

  test('Server mode: validates passphrase length', async () => {
    await launchApp();
    await selectMode('Primary Station');

    // Enter a short passphrase (less than 8 chars)
    await fillPassphrase('short');

    // Click submit
    await window.locator('button.setup-config__submit').click();

    // Verify error about minimum length
    await expect(window.locator('.setup-config__error')).toContainText(
      'Passphrase must be at least 8 characters',
    );
  });

  test('Server mode: accepts valid config and transitions past setup', async () => {
    test.setTimeout(30_000);
    await launchApp();
    await selectMode('Primary Station');

    // Fill port and passphrase
    const portInput = window.getByLabel('Port');
    await portInput.fill('');
    await portInput.fill('8099');
    await fillPassphrase('testpassphrase123');

    // Click save & start
    await window.locator('button.setup-config__submit').click();

    // The submit button should show loading state ("Starting Server...")
    // Then the app transitions past setup — either to the main app (sidebar visible)
    // or to an error/connecting state if PB binary isn't available in the test env.
    // Either way, the setup screen mode cards should no longer be visible.
    await expect(window.locator('.setup-mode-cards')).not.toBeVisible({ timeout: 20_000 });
    await expect(window.locator('.setup-config__form')).not.toBeVisible({ timeout: 5_000 });
  });

  test('Client mode: validates server URL', async () => {
    await launchApp();
    await selectMode('Remote Station');

    // Fill passphrase but leave URL empty
    await fillPassphrase('validpassphrase');

    // Click connect
    await window.locator('button.setup-config__submit').click();

    // Verify error about server URL
    await expect(window.locator('.setup-config__error')).toContainText('Server URL is required');
  });

  test('Back button returns to mode selection', async () => {
    await launchApp();
    await selectMode('Primary Station');

    // Click back button
    await window.locator('button.setup-config__back').click();

    // Verify mode selection is visible again
    await expect(window.locator('text=Primary Station')).toBeVisible();
    await expect(window.locator('text=Remote Station')).toBeVisible();
  });
});
