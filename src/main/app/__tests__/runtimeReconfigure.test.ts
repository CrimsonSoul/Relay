import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const DATA_DIR = join('/Users', 'test', 'RelayData', 'data');
const mocks = vi.hoisted(() => ({
  activeOldView: {
    state: 'active' as const,
    accountId: 'account-admin',
    username: 'ryan',
    displayName: 'Ryan Bledsoe',
    role: 'admin' as const,
    capabilities: ['knowledge.manage' as const],
    deviceId: 'device-1',
    expiresAt: '2026-08-03T18:00:00.000Z',
  },
  activeNewView: {
    state: 'active' as const,
    accountId: 'account-admin',
    username: 'ryan',
    displayName: 'Ryan Bledsoe',
    role: 'admin' as const,
    capabilities: ['knowledge.manage' as const],
    deviceId: 'device-1',
    expiresAt: '2026-08-03T19:00:00.000Z',
  },
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
  startDeferredPocketBaseServices: vi.fn(),
  cancelDeferredPocketBaseServices: vi.fn(),
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
  privilegedRuntime: { dispose: vi.fn() },
  nextPrivilegedRuntime: { dispose: vi.fn(), getView: vi.fn() },
  getPrivilegedRuntime: vi.fn(),
  setPrivilegedRuntime: vi.fn(),
  getPrivilegedHost: vi.fn(),
  setPrivilegedHost: vi.fn(),
  knowledgeUploadService: {
    handleSessionChanged: vi.fn(),
  },
  notifyKnowledgeUploadSessionChanged: vi.fn(),
  createProductionPrivilegedRuntime: vi.fn(),
  createProductionPrivilegedHost: vi.fn(),
  nextPrivilegedHost: {
    createElectronRuntime: vi.fn(),
    dispose: vi.fn(),
  },
  serverPbClient: { authStore: { isValid: true } },
  restartKnowledgeSearchRuntime: vi.fn(),
  relayWebServerManager: {
    stop: vi.fn(),
    applyConfig: vi.fn(),
  },
  getRelayWebServerManager: vi.fn(),
  clearRelayAppUserAuthCoordinator: vi.fn(),
  authenticateRelayAppUserShared: vi.fn(
    async (
      client: {
        collection(name: string): {
          authWithPassword(
            email: string,
            secret: string,
            options: { requestKey: null; signal?: AbortSignal },
          ): Promise<unknown>;
        };
      },
      _serverUrl: string,
      secret: string,
      options: { signal?: AbortSignal } = {},
    ) =>
      client.collection('_pb_users_auth_').authWithPassword('relay@relay.app', secret, {
        requestKey: null,
        signal: options.signal,
      }),
  ),
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
  getPrivilegedHost: mocks.getPrivilegedHost,
  setPrivilegedHost: mocks.setPrivilegedHost,
  notifyKnowledgeUploadSessionChanged: mocks.notifyKnowledgeUploadSessionChanged,
  getRelayWebServerManager: mocks.getRelayWebServerManager,
}));

vi.mock('../pocketbaseBootstrap', () => ({
  startPocketBase: mocks.startPocketBase,
  startDeferredPocketBaseServices: mocks.startDeferredPocketBaseServices,
  cancelDeferredPocketBaseServices: mocks.cancelDeferredPocketBaseServices,
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
}));

vi.mock('../../knowledge/knowledgeSearchRuntime', () => ({
  restartKnowledgeSearchRuntime: mocks.restartKnowledgeSearchRuntime,
}));

vi.mock('../../pocketbase/RelayAppUserAuthCoordinator', () => ({
  clearRelayAppUserAuthCoordinator: mocks.clearRelayAppUserAuthCoordinator,
  authenticateRelayAppUserShared: mocks.authenticateRelayAppUserShared,
}));

