import { app, BrowserWindow, session, dialog } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileManager } from './FileManager';
import { loggers } from './logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { validateEnv } from './env';
import { state, getDataRootAsync, getBundledDataPath, setupIpc, setupPermissions } from './app/appState';
import { setupMaintenanceTasks } from './app/maintenanceTasks';
import { setupWindowListeners } from './handlers/windowHandlers';

// Validate environment early 
validateEnv();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
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
    node: process.versions.node
  });

  // Windows-specific optimizations
  if (process.platform === 'win32') {
    app.commandLine.appendSwitch('disable-gpu-sandbox');
    app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
  }

  // App lifecycle
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  loggers.main.info('Waiting for Electron ready...');

  async function createWindow() {
    state.mainWindow = new BrowserWindow({
      width: 960, height: 800, minWidth: 400, minHeight: 600, center: true,
      backgroundColor: '#0B0D12', titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 12 }, show: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        experimentalFeatures: false,
        ...(process.platform === 'win32' && { spellcheck: false, enableWebSQL: false, v8CacheOptions: 'none' })
      }
    });

    setupWindowListeners(state.mainWindow);

    state.mainWindow.on('close', () => {
      // Close all other windows when the main window is closed
      BrowserWindow.getAllWindows().forEach(win => {
        if (win !== state.mainWindow) win.close();
      });
    });

    const isDev = process.env.ELECTRON_RENDERER_URL !== undefined;
    
    // Set Content Security Policy
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            `script-src 'self' ${isDev ? "'unsafe-eval' 'unsafe-inline'" : "'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='"}; ` +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: https:; " +
            "connect-src 'self' https://api.weather.gov https://geocoding-api.open-meteo.com https://ipapi.co http://ip-api.com https://ipwho.is https://*.rainviewer.com; " +
            "font-src 'self' data:; " +
            "frame-src 'self' https://www.rainviewer.com https://your-intranet;"
          ],
          'X-Content-Type-Options': ['nosniff'],
          'X-Frame-Options': ['DENY'],
          'X-XSS-Protection': ['1; mode=block'],
          'Referrer-Policy': ['strict-origin-when-cross-origin']
        }
      });
    });

    if (isDev) {
      await state.mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      const indexPath = join(__dirname, '../renderer/index.html');
      void state.mainWindow.loadFile(indexPath).catch(err => {
        loggers.main.error('Failed to load local index.html', { path: indexPath, error: err.message });
        throw err;
      });
    }

    // Initialize data asynchronously
    void (async () => {
      loggers.main.info('Starting data initialization...');
      try {
        state.currentDataRoot = await getDataRootAsync();
        loggers.main.info('Data root:', { path: state.currentDataRoot });
        if (state.mainWindow && !state.mainWindow.isDestroyed()) {
          state.fileManager = new FileManager(state.currentDataRoot, getBundledDataPath());
          state.fileManager.init();
          loggers.main.info('FileManager initialized successfully');
        }
      } catch (error) {
        loggers.main.error('Failed to initialize data', { error });
      }
    })();

    state.mainWindow.once('ready-to-show', () => {
      state.mainWindow?.show();
      state.mainWindow?.focus();
      loggers.main.debug('ready-to-show fired');
    });

    state.mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      if (params.src && !params.src.startsWith('http')) {
        loggers.security.warn(`Blocked WebView navigation to non-http URL: ${params.src}`);
        event.preventDefault();
      }
    });

    state.mainWindow.on('closed', () => {
      state.mainWindow = null;
      state.fileManager = null;
    });
  }

  async function createAuxWindow(route: string) {
    const auxWindow = new BrowserWindow({
      width: 960, height: 800,
      backgroundColor: '#0B0D12',
      title: 'Relay - On-Call Board',
      titleBarStyle: 'hidden',
      trafficLightPosition: { x: 12, y: 12 },
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    });

    setupWindowListeners(auxWindow);

    const isDev = process.env.ELECTRON_RENDERER_URL !== undefined;
    if (isDev) {
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
      void state.fileManager.readAndEmit();
    }
  }

  void (async () => {
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
      setupMaintenanceTasks(() => state.fileManager);

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) void createWindow();
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      loggers.main.error('Failed to start application', { error: errorMessage });
      dialog.showErrorBox('Critical Startup Error', errorMessage);
      app.quit();
    }
  })();

  // Global Exception Handlers
  process.on('uncaughtException', (error) => {
    loggers.main.error('Uncaught Exception', { error: error.message, stack: error.stack });
    dialog.showErrorBox('Startup Error', `Relay encountered a critical error:\n\n${error.message}`);
    app.quit();
  });

  process.on('unhandledRejection', (reason: unknown) => {
    loggers.main.error('Unhandled Rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
  });
}
