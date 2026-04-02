import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
    isPackaged: false,
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('../../logger', () => ({
  loggers: {
    main: { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    security: { warn: vi.fn() },
  },
}));

vi.mock('../../ipcHandlers', () => ({
  setupIpcHandlers: vi.fn(),
}));

vi.mock('../../handlers/authHandlers', () => ({
  setupAuthHandlers: vi.fn(),
  setupAuthInterception: vi.fn(),
}));

vi.mock('../../handlers/loggerHandlers', () => ({
  setupLoggerHandlers: vi.fn(),
}));

vi.mock('../../dataUtils', () => ({
  ensureDataDirectoryAsync: vi.fn().mockResolvedValue(undefined),
  loadConfigAsync: vi.fn().mockResolvedValue({ dataRoot: '' }),
  saveConfigAsync: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../utils/pathValidation', () => ({
  validateDataPath: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../securityPolicy', () => ({
  getSecureOrigin: vi.fn((url: string) => url),
  isTrustedGeolocationOrigin: vi.fn(() => false),
}));

import {
  getMainWindow,
  setMainWindow,
  getCurrentDataRoot,
  setCurrentDataRoot,
  getAppConfig,
  setAppConfig,
  getPbProcess,
  setPbProcess,
  getBackupManager,
  setBackupManager,
  getRetentionManager,
  setRetentionManager,
  getPbClient,
  setPbClient,
  getOfflineCache,
  setOfflineCache,
  getPendingChanges,
  setPendingChanges,
  getSyncManager,
  setSyncManager,
  getDefaultDataPath,
  getDataRoot,
  resetDataRootCache,
  handleDataPathChange,
  setupIpc,
  setupPermissions,
} from '../appState';
import { setupIpcHandlers } from '../../ipcHandlers';
import { setupAuthHandlers, setupAuthInterception } from '../../handlers/authHandlers';
import { setupLoggerHandlers } from '../../handlers/loggerHandlers';
import { loadConfigAsync, ensureDataDirectoryAsync, saveConfigAsync } from '../../dataUtils';
import { validateDataPath } from '../../utils/pathValidation';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset state between tests
  setMainWindow(null);
  setCurrentDataRoot('');
  setAppConfig(null);
  setPbProcess(null);
  setBackupManager(null);
  setRetentionManager(null);
  setPbClient(null);
  setOfflineCache(null);
  setPendingChanges(null);
  setSyncManager(null);
  resetDataRootCache();
});

describe('appState getters/setters', () => {
  it('mainWindow getter/setter', () => {
    expect(getMainWindow()).toBeNull();
    const win = { webContents: {} } as never;
    setMainWindow(win);
    expect(getMainWindow()).toBe(win);
  });

  it('currentDataRoot getter/setter', () => {
    expect(getCurrentDataRoot()).toBe('');
    setCurrentDataRoot('/data/root');
    expect(getCurrentDataRoot()).toBe('/data/root');
  });

  it('appConfig getter/setter', () => {
    expect(getAppConfig()).toBeNull();
    const config = { dataRoot: '/test' } as never;
    setAppConfig(config);
    expect(getAppConfig()).toBe(config);
  });

  it('pbProcess getter/setter', () => {
    expect(getPbProcess()).toBeNull();
    const proc = { pid: 123 } as never;
    setPbProcess(proc);
    expect(getPbProcess()).toBe(proc);
  });

  it('backupManager getter/setter', () => {
    expect(getBackupManager()).toBeNull();
    const mgr = { listBackups: vi.fn() } as never;
    setBackupManager(mgr);
    expect(getBackupManager()).toBe(mgr);
  });

  it('retentionManager getter/setter', () => {
    expect(getRetentionManager()).toBeNull();
    const mgr = { run: vi.fn() } as never;
    setRetentionManager(mgr);
    expect(getRetentionManager()).toBe(mgr);
  });

  it('pbClient getter/setter', () => {
    expect(getPbClient()).toBeNull();
    const client = { authStore: {} } as never;
    setPbClient(client);
    expect(getPbClient()).toBe(client);
  });

  it('offlineCache getter/setter', () => {
    expect(getOfflineCache()).toBeNull();
    const cache = { clear: vi.fn() } as never;
    setOfflineCache(cache);
    expect(getOfflineCache()).toBe(cache);
  });

  it('pendingChanges getter/setter', () => {
    expect(getPendingChanges()).toBeNull();
    const pc = { flush: vi.fn() } as never;
    setPendingChanges(pc);
    expect(getPendingChanges()).toBe(pc);
  });

  it('syncManager getter/setter', () => {
    expect(getSyncManager()).toBeNull();
    const sm = { sync: vi.fn() } as never;
    setSyncManager(sm);
    expect(getSyncManager()).toBe(sm);
  });
});

