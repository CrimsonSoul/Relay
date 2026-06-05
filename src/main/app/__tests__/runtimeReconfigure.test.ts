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
  getOfflineCache: vi.fn(),
  setOfflineCache: vi.fn(),
  getPendingChanges: vi.fn(),
  setPendingChanges: vi.fn(),
  setSyncManager: vi.fn(),
  getPbProcess: vi.fn(),
  setPbProcess: vi.fn(),
  getMainWindow: vi.fn(),
  startPocketBase: vi.fn(),
  syncPbClient: {
    collection: vi.fn(),
  },
  authWithPassword: vi.fn(),
  PocketBase: vi.fn(),
  offlineCacheInstance: { kind: 'offline-cache', close: vi.fn() },
  pendingChangesInstance: { kind: 'pending-changes', close: vi.fn() },
  syncManagerInstance: { kind: 'sync-manager' },
  OfflineCache: vi.fn(),
  PendingChanges: vi.fn(),
  SyncManager: vi.fn(),
}));

vi.mock('../appState', () => ({
  getAppConfig: mocks.getAppConfig,
  getRetentionManager: mocks.getRetentionManager,
  setRetentionManager: mocks.setRetentionManager,
  setBackupManager: mocks.setBackupManager,
  setPbClient: mocks.setPbClient,
  getOfflineCache: mocks.getOfflineCache,
  setOfflineCache: mocks.setOfflineCache,
  getPendingChanges: mocks.getPendingChanges,
  setPendingChanges: mocks.setPendingChanges,
  setSyncManager: mocks.setSyncManager,
  getPbProcess: mocks.getPbProcess,
  setPbProcess: mocks.setPbProcess,
  getMainWindow: mocks.getMainWindow,
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
    mocks.getPbProcess.mockReturnValue(mocks.pbProcess);
    mocks.getMainWindow.mockReturnValue(mocks.mainWindow);
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
    expect(mocks.pbProcess.stop).toHaveBeenCalledOnce();
    expect(mocks.setPbProcess).toHaveBeenCalledWith(null);
    expect(mocks.startPocketBase).not.toHaveBeenCalled();
    expect(mocks.mainWindow.webContents.reloadIgnoringCache).toHaveBeenCalledOnce();
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
    expect(mocks.PendingChanges).toHaveBeenCalledWith(
      '/Users/test/RelayData/data/pending_changes.db',
    );
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
