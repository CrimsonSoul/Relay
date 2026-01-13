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

  // Set Content Security Policy
  // In development, allow unsafe-eval for React HMR to work properly
  const isDev = process.env.ELECTRON_RENDERER_URL !== undefined;
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

  if (process.env.ELECTRON_RENDERER_URL) {
    await state.mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    const indexPath = join(__dirname, '../renderer/index.html');
    await state.mainWindow.loadFile(indexPath).catch(err => {
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
        state.fileManager = new FileManager(state.mainWindow, state.currentDataRoot, getBundledDataPath());
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

// Global Exception Handlers
process.on('uncaughtException', (error) => {
  loggers.main.error('Uncaught Exception', { error: error.message, stack: error.stack });
  dialog.showErrorBox('Startup Error', `Relay encountered a critical error:\n\n${error.message}`);
  app.quit();
});

process.on('unhandledRejection', (reason: Error | unknown) => {
  loggers.main.error('Unhandled Rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
});

// App lifecycle
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

loggers.main.info('Waiting for Electron ready...');

// PROMISE CHAIN USED INTENTIONALLY - DO NOT CHANGE TO TOP-LEVEL AWAIT
// Top-level await causes the Electron main process to hang/deadlock on Windows,
// resulting in a "zombie process" (running but no window).
// We silence the linter here to prioritize application stability.

void (async () => { // NOSONAR
  try {
    if (!app.isReady()) {
      await app.whenReady();
    }

    loggers.main.info('Electron ready, performing setup...');

    setupPermissions(session.defaultSession);
    setupPermissions(session.fromPartition('persist:weather'));
    setupPermissions(session.fromPartition('persist:dispatcher-radar'));

    setupIpc();
    await createWindow();
    setupMaintenanceTasks(() => state.fileManager);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  } catch (error: Error | unknown) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    loggers.main.error('Failed to start application', { error: errorMessage });
    dialog.showErrorBox('Critical Startup Error', errorMessage);
    app.quit();
  }
})();
