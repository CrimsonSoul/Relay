import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appConfig: {
    load: vi.fn(),
  },
  retentionManager: {
    stop: vi.fn(),
  },
  pbProcess: {
    stop: vi.fn(),
  },
  offlineCache: {
    close: vi.fn(),
  },
  pendingChanges: {
    close: vi.fn(),
  },
  mainWindow: {
    isDestroyed: vi.fn(() => false),
    webContents: {
      reloadIgnoringCache: vi.fn(),
    },
  },
  getAppConfig: vi.fn(),
  getRetentionManager: vi.fn(),
  setRetentionManager: vi.fn(),
  setBackupManager: vi.fn(),
  setPbClient: vi.fn(),
  getPbClient: vi.fn(),
  getOfflineCache: vi.fn(),
  setOfflineCache: vi.fn(),
  getPendingChanges: vi.fn(),
  setPendingChanges: vi.fn(),
  setSyncManager: vi.fn(),
  getPbProcess: vi.fn(),
  setPbProcess: vi.fn(),
  getMainWindow: vi.fn(),
  dynatraceProblemsManager: {
    start: vi.fn(),
    stop: vi.fn(),
  },
  getDynatraceProblemsManager: vi.fn(),
  cloudStatusManager: {
    start: vi.fn(),
    stop: vi.fn(),
  },
  getCloudStatusManager: vi.fn(),
  startPocketBase: vi.fn(),
  syncPbClient: {
    collection: vi.fn(),
  },
  authWithPassword: vi.fn(),
  PocketBase: vi.fn(),
  offlineCacheInstance: { kind: 'offline-cache', close: vi.fn() },
  pendingChangesInstance: { kind: 'pending-changes', close: vi.fn(), getAll: vi.fn(() => []) },
  syncManagerInstance: { kind: 'sync-manager' },
  OfflineCache: vi.fn(),
  PendingChanges: vi.fn(),
  SyncManager: vi.fn(),
  initializeKnowledgePdfService: vi.fn(),
  startKnowledgeBaseManager: vi.fn(),
  stopKnowledgeBaseManager: vi.fn(),
  privilegedRuntime: { dispose: vi.fn() },
  nextPrivilegedRuntime: { dispose: vi.fn() },
  getPrivilegedRuntime: vi.fn(),
  setPrivilegedRuntime: vi.fn(),
  createProductionPrivilegedRuntime: vi.fn(),
  serverPbClient: { authStore: { isValid: true } },
}));

vi.mock('../appState', () => ({
  getAppConfig: mocks.getAppConfig,
  getRetentionManager: mocks.getRetentionManager,
  setRetentionManager: mocks.setRetentionManager,
  setBackupManager: mocks.setBackupManager,
  setPbClient: mocks.setPbClient,
  getPbClient: mocks.getPbClient,
  getOfflineCache: mocks.getOfflineCache,
  setOfflineCache: mocks.setOfflineCache,
  getPendingChanges: mocks.getPendingChanges,
  setPendingChanges: mocks.setPendingChanges,
  setSyncManager: mocks.setSyncManager,
  getPbProcess: mocks.getPbProcess,
  setPbProcess: mocks.setPbProcess,
  getMainWindow: mocks.getMainWindow,
  getDynatraceProblemsManager: mocks.getDynatraceProblemsManager,
  getCloudStatusManager: mocks.getCloudStatusManager,
  getPrivilegedRuntime: mocks.getPrivilegedRuntime,
  setPrivilegedRuntime: mocks.setPrivilegedRuntime,
}));

vi.mock('../pocketbaseBootstrap', () => ({
  startPocketBase: mocks.startPocketBase,
}));

vi.mock('pocketbase', () => ({
  default: mocks.PocketBase,
}));

vi.mock('../../cache/OfflineCache', () => ({
  OfflineCache: mocks.OfflineCache,
}));

vi.mock('../../cache/PendingChanges', () => ({
  PendingChanges: mocks.PendingChanges,
}));

vi.mock('../../cache/SyncManager', () => ({
  SyncManager: mocks.SyncManager,
}));

vi.mock('../../knowledge/knowledgeRuntime', () => ({
  initializeKnowledgePdfService: mocks.initializeKnowledgePdfService,
  startKnowledgeBaseManager: mocks.startKnowledgeBaseManager,
  stopKnowledgeBaseManager: mocks.stopKnowledgeBaseManager,
}));

