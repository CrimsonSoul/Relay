import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

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
  getPrivilegedHost,
  setPrivilegedHost,
  subscribePrivilegedSessionChanged,
  getDefaultDataPath,
  getDataRoot,
  resetDataRootCache,
  setupIpc,
  setupPermissions,
} from '../appState';
import { setupIpcHandlers } from '../../ipcHandlers';
import { setupAuthHandlers, setupAuthInterception } from '../../handlers/authHandlers';
import { setupLoggerHandlers } from '../../handlers/loggerHandlers';
import { loadConfigAsync, ensureDataDirectoryAsync } from '../../dataUtils';

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
  setPrivilegedHost(null);
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
    const runtimeListeners: ((view: unknown) => void)[] = [];
    const stopRuntimeSubscription = vi.fn();
    const runtime = {
      getView: vi.fn(() => ({ state: 'signed-out', capabilities: [] })),
      onSessionChanged: vi.fn((listener: (view: unknown) => void) => {
        runtimeListeners.push(listener);
        return stopRuntimeSubscription;
      }),
      dispose: vi.fn(),
    } as never;
    const listener = vi.fn();
    const unsubscribe = subscribePrivilegedSessionChanged(listener);

    setPrivilegedRuntime(runtime);
    expect(getPrivilegedRuntime()).toBe(runtime);
    const [runtimeListener] = runtimeListeners;
    if (!runtimeListener) throw new Error('onSessionChanged listener was never registered');
    runtimeListener({ state: 'active', capabilities: ['settings.manage'] });
    expect(listener).toHaveBeenCalledWith({
      state: 'active',
      capabilities: ['settings.manage'],
    });

    setPrivilegedRuntime(null);
    expect(stopRuntimeSubscription).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it('owns the server privileged host independently from the Electron child', () => {
    const host = {
      dispose: vi.fn(),
      approvalCodes: { subscribe: vi.fn(() => vi.fn()) },
    } as never;
    setPrivilegedHost(host);
    expect(getPrivilegedHost()).toBe(host);
    setPrivilegedHost(null);
    expect(getPrivilegedHost()).toBeNull();
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

/**
 * Shapes of the two permission callbacks `setupPermissions` registers, limited to
 * the fields these tests exercise (the session itself is a stub, not a real
 * Electron.Session).
 */
type PermissionRequestHandler = (
  webContents: { id?: number },
  permission: string,
  callback: (granted: boolean) => void,
  details: { requestingUrl: string },
) => void;
type PermissionCheckHandler = (
  webContents: { id?: number },
  permission: string,
  requestingOrigin: string,
) => boolean;

const createPermissionSession = () => ({
  setPermissionRequestHandler: vi.fn<(handler: PermissionRequestHandler) => void>(),
  setPermissionCheckHandler: vi.fn<(handler: PermissionCheckHandler) => void>(),
});

/** Returns the handler a mock was registered with, failing loudly if it never was. */
function registeredHandler<H>(mock: Mock<(handler: H) => void>): H {
  const [call] = mock.mock.calls;
  if (!call) throw new Error('Expected a handler to have been registered');
  return call[0];
}

describe('setupPermissions', () => {
  it('registers permission request and check handlers', () => {
    const mockSession = createPermissionSession();

    setupPermissions(mockSession as never);

    expect(mockSession.setPermissionRequestHandler).toHaveBeenCalled();
    expect(mockSession.setPermissionCheckHandler).toHaveBeenCalled();
  });

  it('blocks non-geo/media permissions in request handler', () => {
    const mockSession = createPermissionSession();

    setupPermissions(mockSession as never);

    const requestHandler = registeredHandler(mockSession.setPermissionRequestHandler);
    const callback = vi.fn();

    // Unknown permission should be denied
    requestHandler({}, 'clipboard-read', callback, { requestingUrl: '' });
    expect(callback).toHaveBeenCalledWith(false);
  });

  it('blocks geolocation permissions in request handler', () => {
    const mockSession = createPermissionSession();

    setupPermissions(mockSession as never);

    const requestHandler = registeredHandler(mockSession.setPermissionRequestHandler);
    const callback = vi.fn();

    requestHandler({}, 'geolocation', callback, { requestingUrl: 'https://example.com' });
    expect(callback).toHaveBeenCalledWith(false);
  });

  it('blocks media permissions in request handler even for the main window', () => {
    const mockSession = createPermissionSession();
    const webContents = { id: 1 };
    setMainWindow({ webContents } as never);

    setupPermissions(mockSession as never);

    const requestHandler = registeredHandler(mockSession.setPermissionRequestHandler);
    const callback = vi.fn();

    requestHandler(webContents, 'media', callback, { requestingUrl: 'file:///app/index.html' });
    expect(callback).toHaveBeenCalledWith(false);
  });

  it('blocks non-geo/media permissions in check handler', () => {
    const mockSession = createPermissionSession();

    setupPermissions(mockSession as never);

    const checkHandler = registeredHandler(mockSession.setPermissionCheckHandler);

    const result = checkHandler({ id: 999 }, 'clipboard-read', '');
    expect(result).toBe(false);
  });

  it('blocks geolocation permissions in check handler', () => {
    const mockSession = createPermissionSession();

    setupPermissions(mockSession as never);

    const checkHandler = registeredHandler(mockSession.setPermissionCheckHandler);

    const result = checkHandler({ id: 999 }, 'geolocation', 'https://example.com');
    expect(result).toBe(false);
  });

  it('blocks media permissions in check handler even for the main window', () => {
    const mockSession = createPermissionSession();
    const webContents = { id: 1 };
    setMainWindow({ webContents } as never);

    setupPermissions(mockSession as never);

    const checkHandler = registeredHandler(mockSession.setPermissionCheckHandler);

    const result = checkHandler(webContents, 'media', 'file:///app/index.html');
    expect(result).toBe(false);
  });
});
