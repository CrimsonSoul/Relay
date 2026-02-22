import { app, BrowserWindow, session, dialog } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileManager } from './FileManager';
import { loggers } from './logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { validateEnv } from './env';
import { state, getDataRoot, getBundledDataPath, setupIpc, setupPermissions } from './app/appState';
import { setupMaintenanceTasks } from './app/maintenanceTasks';
import { setupWindowListeners, ALLOWED_AUX_ROUTES } from './handlers/windowHandlers';
import { isTrustedWebviewUrl } from './securityPolicy';

// Ensure a consistent userData path for portable builds on Windows.
// Without this, portable .exe instances launched from different locations
// may resolve to different userData dirs and bypass the single-instance lock.
if (process.platform === 'win32') {
  const portableUserData = join(app.getPath('appData'), 'Relay');
  app.setPath('userData', portableUserData);
}

// Validate environment early
validateEnv();

const gotLock = app.requestSingleInstanceLock();
if (gotLock) {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, we should focus our window.
    if (state.mainWindow) {
      if (state.mainWindow.isMinimized()) state.mainWindow.restore();
      state.mainWindow.focus();
    }
  });

  loggers.main.info('Startup Info:', {
    arch: process.arch,
    platform: process.platform,
    electron: process.versions.electron,
    node: process.versions.node,
  });

  // Windows-specific optimizations
  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
  }

  // App lifecycle
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  loggers.main.info('Waiting for Electron ready...');

  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') return;

    contents.on('will-navigate', (event, url) => {
      if (isTrustedWebviewUrl(url)) return;
      loggers.security.warn(`Blocked webview navigation to non-allowlisted URL: ${url}`);
      event.preventDefault();
    });

    contents.setWindowOpenHandler(({ url }) => {
      loggers.security.warn(`Blocked webview window.open() attempt: ${url}`);
      return { action: 'deny' };
    });
  });

  async function createWindow() {
    state.mainWindow = new BrowserWindow({
      width: 960,
      height: 800,
      minWidth: 400,
      minHeight: 600,
      center: true,
      backgroundColor: '#060608',
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 12 },
      show: false,
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        ...(process.platform === 'win32' && {
          spellcheck: false,
          enableWebSQL: false,
        }),
      },
    });

    setupWindowListeners(state.mainWindow);

    state.mainWindow.on('close', () => {
      // Close all other windows when the main window is closed
      BrowserWindow.getAllWindows().forEach((win) => {
        if (win !== state.mainWindow) win.close();
      });
    });

    const isDev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL !== undefined;

    // Set Content Security Policy
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
              `script-src 'self' ${isDev ? "'unsafe-eval' 'unsafe-inline'" : "'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='"}; ` +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: https://api.weather.gov https://*.rainviewer.com; " +
              "connect-src 'self' https://api.weather.gov https://geocoding-api.open-meteo.com https://api.open-meteo.com https://ipapi.co https://ipinfo.io https://ipwho.is https://*.rainviewer.com https://api.zippopotam.us; " +
              "font-src 'self' data:; " +
              "frame-src 'self' https://www.rainviewer.com https://chatgpt.com https://claude.ai https://copilot.microsoft.com https://gemini.google.com; " +
              "object-src 'none'; " +
              "base-uri 'self'; " +
              "form-action 'self';",
          ],
          'X-Content-Type-Options': ['nosniff'],
          'X-Frame-Options': ['DENY'],
          'X-XSS-Protection': ['1; mode=block'],
          'Referrer-Policy': ['strict-origin-when-cross-origin'],
        },
      });
    });

    // Initialize data BEFORE loading the renderer so IPC handlers have
    // a ready FileManager when the renderer starts making requests.
    loggers.main.info('Starting data initialization...');
    try {
      state.currentDataRoot = await getDataRoot();
      loggers.main.info('Data root:', { path: state.currentDataRoot });
      state.fileManager = new FileManager(state.currentDataRoot, getBundledDataPath());
      state.fileManager.init();
      loggers.main.info('FileManager initialized successfully');
    } catch (error) {
      loggers.main.error('Failed to initialize data', { error });
    }

    state.mainWindow.once('ready-to-show', () => {
      state.mainWindow?.show();
      state.mainWindow?.focus();
      loggers.main.debug('ready-to-show fired');
    });

    if (isDev) {
      await state.mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL!);
    } else {
      const indexPath = join(__dirname, '../renderer/index.html');
      state.mainWindow.loadFile(indexPath).catch((err) => {
        loggers.main.error('Failed to load local index.html', {
          path: indexPath,
          error: err.message,
        });
        throw err;
      });
    }

    state.mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
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
    state.mainWindow.webContents.on('will-navigate', (event, url) => {
      // Allow dev server and local file reloads
      if (isDev && url.startsWith(process.env.ELECTRON_RENDERER_URL!)) return;
      if (url.startsWith('file://')) return;
      loggers.security.warn(`Blocked main window navigation to: ${url}`);
      event.preventDefault();
    });

    // Block window.open() from the renderer (H-1)
    state.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      loggers.security.warn(`Blocked window.open() attempt: ${url}`);
      return { action: 'deny' };
    });

    state.mainWindow.on('closed', () => {
      state.mainWindow = null;
      if (state.fileManager) {
        state.fileManager.destroy();
        state.fileManager = null;
      }
    });
  }

  async function createAuxWindow(route: string) {
    if (!ALLOWED_AUX_ROUTES.has(route)) {
      loggers.security.warn(`Blocked aux window with invalid route: ${route}`);
      return;
    }
    const auxWindow = new BrowserWindow({
      width: 960,
      height: 800,
      backgroundColor: '#060608',
      title: 'Relay - On-Call Board',
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 12 },
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    });

    setupWindowListeners(auxWindow);

    // Prevent aux window navigation hijacking
    auxWindow.webContents.on('will-navigate', (event, url) => {
      if (
        !app.isPackaged &&
        process.env.ELECTRON_RENDERER_URL &&
        url.startsWith(process.env.ELECTRON_RENDERER_URL)
      )
        return;
      if (url.startsWith('file://')) return;
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
      const indexPath = join(__dirname, '../renderer/index.html');
      const url = `file://${indexPath}?popout=${route}`;
      loggers.main.info(`Loading aux window file URL: ${url}`);
      await auxWindow.loadURL(url);
    }

    // Emit current data to the new window
    if (state.fileManager) {
      await state.fileManager.readAndEmit();
    }
  }

  const bootstrap = async () => {
    try {
      if (!app.isReady()) {
        await app.whenReady();
      }

      loggers.main.info('Electron ready, performing setup...');

      setupPermissions(session.defaultSession);
      setupPermissions(session.fromPartition('persist:weather'));
      setupPermissions(session.fromPartition('persist:dispatcher-radar'));

      setupIpc(createAuxWindow);
      await createWindow();
      const cleanupMaintenance = setupMaintenanceTasks(() => state.fileManager);

      // Graceful shutdown: clean up file watchers, timers, etc.
      app.on('before-quit', () => {
        loggers.main.info('App quitting — cleaning up resources');
        cleanupMaintenance();
        if (state.fileManager) {
          state.fileManager.destroy();
          state.fileManager = null;
        }
      });

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow().catch((error_) => {
            loggers.main.error('Failed to create window on app activate', { error: error_ });
          });
        }
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      loggers.main.error('Failed to start application', { error: errorMessage });
      dialog.showErrorBox('Critical Startup Error', errorMessage);
      app.quit();
    }
  };

  try {
    await bootstrap();
  } catch (error_) {
    loggers.main.error('Unexpected bootstrap failure', { error: error_ });
    app.quit();
  }

  // Global Exception Handlers
  process.on('uncaughtException', (error) => {
    loggers.main.error('Uncaught Exception', { error: error.message, stack: error.stack });
    dialog.showErrorBox('Startup Error', `Relay encountered a critical error:\n\n${error.message}`);
    app.quit();
  });

  process.on('unhandledRejection', (reason: unknown) => {
    loggers.main.error('Unhandled Rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
} else {
  app.quit();
}