vi.mock('../../privileged/privilegedRuntime', () => ({
  createProductionPrivilegedHost: mocks.createProductionPrivilegedHost,
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
    mocks.getPrivilegedHost.mockReturnValue(null);
    mocks.setPrivilegedRuntime.mockImplementation((runtime) => {
      mocks.getPrivilegedRuntime.mockReturnValue(runtime);
    });
    mocks.setPrivilegedHost.mockImplementation((host) => {
      mocks.getPrivilegedHost.mockReturnValue(host);
    });
    mocks.notifyKnowledgeUploadSessionChanged.mockImplementation((view) =>
      mocks.knowledgeUploadService.handleSessionChanged(view),
    );
    mocks.getPbClient.mockReturnValue(mocks.serverPbClient);
    mocks.getRelayWebServerManager.mockReturnValue(mocks.relayWebServerManager);
    mocks.createProductionPrivilegedRuntime.mockResolvedValue(mocks.nextPrivilegedRuntime);
    mocks.nextPrivilegedRuntime.getView.mockReturnValue(mocks.activeNewView);
    mocks.nextPrivilegedHost.createElectronRuntime.mockReturnValue(mocks.nextPrivilegedRuntime);
    mocks.createProductionPrivilegedHost.mockResolvedValue(mocks.nextPrivilegedHost);
    mocks.pbProcess.stop.mockResolvedValue(undefined);
    mocks.startPocketBase.mockResolvedValue({ status: 'started', privilegedRuntimeReady: true });
    mocks.restartKnowledgeSearchRuntime.mockResolvedValue(undefined);
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

    await reconfigureRuntime(DATA_DIR);

    expect(mocks.clearRelayAppUserAuthCoordinator).toHaveBeenCalledOnce();
    expect(mocks.clearRelayAppUserAuthCoordinator.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.relayWebServerManager.stop.mock.invocationCallOrder[0] as number,
    );
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
    expect(mocks.initializeKnowledgePdfService).toHaveBeenCalledWith(DATA_DIR);
    expect(mocks.mainWindow.webContents.reloadIgnoringCache).toHaveBeenCalledOnce();
    expect(mocks.createProductionPrivilegedRuntime).toHaveBeenCalledWith({
      config: expect.objectContaining({ mode: 'client' }),
      dataDir: DATA_DIR,
      serverClient: null,
      dynatraceProblemsManager: mocks.dynatraceProblemsManager,
    });
    expect(mocks.setPrivilegedRuntime).toHaveBeenLastCalledWith(mocks.nextPrivilegedRuntime);
  });

  it('publishes a signed-out boundary before replacing the same privileged identity', async () => {
    mocks.knowledgeUploadService.handleSessionChanged(mocks.activeOldView);
    const { reconfigureRuntime } = await import('../runtimeReconfigure');

    await reconfigureRuntime(DATA_DIR);

    expect(
      mocks.knowledgeUploadService.handleSessionChanged.mock.calls.map(([view]) => view),
    ).toEqual([
      mocks.activeOldView,
      {
        state: 'signed-out',
        accountId: null,
        username: null,
        displayName: null,
        role: null,
        capabilities: [],
        deviceId: null,
        expiresAt: null,
      },
      mocks.activeNewView,
    ]);
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

    const reconfiguration = reconfigureRuntime(DATA_DIR);
    await vi.waitFor(() => expect(mocks.privilegedRuntime.dispose).toHaveBeenCalledOnce());
    expect(mocks.setPbClient).not.toHaveBeenCalled();

    finishDisposal?.();
    await reconfiguration;
    expect(mocks.setPbClient).toHaveBeenCalledWith(null);
  });

  it('uses PocketBase directly for Knowledge after server PocketBase restarts', async () => {
    mocks.appConfig.load.mockReturnValue({
      mode: 'server',
      port: 8090,
      bindHost: '0.0.0.0',
      secret: 'super-secret-passphrase',
    });
    const { reconfigureRuntime } = await import('../runtimeReconfigure');

    await reconfigureRuntime(DATA_DIR);

    expect(mocks.startPocketBase).toHaveBeenCalledOnce();
    expect(mocks.initializeKnowledgePdfService).toHaveBeenCalledWith(DATA_DIR);
    expect(mocks.startPocketBase.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createProductionPrivilegedHost.mock.invocationCallOrder[0] as number,
    );
  });

  it('stops Relay Web before runtime replacement and restarts it after PocketBase', async () => {
    const config = {
      mode: 'server' as const,
      port: 8090,
      bindHost: '0.0.0.0' as const,
      secret: 'super-secret-passphrase',
      web: { enabled: true, port: 8091 },
    };
    mocks.appConfig.load.mockReturnValue(config);
    const { reconfigureRuntime } = await import('../runtimeReconfigure');

    await reconfigureRuntime(DATA_DIR);

    expect(mocks.relayWebServerManager.stop).toHaveBeenCalledOnce();
    expect(mocks.relayWebServerManager.applyConfig).toHaveBeenCalledWith(config);
    expect(mocks.startPocketBase.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.relayWebServerManager.applyConfig.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps ordinary server services available but suppresses privileged runtime when migration is deferred', async () => {
    mocks.appConfig.load.mockReturnValue({
      mode: 'server',
      port: 8090,
      bindHost: '0.0.0.0',
      secret: 'super-secret-passphrase',
    });
    mocks.startPocketBase.mockResolvedValue({
      status: 'started',
      privilegedRuntimeReady: false,
      reason: 'Ryan Bledsoe cannot be resolved uniquely.',
    });
    const { reconfigureRuntime } = await import('../runtimeReconfigure');

    await reconfigureRuntime(DATA_DIR);

    expect(mocks.dynatraceProblemsManager.start).toHaveBeenCalledOnce();
    expect(mocks.cloudStatusManager.start).toHaveBeenCalledOnce();
    expect(mocks.createProductionPrivilegedRuntime).not.toHaveBeenCalled();
    expect(mocks.createProductionPrivilegedHost).not.toHaveBeenCalled();
    expect(mocks.mainWindow.webContents.reloadIgnoringCache).toHaveBeenCalledOnce();
  });

  it('rebuilds client-mode offline infrastructure during runtime reconfigure', async () => {
    const { reconfigureRuntime } = await import('../runtimeReconfigure');

    await reconfigureRuntime(DATA_DIR);

    expect(mocks.PocketBase).toHaveBeenCalledWith('https://relay.example.com');
    expect(mocks.authWithPassword).toHaveBeenCalledWith(
      'relay@relay.app',
      'super-secret-passphrase',
      expect.objectContaining({ requestKey: null }),
    );
    expect(mocks.OfflineCache).toHaveBeenCalledWith(join(DATA_DIR, 'cache.db'));
    expect(mocks.PendingChanges).toHaveBeenCalledWith(join(DATA_DIR, 'cache.db'));
    expect(mocks.SyncManager).toHaveBeenCalledWith(mocks.syncPbClient, {
      relayAppUserServerUrl: 'https://relay.example.com',
    });
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

    await reconfigureRuntime(DATA_DIR);

    expect(mocks.offlineCacheInstance.close).toHaveBeenCalledOnce();
    expect(mocks.setOfflineCache).not.toHaveBeenCalledWith(mocks.offlineCacheInstance);
    expect(mocks.setPendingChanges).not.toHaveBeenCalledWith(mocks.pendingChangesInstance);
    expect(mocks.setSyncManager).not.toHaveBeenCalledWith(mocks.syncManagerInstance);
    expect(mocks.mainWindow.webContents.reloadIgnoringCache).toHaveBeenCalledOnce();
  });

  it('restarts enhanced search best-effort after reloading without awaiting it on the critical path', async () => {
    mocks.restartKnowledgeSearchRuntime.mockReturnValueOnce(new Promise(() => undefined));
    const { reconfigureRuntime } = await import('../runtimeReconfigure');

    await expect(reconfigureRuntime(DATA_DIR)).resolves.toBeUndefined();

    expect(mocks.restartKnowledgeSearchRuntime).toHaveBeenCalledOnce();
    expect(
      mocks.mainWindow.webContents.reloadIgnoringCache.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.restartKnowledgeSearchRuntime.mock.invocationCallOrder[0] as number);
  });

  it('publishes a fresh ready startup generation after reconfiguration', async () => {
    const { createStartupStateController } = await import('../startupState');
    const { reconfigureRuntime } = await import('../runtimeReconfigure');
    const startupState = createStartupStateController();

    await reconfigureRuntime(DATA_DIR, { startupState });

    expect(startupState.getSnapshot()).toMatchObject({
      generation: 1,
      phase: 'ready',
      sequence: 3,
    });
  });

  it('keeps a failed reconfiguration generation from becoming ready', async () => {
    mocks.relayWebServerManager.stop.mockRejectedValueOnce(new Error('web server stuck'));
    const { createStartupStateController } = await import('../startupState');
    const { reconfigureRuntime } = await import('../runtimeReconfigure');
    const startupState = createStartupStateController();

    await expect(reconfigureRuntime(DATA_DIR, { startupState })).rejects.toThrow(
      'web server stuck',
    );
    expect(startupState.getSnapshot()).toMatchObject({
      generation: 1,
      phase: 'failed',
      message: 'Relay could not apply the new configuration.',
    });
  });
});
