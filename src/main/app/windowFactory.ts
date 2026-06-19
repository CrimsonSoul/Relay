import { app, BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loggers } from '../logger';
import { isAllowedRendererFileUrl } from '../utils/trustedSender';
import { getMainWindow, setMainWindow } from './appState';
import { setupWindowListeners, ALLOWED_AUX_ROUTES } from '../handlers/windowHandlers';
import { setupSecurityHeaders } from './securityHeaders';
import { setupContextMenu } from './contextMenu';
import { attachWindowLifecycleListeners } from './processLifecycle';
import { describeUrlForLog } from '@shared/urlSecurity';

// Resolve to `dist/main/` so that sibling-relative paths
// (../preload, ../renderer) work identically to the original index.ts __dirname.
const mainDir = dirname(fileURLToPath(import.meta.url));

// Re-exported so existing call sites and tests keep working after the move.
export { isAllowedRendererFileUrl };

export function buildRendererPopoutFileUrl(indexPath: string, route: string): string {
  const url = pathToFileURL(indexPath);
  url.searchParams.set('popout', route);
  return url.href;
}

export function isAllowedDevRendererUrl(url: string, rendererUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(rendererUrl).origin;
  } catch {
    return false;
  }
}

const LOCKED_ZOOM_FACTOR = 1;
const DEFAULT_MAIN_WINDOW_SIZE = { width: 960, height: 800 };
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

export async function createWindow(): Promise<void> {
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
  setMainWindow(mainWindow);
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
    getMainWindow()?.show();
    getMainWindow()?.focus();
    loggers.main.debug('ready-to-show fired');
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!);
  } else {
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
    trafficLightPosition: { x: 24, y: 16 },
    webPreferences: {
      preload: join(mainDir, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  setupWindowListeners(auxWindow);
  lockWindowZoom(auxWindow);
  attachWindowLifecycleListeners(auxWindow, { label: `aux:${route}`, autoReload: true });

  // Track aux window and clean up on close
  auxWindows.set(route, auxWindow);
  auxWindow.on('closed', () => {
    auxWindows.delete(route);
  });

  // Prevent aux window navigation hijacking
  const auxAllowedFilePath = join(mainDir, '../renderer');
  auxWindow.webContents.on('will-navigate', (event, url) => {
    if (
      !app.isPackaged &&
      process.env.ELECTRON_RENDERER_URL &&
      isAllowedDevRendererUrl(url, process.env.ELECTRON_RENDERER_URL)
    )
      return;
    if (isAllowedRendererFileUrl(url, auxAllowedFilePath)) return;
    loggers.security.warn(`Blocked aux window navigation to: ${describeUrlForLog(url)}`);
    event.preventDefault();
  });
  auxWindow.webContents.setWindowOpenHandler(({ url }) => {
    loggers.security.warn(`Blocked aux window.open() attempt: ${describeUrlForLog(url)}`);
    return { action: 'deny' };
  });

  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    const url = `${process.env.ELECTRON_RENDERER_URL}?popout=${route}`;
    loggers.main.info(`Loading aux window URL: ${url}`);
    await auxWindow.loadURL(url);
  } else {
    const indexPath = join(mainDir, '../renderer/index.html');
    const url = buildRendererPopoutFileUrl(indexPath, route);
    loggers.main.info(`Loading aux window file URL: ${url}`);
    await auxWindow.loadURL(url);
  }

  // Data is managed by PocketBase — aux windows subscribe via the SDK
}
