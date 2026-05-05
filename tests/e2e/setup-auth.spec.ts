import { _electron as electron, test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mainEntry = path.join(__dirname, '../../dist/main/index.js');

test.describe('Setup Screen & Auth Flow', () => {
  let electronApp: Awaited<ReturnType<typeof electron.launch>> | null;
  let window: Awaited<ReturnType<NonNullable<typeof electronApp>['firstWindow']>>;
  let tempDataDir: string;

  test.beforeEach(async () => {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-e2e-setup-'));
  });

  test.afterEach(async () => {
    if (electronApp) {
      try {
        const process = electronApp.process();
        if (!process || process.exitCode === null) {
          await electronApp.close();
        }
      } catch {
        // The app may already be closed after setup-triggered relaunch.
      }
      electronApp = null;
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
    await expect(window.locator('.setup-config__form')).toBeVisible();
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
    await portInput.fill('8099');
    await fillPassphrase('testpassphrase123');

    // Click save & start
    const appProcess = electronApp?.process();
    const appExited = appProcess
      ? new Promise<void>((resolve) => {
          if (appProcess.exitCode !== null) {
            resolve();
            return;
          }
          appProcess.once('exit', () => resolve());
        })
      : Promise.resolve();

    await Promise.all([
      window.waitForEvent('close', { timeout: 20_000 }),
      window.locator('button.setup-config__submit').click(),
    ]);
    await appExited;

    const configPath = path.join(tempDataDir, 'data', 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
      mode?: string;
      port?: number;
      secret?: string;
      encryptedSecret?: string;
    };
    expect(saved.mode).toBe('server');
    expect(saved.port).toBe(8099);
    expect(Boolean(saved.secret || saved.encryptedSecret)).toBe(true);
    electronApp = null;
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
