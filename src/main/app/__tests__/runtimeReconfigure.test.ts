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
});
