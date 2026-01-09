import { app, BrowserWindow, session } from 'electron';
import { join } from 'path';
import { FileManager } from './FileManager';
import { loggers } from './logger';
import { validateEnv } from './env';
import { state, getDataRootAsync, getBundledDataPath, setupIpc, setupPermissions } from './app/appState';

// Validate environment early
validateEnv();
import { setupMaintenanceTasks } from './app/maintenanceTasks';

// Windows-specific optimizations
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-v8-code-cache');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-software-rasterizer');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
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

  // Set Content Security Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "img-src 'self' data: https:; " +
          "connect-src 'self' https://api.weather.gov https://geocoding-api.open-meteo.com https://ipapi.co; " +
          "font-src 'self' data:; " +
          "frame-src 'none'"
        ],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'X-XSS-Protection': ['1; mode=block'],
        'Referrer-Policy': ['strict-origin-when-cross-origin']
      }
    });
  });

  if (process.env.ELECTRON_RENDERER_URL) await state.mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await state.mainWindow.loadFile(join(__dirname, '../renderer/index.html'));

  // Initialize data asynchronously
  (async () => {
    loggers.main.info('Starting data initialization...');
    try {
      state.currentDataRoot = await getDataRootAsync();
      loggers.main.info('Data root:', { path: state.currentDataRoot });
      if (state.mainWindow && !state.mainWindow.isDestroyed()) {
        state.fileManager = new FileManager(state.mainWindow, state.currentDataRoot, getBundledDataPath());
        // Initialize BEFORE triggering file watcher to avoid race conditions
        state.fileManager.init();
        loggers.main.info('FileManager initialized successfully');
      }
    } catch (error) {
      loggers.main.error('Failed to initialize data', { error });
    }
  })();

  state.mainWindow.once('ready-to-show', () => { state.mainWindow?.show(); state.mainWindow?.focus(); loggers.main.debug('ready-to-show fired'); });

  state.mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    if (params.src && !params.src.startsWith('http')) { loggers.security.warn(`Blocked WebView navigation to non-http URL: ${params.src}`); event.preventDefault(); }
  });

  state.mainWindow.on('closed', () => { state.mainWindow = null; state.fileManager = null; });
}

// Auth interception is set up in appState.ts to avoid circular dependency

app.whenReady().then(async () => {
  setupPermissions(session.defaultSession);
  setupPermissions(session.fromPartition('persist:weather'));
  setupPermissions(session.fromPartition('persist:dispatcher-radar'));
  setupIpc();
  await createWindow();
  setupMaintenanceTasks(() => state.fileManager);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
