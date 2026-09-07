import { app } from 'electron';
import process from 'node:process';

if (process.env.NODE_ENV !== 'test' || process.env.RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS !== '1') {
  throw new Error('The Relay Electron fixture requires the isolated test runner.');
}

if (process.platform === 'linux') {
  // Playwright selects "basic" by default; pairing needs the CI session's real keyring.
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret');
}

await import('../../dist/main/index.js');
