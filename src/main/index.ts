import { app, BrowserWindow, session, dialog, Menu, ipcMain } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loggers } from './logger';
import { AppConfig, type ServerConfig } from './config/AppConfig';
import { PocketBaseProcess } from './pocketbase/PocketBaseProcess';
import { BackupManager } from './pocketbase/BackupManager';
import { RetentionManager } from './pocketbase/RetentionManager';
import { JsonMigrator } from './migration/JsonMigrator';
import { IPC_CHANNELS } from '@shared/ipc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { validateEnv } from './env';
import { state, getDataRoot, setupIpc, setupPermissions } from './app/appState';
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

    setupWindowListeners(state.mainWindow);

    // Configure spellchecker languages
    state.mainWindow.webContents.session.setSpellCheckerLanguages(['en-US']);

    state.mainWindow.on('close', () => {
      // Close all other windows when the main window is closed
      BrowserWindow.getAllWindows().forEach((win) => {
        if (win !== state.mainWindow) win.close();
      });
    });

    const isDev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL !== undefined;

    // Set Content Security Policy
    // M5: 'unsafe-eval' in dev is intentional — only enabled when !app.isPackaged for HMR/dev tooling
    // M4: 'unsafe-inline' for style-src is an accepted risk — React and many UI libraries
    //     inject inline styles at runtime; removing it would break component rendering
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
              `script-src 'self' ${isDev ? "'unsafe-eval' 'unsafe-inline'" : "'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='"}; ` +
              "style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data: blob: https://api.weather.gov https://*.rainviewer.com; " +
              "connect-src 'self' http://127.0.0.1:* http://localhost:* https://api.weather.gov https://geocoding-api.open-meteo.com https://api.open-meteo.com https://ipapi.co https://ipinfo.io https://ipwho.is https://*.rainviewer.com https://api.zippopotam.us; " +
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

    // Resolve data root before loading the renderer
    loggers.main.info('Starting data initialization...');
    try {
      state.currentDataRoot = await getDataRoot();
      loggers.main.info('Data root:', { path: state.currentDataRoot });
    } catch (error) {
      loggers.main.error('Failed to initialize data root', { error });
    }

    // Initialize AppConfig (always available for setup screen)
    const appRoot = app.isPackaged ? process.resourcesPath : process.cwd();
    const configDataDir = join(state.currentDataRoot || app.getPath('userData'), 'data');
    state.appConfig = new AppConfig(configDataDir);

    // PocketBase startup function — called on boot if already configured, or
    // after first-time setup via IPC
    const startPocketBase = async (serverConfig: ServerConfig): Promise<boolean> => {
      if (state.pbProcess?.isRunning()) return true; // already running

      try {
        const binaryName = process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase';
        const binaryPath = app.isPackaged
          ? join(process.resourcesPath, 'pocketbase', binaryName)
          : join(appRoot, 'resources', 'pocketbase', binaryName);
        const pbDataDir = join(configDataDir, 'pb_data');
        const migrationsDir = app.isPackaged
          ? join(process.resourcesPath, 'pb_migrations')
          : join(appRoot, 'resources', 'pb_migrations');

        state.pbProcess = new PocketBaseProcess({
          binaryPath,
          dataDir: pbDataDir,
          migrationsDir,
          host: '0.0.0.0',
          port: serverConfig.port,
        });

        state.pbProcess.onCrash((error) => {
          loggers.pocketbase.error('PocketBase crashed', { error });
        });

        await state.pbProcess.start();
        loggers.pocketbase.info('PocketBase started', { url: state.pbProcess.getUrl() });

        // Create relay auth user if it doesn't exist.
        // The users collection has createRule="" (allow anyone) so no auth needed.
        // On duplicate, PocketBase returns 400 which we safely ignore.
        try {
          const adminUrl = state.pbProcess.getLocalUrl();
          const createRes = await fetch(`${adminUrl}/api/collections/users/records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: 'relay@relay.app',
              password: serverConfig.secret,
              passwordConfirm: serverConfig.secret,
            }),
          });
          if (createRes.ok) {
            loggers.pocketbase.info('Created relay auth user');
          } else {
            const body = await createRes.text();
            // 400 with "already exists" is expected on subsequent starts
            if (!body.includes('already exists')) {
              loggers.pocketbase.warn('relay user creation response', {
                status: createRes.status,
                body,
              });
            }
          }
        } catch (userErr) {
          loggers.pocketbase.warn('Failed to create relay user (may already exist)', {
            error: userErr,
          });
        }

        // Check for legacy JSON data and run migration if found
        const legacyDir = state.currentDataRoot || join(app.getPath('userData'), 'data');
        if (JsonMigrator.hasLegacyData(legacyDir)) {
          loggers.migration.info('Legacy JSON data detected, starting migration');
          try {
            const PocketBase = (await import('pocketbase')).default;
            const pb = new PocketBase(state.pbProcess.getLocalUrl());
            await pb.collection('users').authWithPassword('relay@relay.app', serverConfig.secret);
            const migrator = new JsonMigrator(pb);
            const result = await migrator.migrate(legacyDir);
            loggers.migration.info('Migration complete', {
              success: result.success,
              summary: result.summary,
              errors: result.errors,
            });
          } catch (migErr) {
            loggers.migration.error('JSON migration failed', { error: migErr });
          }
        }

        // Start backup and retention managers
        state.backupManager = new BackupManager(configDataDir);
        state.backupManager.backup();

        try {
          const PocketBase = (await import('pocketbase')).default;
          const pb = new PocketBase(state.pbProcess.getLocalUrl());
          // Authenticate so retention queries pass collection auth rules
          await pb.collection('users').authWithPassword('relay@relay.app', serverConfig.secret);
          state.retentionManager = new RetentionManager(pb);
          state.retentionManager.startSchedule();
          loggers.pocketbase.info('Backup and retention managers started');
        } catch (retErr) {
          loggers.pocketbase.error('Failed to start retention manager', { error: retErr });
        }

        return true;
      } catch (pbError) {
        loggers.pocketbase.error('Failed to start PocketBase', { error: pbError });
        return false;
      }
    };

    // Start PocketBase if already configured in server mode
    const relayConfig = state.appConfig.load();
    if (relayConfig && relayConfig.mode === 'server') {
      await startPocketBase(relayConfig as ServerConfig);
    }

    // Register PB_GET_URL and PB_GET_SECRET IPC handlers
    ipcMain.handle(IPC_CHANNELS.PB_GET_URL, () => {
      if (state.pbProcess?.isRunning()) {
        // Server mode: renderer connects to localhost, not 0.0.0.0
        return state.pbProcess.getLocalUrl();
      }
      const config = state.appConfig?.load();
      if (config?.mode === 'client') {
        return config.serverUrl;
      }
      return null;
    });

    // Start PocketBase on demand (called after first-time setup)
    ipcMain.handle(IPC_CHANNELS.PB_START, async () => {
      const config = state.appConfig?.load();
      if (!config || config.mode !== 'server') return false;
      return startPocketBase(config as ServerConfig);
    });

    ipcMain.handle(IPC_CHANNELS.PB_GET_SECRET, () => {
      const config = state.appConfig?.load();
      return config?.secret ?? null;
    });

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
    const allowedFilePath = join(__dirname, '../renderer/');
    state.mainWindow.webContents.on('will-navigate', (event, url) => {
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
    state.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      loggers.security.warn(`Blocked window.open() attempt: ${url}`);
      return { action: 'deny' };
    });

    // Context menu — spellcheck suggestions + Cut/Copy/Paste for editable fields
    state.mainWindow.webContents.on('context-menu', (_event, params) => {
      const menuItems: Electron.MenuItemConstructorOptions[] = [];

      // Spellcheck suggestions when a word is misspelled
      if (params.misspelledWord) {
        const suggestions = params.dictionarySuggestions.map((suggestion) => ({
          label: suggestion,
          click: () => state.mainWindow?.webContents.replaceMisspelling(suggestion),
        }));
        if (suggestions.length === 0) {
          menuItems.push({ label: 'No suggestions', enabled: false });
        } else {
          menuItems.push(...suggestions);
        }
        menuItems.push(
          { type: 'separator' },
          {
            label: 'Add to Dictionary',
            click: () =>
              state.mainWindow?.webContents.session.addWordToSpellCheckerDictionary(
                params.misspelledWord,
              ),
          },
          { type: 'separator' },
        );
      }

      // Standard editing actions for editable fields
      if (params.isEditable) {
        menuItems.push(
          { label: 'Cut', role: 'cut', enabled: params.editFlags.canCut },
          { label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy },
          { label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste },
          { label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll },
        );
      } else if (params.selectionText) {
        // Allow copying selected text in non-editable areas
        menuItems.push({ label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy });
      }

      if (menuItems.length > 0) {
        Menu.buildFromTemplate(menuItems).popup();
      }
    });

    state.mainWindow.on('closed', () => {
      state.mainWindow = null;
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
    const auxAllowedFilePath = join(__dirname, '../renderer/');
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
      const indexPath = join(__dirname, '../renderer/index.html');
      const url = `file://${indexPath}?popout=${route}`;
      loggers.main.info(`Loading aux window file URL: ${url}`);
      await auxWindow.loadURL(url);
    }

    // Data is managed by PocketBase — aux windows subscribe via the SDK
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
      const cleanupMaintenance = setupMaintenanceTasks();

      // Graceful shutdown: clean up file watchers, timers, etc.
      app.on('before-quit', () => {
        loggers.main.info('App quitting — cleaning up resources');
        cleanupMaintenance();
        // PocketBase cleanup
        if (state.retentionManager) {
          state.retentionManager.stop();
          state.retentionManager = null;
        }
        if (state.pbProcess) {
          state.pbProcess.stop().catch((err) => {
            loggers.pocketbase.error('Failed to stop PocketBase on quit', { error: err });
          });
          state.pbProcess = null;
        }
        if (state.offlineCache) {
          state.offlineCache.close();
          state.offlineCache = null;
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

  // Avoid top-level await — it deadlocks app.whenReady() in Electron ES modules
  // on certain macOS versions (confirmed on macOS 26). Use .catch() instead so
  // module evaluation completes synchronously and the event loop stays unblocked.
  bootstrap().catch((error_) => {
    loggers.main.error('Unexpected bootstrap failure', { error: error_ });
    app.quit();
  }); // NOSONAR: top-level await can deadlock Electron startup on some macOS versions.

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
