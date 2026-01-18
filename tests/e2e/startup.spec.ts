
import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('Startup Robustness', () => {
  test('app launches immediately (detects startup hangs)', async () => {
    // This test has a strict timeout to catch "zombie process" issues
    // where the app runs but fails to show a window due to top-level await deadlocks.
    
    test.setTimeout(10000); // Fail whole test if > 10s

    const mainEntry = path.join(__dirname, '../../dist/main/index.js');
    
    // Launch Electron with 'test' environment (important for some internal logic)
    const electronApp = await electron.launch({
      args: [mainEntry],
      env: { ...process.env, NODE_ENV: 'test' }
    });

    try {
      // We expect the window to appear very quickly (< 5s) usually.
      // If it takes longer, it might be hanging or extremely slow.
      console.log('Waiting for window (strict check)...');
      
      const window = await electronApp.firstWindow({ timeout: 5000 });
      
      const title = await window.title();
      expect(title).toMatch(/Relay/i);
      
      const isVisible = await window.isVisible('body');
      expect(isVisible).toBe(true);
      
    } finally {
      await electronApp.close();
    }
  });
});
