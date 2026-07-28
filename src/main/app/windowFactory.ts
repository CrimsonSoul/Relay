import { app, BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loggers } from '../logger';
import { isAllowedRendererFileUrl } from '../utils/trustedSender';
import { getMainWindow, setMainWindow } from './appState';
import { setupWindowListeners } from '../handlers/windowHandlers';
import { setupSecurityHeaders } from './securityHeaders';
import { setupContextMenu } from './contextMenu';
import { attachWindowLifecycleListeners } from './processLifecycle';
import { describeUrlForLog } from '@shared/urlSecurity';
import { configureWindowsTaskbarWindow } from './windowsTaskbarIdentity';

// Resolve to `dist/main/` so that sibling-relative paths
// (../preload, ../renderer) work identically to the original index.ts __dirname.
const mainDir = dirname(fileURLToPath(import.meta.url));

// Re-exported so existing call sites and tests keep working after the move.
export { isAllowedRendererFileUrl };

export function isAllowedDevRendererUrl(url: string, rendererUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(rendererUrl).origin;
  } catch {
    return false;
  }
}

const LOCKED_ZOOM_FACTOR = 1;
const DEFAULT_MAIN_WINDOW_SIZE = { width: 960, height: 800 };
const MAIN_WINDOW_REVEAL_FALLBACK_MS = 4_000;
const ZOOM_SHORTCUT_KEYS = new Set(['+', '=', '-', '_', '0']);
const ZOOM_SHORTCUT_CODES = new Set([
  'Equal',
  'Minus',
  'Digit0',
  'NumpadAdd',
  'NumpadSubtract',
  'Numpad0',
]);

function isZoomShortcut(input: Electron.Input): boolean {
  if (input.type !== 'keyDown') return false;
  if (!input.control && !input.meta) return false;
  return ZOOM_SHORTCUT_KEYS.has(input.key) || ZOOM_SHORTCUT_CODES.has(input.code);
}

function lockWindowZoom(window: BrowserWindow): void {
  const applyLockedZoom = () => {
    window.webContents.setZoomFactor(LOCKED_ZOOM_FACTOR);
    void window.webContents
      .setVisualZoomLevelLimits(LOCKED_ZOOM_FACTOR, LOCKED_ZOOM_FACTOR)
      .catch((error) => {
        loggers.main.warn('Failed to lock visual zoom level', { error });
      });
  };

  applyLockedZoom();
  window.webContents.on('did-finish-load', applyLockedZoom);
  window.webContents.on('before-input-event', (event, input) => {
    if (!isZoomShortcut(input)) return;
    event.preventDefault();
    applyLockedZoom();
  });
}

function getDevTestWindowSize(): { width: number; height: number } | null {
  if (app.isPackaged) return null;

  const value = process.env.RELAY_TEST_WINDOW_SIZE?.trim();
  if (!value) return null;

  const match = /^(\d{3,5})x(\d{3,5})$/i.exec(value);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < 400 || height < 600 || width > 4096 || height > 4096) return null;

  return { width, height };
}

/**
 * Make an existing Relay window visible and foreground it. This is shared by
 * startup and second-instance handling so a hidden window can never become an
 * unreachable single-instance process.
 */
export function showAndFocusWindow(window: BrowserWindow | null, reason: string): boolean {
  if (!window || window.isDestroyed()) return false;

  if (window.isMinimized()) window.restore();
  if (!window.isVisible()) window.show();
  window.focus();

  loggers.main.info('Main window presented', {
    reason,
    visible: window.isVisible(),
    minimized: window.isMinimized(),
  });
  return true;
}

async function loadMainWindowRenderer(mainWindow: BrowserWindow, isDev: boolean): Promise<void> {
  if (isDev) {
    try {
      await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!);
    } catch (err) {
      loggers.main.error('Failed to load development renderer', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
    return;
  }

  const indexPath = join(mainDir, '../renderer/index.html');
  try {
    await mainWindow.loadFile(indexPath);
  } catch (err) {
    loggers.main.error('Failed to load local index.html', {
      path: indexPath,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export type CreateWindowOptions = Readonly<{
  onWindowCreated?: () => void;
  onShellReady?: () => void;
}>;

export async function createWindow(options: CreateWindowOptions = {}): Promise<void> {
  const isDev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL !== undefined;
  const devTestWindowSize = getDevTestWindowSize();

  const mainWindow = new BrowserWindow({
    width: devTestWindowSize?.width ?? DEFAULT_MAIN_WINDOW_SIZE.width,
    height: devTestWindowSize?.height ?? DEFAULT_MAIN_WINDOW_SIZE.height,
    minWidth: 400,
    minHeight: 600,
    ...(devTestWindowSize && { useContentSize: true }),
    center: true,
    backgroundColor: '#060608',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 24, y: 16 },
    show: false,
    webPreferences: {
      preload: join(mainDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: true,
      ...(process.platform === 'win32' && {
        enableWebSQL: false,
      }),
    },
  });
  configureWindowsTaskbarWindow(mainWindow, {
    platform: process.platform,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
  });
  setMainWindow(mainWindow);
  loggers.main.info('Main window created', {
    width: devTestWindowSize?.width ?? DEFAULT_MAIN_WINDOW_SIZE.width,
    height: devTestWindowSize?.height ?? DEFAULT_MAIN_WINDOW_SIZE.height,
    initiallyVisible: mainWindow.isVisible(),
  });
  options.onWindowCreated?.();
  mainWindow.webContents.once('dom-ready', () => options.onShellReady?.());

  let windowPresented = false;
  let revealFallback: NodeJS.Timeout | null = null;
  const presentWindow = (reason: string) => {
    if (windowPresented) return;
    windowPresented = showAndFocusWindow(mainWindow, reason);
    if (windowPresented && revealFallback) {
      clearTimeout(revealFallback);
      revealFallback = null;
    }
  };

  revealFallback = setTimeout(() => {
    loggers.main.warn('Main window reveal fallback elapsed', {
      timeoutMs: MAIN_WINDOW_REVEAL_FALLBACK_MS,
    });
    presentWindow('startup-timeout');
  }, MAIN_WINDOW_REVEAL_FALLBACK_MS);
  revealFallback.unref();

  lockWindowZoom(mainWindow);

  setupWindowListeners(mainWindow);
  attachWindowLifecycleListeners(mainWindow, { label: 'main', autoReload: true });

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
    loggers.main.info('Main window ready-to-show');
    presentWindow('ready-to-show');
  });

  try {
    await loadMainWindowRenderer(mainWindow, isDev);
    loggers.main.info('Main window renderer loaded');
    presentWindow('renderer-loaded');
  } catch (err) {
    if (revealFallback) {
      clearTimeout(revealFallback);
      revealFallback = null;
    }
    throw err;
  }

  // Prevent the main window from navigating away (H-1: navigation hijacking defense)
  const allowedFilePath = join(mainDir, '../renderer');
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow dev server and local file reloads
    if (isDev && isAllowedDevRendererUrl(url, process.env.ELECTRON_RENDERER_URL!)) return;
    if (isAllowedRendererFileUrl(url, allowedFilePath)) return;
    loggers.security.warn(`Blocked main window navigation to: ${describeUrlForLog(url)}`);
    event.preventDefault();
  });

  // Block window.open() from the renderer (H-1)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    loggers.security.warn(`Blocked window.open() attempt: ${describeUrlForLog(url)}`);
    return { action: 'deny' };
  });

  setupContextMenu(mainWindow);

  mainWindow.on('closed', () => {
    if (revealFallback) clearTimeout(revealFallback);
    setMainWindow(null);
  });
}
