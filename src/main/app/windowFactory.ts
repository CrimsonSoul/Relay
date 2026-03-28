import { app, BrowserWindow } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loggers } from '../logger';
import { getMainWindow, setMainWindow } from './appState';
import { setupWindowListeners, ALLOWED_AUX_ROUTES } from '../handlers/windowHandlers';
import { isTrustedWebviewUrl } from '../securityPolicy';
import { setupSecurityHeaders } from './securityHeaders';
import { setupContextMenu } from './contextMenu';

// Resolve to `dist/main/` so that sibling-relative paths
// (../preload, ../renderer) work identically to the original index.ts __dirname.
const mainDir = dirname(fileURLToPath(import.meta.url));

export async function createWindow(): Promise<void> {
  const isDev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL !== undefined;

  const mainWindow = new BrowserWindow({
    width: 960,
    height: 800,
    minWidth: 400,
    minHeight: 600,
    center: true,
    backgroundColor: '#060608',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 28, y: 16 },
    show: false,
    webPreferences: {
      preload: join(mainDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // L7: webviewTag is required for RadarTab functionality (embedded radar webviews)
      webviewTag: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: true,
      ...(process.platform === 'win32' && {
        enableWebSQL: false,
      }),
    },
  });
  setMainWindow(mainWindow);

  setupWindowListeners(mainWindow);

  // Configure spellchecker languages
  mainWindow.webContents.session.setSpellCheckerLanguages(['en-US']);

  mainWindow.on('close', () => {
    // Close all other windows when the main window is closed
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win !== getMainWindow()) win.close();
    });
  });

  setupSecurityHeaders(isDev);

  mainWindow.once('ready-to-show', () => {
    getMainWindow()?.show();
    getMainWindow()?.focus();
    loggers.main.debug('ready-to-show fired');
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
    const indexPath = join(mainDir, '../renderer/index.html');
    mainWindow.loadFile(indexPath).catch((err) => {
      loggers.main.error('Failed to load local index.html', {
        path: indexPath,
        error: err.message,
      });
      throw err;
    });
  }

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;

    if (!isTrustedWebviewUrl(params.src)) {
      loggers.security.warn(`Blocked WebView navigation to non-allowlisted URL: ${params.src}`);
      event.preventDefault();
    }
  });

  // Prevent the main window from navigating away (H-1: navigation hijacking defense)
  const allowedFilePath = join(mainDir, '../renderer/');
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow dev server and local file reloads
    if (isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL!)) return;
    // Only allow file:// navigation within the app's renderer directory
    if (url.startsWith('file://')) {
      const decodedUrl = decodeURIComponent(url.replace('file://', ''));
      if (decodedUrl.startsWith(allowedFilePath)) return;
    }
    loggers.security.warn(`Blocked main window navigation to: ${url}`);
    event.preventDefault();
  });

  // Block window.open() from the renderer (H-1)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    loggers.security.warn(`Blocked window.open() attempt: ${url}`);
    return { action: 'deny' };
  });

  setupContextMenu(mainWindow);

  mainWindow.on('closed', () => {
    setMainWindow(null);
  });
}

const MAX_AUX_WINDOWS = 5;
/** Track open aux windows by route so we can focus existing ones and enforce limits. */
const auxWindows = new Map<string, BrowserWindow>();

export async function createAuxWindow(route: string): Promise<void> {
  if (!ALLOWED_AUX_ROUTES.has(route)) {
    loggers.security.warn(`Blocked aux window with invalid route: ${route}`);
    return;
  }

  // If an aux window for this route already exists, focus it instead
  const existing = auxWindows.get(route);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  // Enforce max aux window limit
  // Clean up destroyed entries first
  for (const [r, win] of auxWindows) {
    if (win.isDestroyed()) auxWindows.delete(r);
  }
  if (auxWindows.size >= MAX_AUX_WINDOWS) {
    loggers.main.warn(`Aux window limit reached (${MAX_AUX_WINDOWS}), not opening: ${route}`);
    return;
  }

  const auxWindow = new BrowserWindow({
    width: 960,
    height: 800,
    backgroundColor: '#060608',
    title: 'Relay - On-Call Board',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 28, y: 16 },
    webPreferences: {
      preload: join(mainDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  setupWindowListeners(auxWindow);

  // Track aux window and clean up on close
  auxWindows.set(route, auxWindow);
  auxWindow.on('closed', () => {
    auxWindows.delete(route);
  });

  // Prevent aux window navigation hijacking
  const auxAllowedFilePath = join(mainDir, '../renderer/');
  auxWindow.webContents.on('will-navigate', (event, url) => {
    if (
      !app.isPackaged &&
      process.env.ELECTRON_RENDERER_URL &&
      url.startsWith(process.env.ELECTRON_RENDERER_URL)
    )
      return;
    if (url.startsWith('file://')) {
      const decodedUrl = decodeURIComponent(url.replace('file://', ''));
      if (decodedUrl.startsWith(auxAllowedFilePath)) return;
    }
    loggers.security.warn(`Blocked aux window navigation to: ${url}`);
    event.preventDefault();
  });
  auxWindow.webContents.setWindowOpenHandler(({ url }) => {
    loggers.security.warn(`Blocked aux window.open() attempt: ${url}`);
    return { action: 'deny' };
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = `${process.env.ELECTRON_RENDERER_URL}?popout=${route}`;
    loggers.main.info(`Loading aux window URL: ${url}`);
    await auxWindow.loadURL(url);
  } else {
    const indexPath = join(mainDir, '../renderer/index.html');
    const url = `file://${indexPath}?popout=${route}`;
    loggers.main.info(`Loading aux window file URL: ${url}`);
    await auxWindow.loadURL(url);
  }

  // Data is managed by PocketBase — aux windows subscribe via the SDK
}