vi.mock('../../privileged/privilegedRuntime', () => ({
  createProductionPrivilegedRuntime: mocks.createProductionPrivilegedRuntime,
}));

describe('reconfigureRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appConfig.load.mockReturnValue({
      mode: 'client',
      serverUrl: 'https://relay.example.com',
      secret: 'super-secret-passphrase',
    });
    mocks.getAppConfig.mockReturnValue(mocks.appConfig);
    mocks.getRetentionManager.mockReturnValue(mocks.retentionManager);
    mocks.getOfflineCache.mockReturnValue(mocks.offlineCache);
    mocks.getPendingChanges.mockReturnValue(mocks.pendingChanges);
    mocks.getCloudStatusManager.mockReturnValue(mocks.cloudStatusManager);
    mocks.getPbProcess.mockReturnValue(mocks.pbProcess);
    mocks.getMainWindow.mockReturnValue(mocks.mainWindow);
    mocks.getDynatraceProblemsManager.mockReturnValue(mocks.dynatraceProblemsManager);
    mocks.getPrivilegedRuntime.mockReturnValue(mocks.privilegedRuntime);
    mocks.getPbClient.mockReturnValue(mocks.serverPbClient);
    mocks.createProductionPrivilegedRuntime.mockResolvedValue(mocks.nextPrivilegedRuntime);
    mocks.pbProcess.stop.mockResolvedValue(undefined);
    mocks.startPocketBase.mockResolvedValue(true);
    mocks.offlineCacheInstance.close.mockClear();
    mocks.pendingChangesInstance.close.mockClear();
    mocks.authWithPassword.mockResolvedValue({});
    mocks.syncPbClient.collection.mockReturnValue({ authWithPassword: mocks.authWithPassword });
    mocks.PocketBase.mockImplementation(
      class MockPocketBase {
        constructor() {
          return mocks.syncPbClient;
        }
      } as never,
    );
    mocks.OfflineCache.mockImplementation(
      class MockOfflineCache {
        constructor() {
          return mocks.offlineCacheInstance;
        }
      } as never,
    );
    mocks.PendingChanges.mockImplementation(
      class MockPendingChanges {
        constructor() {
          return mocks.pendingChangesInstance;
        }
      } as never,
    );
    mocks.SyncManager.mockImplementation(
      class MockSyncManager {
        constructor() {
          return mocks.syncManagerInstance;
        }
      } as never,
    );
  });

  it('switches to client mode without relaunching or closing the window', async () => {
    const { reconfigureRuntime } = await import('../runtimeReconfigure');

    await reconfigureRuntime('/Users/test/RelayData/data');

    expect(mocks.retentionManager.stop).toHaveBeenCalledOnce();
    expect(mocks.setRetentionManager).toHaveBeenCalledWith(null);
    expect(mocks.setBackupManager).toHaveBeenCalledWith(null);
    expect(mocks.setPbClient).toHaveBeenCalledWith(null);
    expect(mocks.offlineCache.close).toHaveBeenCalledOnce();
    expect(mocks.setOfflineCache).toHaveBeenCalledWith(null);
    expect(mocks.pendingChanges.close).toHaveBeenCalledOnce();
    expect(mocks.setPendingChanges).toHaveBeenCalledWith(null);
    expect(mocks.setSyncManager).toHaveBeenCalledWith(null);
    expect(mocks.privilegedRuntime.dispose).toHaveBeenCalledOnce();
    expect(mocks.setPrivilegedRuntime).toHaveBeenNthCalledWith(1, null);
    expect(mocks.pbProcess.stop).toHaveBeenCalledOnce();
    expect(mocks.setPbProcess).toHaveBeenCalledWith(null);
    expect(mocks.startPocketBase).not.toHaveBeenCalled();
    expect(mocks.stopKnowledgeBaseManager).toHaveBeenCalledOnce();
    expect(mocks.initializeKnowledgePdfService).toHaveBeenCalledWith('/Users/test/RelayData/data');
    expect(mocks.startKnowledgeBaseManager).not.toHaveBeenCalled();
    expect(mocks.mainWindow.webContents.reloadIgnoringCache).toHaveBeenCalledOnce();
    expect(mocks.createProductionPrivilegedRuntime).toHaveBeenCalledWith({
      config: expect.objectContaining({ mode: 'client' }),
      dataDir: '/Users/test/RelayData/data',
      serverClient: null,
      dynatraceProblemsManager: mocks.dynatraceProblemsManager,
    });
    expect(mocks.setPrivilegedRuntime).toHaveBeenLastCalledWith(mocks.nextPrivilegedRuntime);
  });

  it('waits for privileged work to stop before replacing shared runtime state', async () => {
    let finishDisposal: (() => void) | undefined;
    mocks.privilegedRuntime.dispose.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishDisposal = resolve;
        }),
    );
    const { reconfigureRuntime } = await import('../runtimeReconfigure');

    const reconfiguration = reconfigureRuntime('/Users/test/RelayData/data');
    await vi.waitFor(() => expect(mocks.privilegedRuntime.dispose).toHaveBeenCalledOnce());
    expect(mocks.setPbClient).not.toHaveBeenCalled();

    finishDisposal?.();
    await reconfiguration;
    expect(mocks.setPbClient).toHaveBeenCalledWith(null);
  });

  it('starts the knowledge index only after server PocketBase restarts', async () => {
    mocks.appConfig.load.mockReturnValue({
      mode: 'server',
      port: 8090,
      bindHost: '0.0.0.0',
      secret: 'super-secret-passphrase',
    });
    const { reconfigureRuntime } = await import('../runtimeReconfigure');

    await reconfigureRuntime('/Users/test/RelayData/data');

    expect(mocks.stopKnowledgeBaseManager).toHaveBeenCalledOnce();
    expect(mocks.startPocketBase).toHaveBeenCalledOnce();
    expect(mocks.initializeKnowledgePdfService).toHaveBeenCalledWith('/Users/test/RelayData/data');
    expect(mocks.startKnowledgeBaseManager).toHaveBeenCalledWith('/Users/test/RelayData/data');
    expect(mocks.startPocketBase.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startKnowledgeBaseManager.mock.invocationCallOrder[0] as number,
    );
    expect(mocks.startPocketBase.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createProductionPrivilegedRuntime.mock.invocationCallOrder[0] as number,
    );
  });

  it('rebuilds client-mode offline infrastructure during runtime reconfigure', async () => {
    const { reconfigureRuntime } = await import('../runtimeReconfigure');

    await reconfigureRuntime('/Users/test/RelayData/data');

    expect(mocks.PocketBase).toHaveBeenCalledWith('https://relay.example.com');
    expect(mocks.authWithPassword).toHaveBeenCalledWith(
      'relay@relay.app',
      'super-secret-passphrase',
      expect.objectContaining({ requestKey: null }),
    );
    expect(mocks.OfflineCache).toHaveBeenCalledWith('/Users/test/RelayData/data/cache.db');
    expect(mocks.PendingChanges).toHaveBeenCalledWith('/Users/test/RelayData/data/cache.db');
    expect(mocks.SyncManager).toHaveBeenCalledWith(mocks.syncPbClient);
    expect(mocks.setOfflineCache).toHaveBeenLastCalledWith(mocks.offlineCacheInstance);
    expect(mocks.setPendingChanges).toHaveBeenLastCalledWith(mocks.pendingChangesInstance);
    expect(mocks.setSyncManager).toHaveBeenLastCalledWith(mocks.syncManagerInstance);
  });

  it('does not leave partially rebuilt client offline state when pending queue creation fails', async () => {
    mocks.PendingChanges.mockImplementation(
      class MockPendingChanges {
        constructor() {
          throw new Error('pending db unavailable');
        }
      } as never,
    );
    const { reconfigureRuntime } = await import('../runtimeReconfigure');

    await reconfigureRuntime('/Users/test/RelayData/data');

    expect(mocks.offlineCacheInstance.close).toHaveBeenCalledOnce();
    expect(mocks.setOfflineCache).not.toHaveBeenCalledWith(mocks.offlineCacheInstance);
    expect(mocks.setPendingChanges).not.toHaveBeenCalledWith(mocks.pendingChangesInstance);
    expect(mocks.setSyncManager).not.toHaveBeenCalledWith(mocks.syncManagerInstance);
    expect(mocks.mainWindow.webContents.reloadIgnoringCache).toHaveBeenCalledOnce();
  });
});