describe('getDefaultDataPath', () => {
  it('returns userData/data path', () => {
    expect(getDefaultDataPath()).toContain('data');
  });
});

describe('getDataRoot', () => {
  it('resolves data root from config on first call', async () => {
    vi.mocked(loadConfigAsync).mockResolvedValue({ dataRoot: '/custom/data' });

    const root = await getDataRoot();

    expect(root).toBe('/custom/data');
    expect(ensureDataDirectoryAsync).toHaveBeenCalledWith('/custom/data');
  });

  it('returns cached value on subsequent calls', async () => {
    vi.mocked(loadConfigAsync).mockResolvedValue({ dataRoot: '/custom/data' });

    const root1 = await getDataRoot();
    const root2 = await getDataRoot();

    expect(root1).toBe(root2);
    // loadConfigAsync called only once
    expect(loadConfigAsync).toHaveBeenCalledTimes(1);
  });

  it('falls back to default path when config has empty dataRoot', async () => {
    vi.mocked(loadConfigAsync).mockResolvedValue({ dataRoot: '' });

    const root = await getDataRoot();

    expect(root).toContain('data');
  });
});

describe('handleDataPathChange', () => {
  it('validates, ensures directory, and saves config', async () => {
    setMainWindow({ webContents: {} } as never);

    await handleDataPathChange('/new/path');

    expect(validateDataPath).toHaveBeenCalledWith('/new/path');
    expect(ensureDataDirectoryAsync).toHaveBeenCalledWith('/new/path');
    expect(saveConfigAsync).toHaveBeenCalledWith({ dataRoot: '/new/path' });
    expect(getCurrentDataRoot()).toBe('/new/path');
  });

  it('does nothing when mainWindow is null', async () => {
    setMainWindow(null);

    await handleDataPathChange('/new/path');

    expect(validateDataPath).not.toHaveBeenCalled();
  });

  it('throws when validation fails', async () => {
    setMainWindow({ webContents: {} } as never);
    vi.mocked(validateDataPath).mockResolvedValue({ success: false, error: 'Bad path' });

    await expect(handleDataPathChange('/bad/path')).rejects.toThrow('Bad path');
  });
});

describe('setupIpc', () => {
  it('calls all IPC setup functions', () => {
    setupIpc();

    expect(setupIpcHandlers).toHaveBeenCalled();
    expect(setupAuthHandlers).toHaveBeenCalled();
    expect(setupAuthInterception).toHaveBeenCalled();
    expect(setupLoggerHandlers).toHaveBeenCalled();
  });

  it('passes createAuxWindow and restartPb to setupIpcHandlers', () => {
    const createAux = vi.fn();
    const restartPb = vi.fn();

    setupIpc(createAux, restartPb as never);

    expect(setupIpcHandlers).toHaveBeenCalledWith(
      expect.objectContaining({
        createAuxWindow: createAux,
        restartPb,
      }),
    );
  });
});

describe('setupPermissions', () => {
  it('registers permission request and check handlers', () => {
    const mockSession = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    };

    setupPermissions(mockSession as never);

    expect(mockSession.setPermissionRequestHandler).toHaveBeenCalled();
    expect(mockSession.setPermissionCheckHandler).toHaveBeenCalled();
  });

  it('blocks non-geo/media permissions in request handler', () => {
    const mockSession = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    };

    setupPermissions(mockSession as never);

    const requestHandler = mockSession.setPermissionRequestHandler.mock.calls[0][0];
    const callback = vi.fn();

    // Unknown permission should be denied
    requestHandler({}, 'clipboard-read', callback, { requestingUrl: '' });
    expect(callback).toHaveBeenCalledWith(false);
  });

  it('blocks non-geo/media permissions in check handler', () => {
    const mockSession = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    };

    setupPermissions(mockSession as never);

    const checkHandler = mockSession.setPermissionCheckHandler.mock.calls[0][0];

    const result = checkHandler({ id: 999 }, 'clipboard-read', '');
    expect(result).toBe(false);
  });
});
