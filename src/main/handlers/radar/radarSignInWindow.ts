import { BrowserWindow } from 'electron';
import { RADAR_URL } from '@shared/radar';
import { loggers } from '../../logger';
import { describeUrlForLog } from '@shared/urlSecurity';
import { isAllowedRadarUrl, RADAR_SESSION_PARTITION } from './radarSession';

let signInWindow: BrowserWindow | null = null;

/**
 * Opens the real dashboard in a window bound to the Radar session so the user
 * can complete SSO themselves. Relay never sees the credentials — it only
 * inherits the cookie Chromium stores in the partition afterwards.
 *
 * Resolves true once the window is showing the dashboard rather than the login
 * form, which is the signal the poller can start succeeding again.
 */
export async function openRadarSignIn(onSignedIn: () => void = () => {}): Promise<boolean> {
  if (signInWindow && !signInWindow.isDestroyed()) {
    signInWindow.focus();
    return true;
  }

  const window = new BrowserWindow({
    width: 1024,
    height: 800,
    backgroundColor: '#060608',
    title: 'Sign in to CW Dashboard',
    webPreferences: {
      partition: RADAR_SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  signInWindow = window;

  // The SSO flow may bounce through an identity provider, but the window has no
  // business ending up anywhere outside those hosts.
  window.webContents.on('will-navigate', (event, url) => {
    if (isAllowedRadarUrl(url)) return;
    loggers.security.warn('Blocked Radar sign-in navigation', {
      url: describeUrlForLog(url),
    });
    event.preventDefault();
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    loggers.security.warn('Blocked Radar sign-in window.open()', {
      url: describeUrlForLog(url),
    });
    return { action: 'deny' };
  });

  // Landing back on the dashboard means the cookie is good; tell the poller to
  // try again rather than waiting out the rest of the minute.
  window.webContents.on('did-navigate', (_event, url) => {
    if (url.startsWith(RADAR_URL)) onSignedIn();
  });

  window.on('closed', () => {
    signInWindow = null;
    onSignedIn();
  });

  try {
    await window.loadURL(RADAR_URL);
    return true;
  } catch (error) {
    loggers.main.warn('Failed to open Radar sign-in window', {
      error: error instanceof Error ? error.message : String(error),
    });
    if (!window.isDestroyed()) window.destroy();
    signInWindow = null;
    return false;
  }
}

/** Test seam: drops the module-level window reference. */
export function resetRadarSignInWindow(): void {
  signInWindow = null;
}
