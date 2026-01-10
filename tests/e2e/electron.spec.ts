
import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Electron Launch', () => {
  test('app launches and shows main window', async () => {
    // Path to the main entry point (compiled)
    const mainEntry = path.join(__dirname, '../../dist/main/index.js');
    
    // Launch Electron
    const electronApp = await electron.launch({
      args: [mainEntry],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    // Capture console output
    electronApp.process().stdout?.on('data', data => 
      console.log(`[Electron stdout]: ${data}`));
    electronApp.process().stderr?.on('data', data => 
      console.error(`[Electron stderr]: ${data}`));

    // Wait for the first window
    console.log('Waiting for first window...');
    const window = await electronApp.firstWindow({ timeout: 15000 });
    console.log('Window opened, checking title...');
    
    // assert title
    const title = await window.title();
    console.log(`Window title: ${title}`);
    await expect(window).toHaveTitle(/Relay/i);

    // Check if content loaded (not blank)
    // Wait for something known in the UI, e.g., root element or body
    await window.waitForLoadState('domcontentloaded');
    const body = await window.locator('body');
    await expect(body).toBeVisible();

    // Optional: Take a screenshot
    console.log('Taking screenshot...');
    await window.screenshot({ path: 'test-results/electron-launch.png' });
    console.log('Screenshot taken.');

    // Close app
    console.log('Closing app...');
    await electronApp.close();
    console.log('App closed.');
  });
});

