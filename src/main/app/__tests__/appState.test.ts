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
  getKnowledgePdfService,
  setKnowledgePdfService,
  getKnowledgeUploadService,
  setKnowledgeUploadService,
  getKnowledgeSearchService,
  setKnowledgeSearchService,
  getPrivilegedRuntime,
  setPrivilegedRuntime,
  subscribePrivilegedSessionChanged,
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
  setKnowledgePdfService(null);
  setKnowledgeUploadService(null);
  setKnowledgeSearchService(null);
  setPrivilegedRuntime(null);
  resetDataRootCache();
});

describe('appState getters/setters', () => {
  it('knowledge services getters/setters', () => {
    const pdfService = { getPdf: vi.fn() } as never;
    const uploadService = { snapshot: vi.fn() } as never;
    const searchService = { search: vi.fn(), cancel: vi.fn() } as never;

    setKnowledgePdfService(pdfService);
    setKnowledgeUploadService(uploadService);
    setKnowledgeSearchService(searchService);

    expect(getKnowledgePdfService()).toBe(pdfService);
    expect(getKnowledgeUploadService()).toBe(uploadService);
    expect(getKnowledgeSearchService()).toBe(searchService);
  });

  it('owns the privileged runtime and relays only public session views', () => {
    let runtimeListener: ((view: unknown) => void) | null = null;
    const stopRuntimeSubscription = vi.fn();
    const runtime = {
      getView: vi.fn(() => ({ state: 'signed-out', capabilities: [] })),
      onSessionChanged: vi.fn((listener) => {
        runtimeListener = listener;
        return stopRuntimeSubscription;
      }),
      dispose: vi.fn(),
    } as never;
    const listener = vi.fn();
    const unsubscribe = subscribePrivilegedSessionChanged(listener);

    setPrivilegedRuntime(runtime);
    expect(getPrivilegedRuntime()).toBe(runtime);
    runtimeListener?.({ state: 'active', capabilities: ['settings.manage'] });
    expect(listener).toHaveBeenCalledWith({
      state: 'active',
      capabilities: ['settings.manage'],
    });

    setPrivilegedRuntime(null);
    expect(stopRuntimeSubscription).toHaveBeenCalledOnce();
    unsubscribe();
  });

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

  it('does not update cached data root when saving the new path fails', async () => {
    setMainWindow({ webContents: {} } as never);
    setCurrentDataRoot('/old/path');
    vi.mocked(validateDataPath).mockResolvedValueOnce({ success: true });
    vi.mocked(saveConfigAsync).mockRejectedValueOnce(new Error('disk full'));

    await expect(handleDataPathChange('/new/path')).rejects.toThrow('disk full');

    expect(getCurrentDataRoot()).toBe('/old/path');
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

  it('passes the current authenticated PocketBase client getter to setupIpcHandlers', () => {
    const client = { authStore: { isValid: true } } as never;
    setPbClient(client);

    setupIpc();

    const options = vi.mocked(setupIpcHandlers).mock.calls[0]?.[0];
    expect(options?.getPbClient).toEqual(expect.any(Function));
    expect(options?.getPbClient?.()).toBe(client);
  });

  it('passes live knowledge service getters to setupIpcHandlers', () => {
    const pdfService = { getPdf: vi.fn() } as never;
    const searchService = { search: vi.fn() } as never;
    setKnowledgePdfService(pdfService);
    setKnowledgeSearchService(searchService);

    setupIpc();

    const options = vi.mocked(setupIpcHandlers).mock.calls[0]?.[0];
    expect(options?.getKnowledgePdfService?.()).toBe(pdfService);
    expect(options?.getKnowledgeSearchService?.()).toBe(searchService);
  });

  it('passes live privileged runtime and event getters to setupIpcHandlers', () => {
    const runtime = { getView: vi.fn(), onSessionChanged: vi.fn(() => vi.fn()) } as never;
    setPrivilegedRuntime(runtime);

    setupIpc();

    const options = vi.mocked(setupIpcHandlers).mock.calls[0]?.[0];
    expect(options?.getPrivilegedRuntime?.()).toBe(runtime);
    expect(options?.subscribePrivilegedSessionChanged).toEqual(expect.any(Function));
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

  it('blocks geolocation permissions in request handler', () => {
    const mockSession = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    };

    setupPermissions(mockSession as never);

    const requestHandler = mockSession.setPermissionRequestHandler.mock.calls[0][0];
    const callback = vi.fn();

    requestHandler({}, 'geolocation', callback, { requestingUrl: 'https://example.com' });
    expect(callback).toHaveBeenCalledWith(false);
  });

  it('blocks media permissions in request handler even for the main window', () => {
    const mockSession = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    };
    const webContents = { id: 1 };
    setMainWindow({ webContents } as never);

    setupPermissions(mockSession as never);

    const requestHandler = mockSession.setPermissionRequestHandler.mock.calls[0][0];
    const callback = vi.fn();

    requestHandler(webContents, 'media', callback, { requestingUrl: 'file:///app/index.html' });
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

  it('blocks geolocation permissions in check handler', () => {
    const mockSession = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    };

    setupPermissions(mockSession as never);

    const checkHandler = mockSession.setPermissionCheckHandler.mock.calls[0][0];

    const result = checkHandler({ id: 999 }, 'geolocation', 'https://example.com');
    expect(result).toBe(false);
  });

  it('blocks media permissions in check handler even for the main window', () => {
    const mockSession = {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
    };
    const webContents = { id: 1 };
    setMainWindow({ webContents } as never);

    setupPermissions(mockSession as never);

    const checkHandler = mockSession.setPermissionCheckHandler.mock.calls[0][0];

    const result = checkHandler(webContents, 'media', 'file:///app/index.html');
    expect(result).toBe(false);
  });
});
