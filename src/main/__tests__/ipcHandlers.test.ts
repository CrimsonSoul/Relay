import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserWindow, ipcMain } from 'electron';
import { setupIpcHandlers } from '../ipcHandlers';
import { KnowledgeIndexStatusService } from '../knowledge/KnowledgeIndexStatusService';

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../logger', () => ({
  loggers: { main: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } },
}));

vi.mock('@shared/types', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const mockSetupCloudStatusHandlers = vi.fn();
const mockSetupWindowHandlers = vi.fn();
vi.mock('../handlers/sdpAccountHandlers', () => ({ setupSdpAccountHandlers: vi.fn() }));
const mockSetupReleaseUpdateHandlers = vi.fn();
const mockSetupRecoveryHandlers = vi.fn();
const mockSetupSetupHandlers = vi.fn();
const mockSetupCacheHandlers = vi.fn();
const mockSetupBackupHandlers = vi.fn();
const mockSetupKnowledgeHandlers = vi.fn();
const mockSetupPrivilegedAccessHandlers = vi.fn();

vi.mock('../handlers/cloudStatus', () => ({
  setupCloudStatusHandlers: (...args: unknown[]) => mockSetupCloudStatusHandlers(...args),
}));
vi.mock('../handlers/windowHandlers', () => ({
  setupWindowHandlers: (...args: unknown[]) => mockSetupWindowHandlers(...args),
}));
vi.mock('../handlers/releaseUpdateHandlers', () => ({
  setupReleaseUpdateHandlers: (...args: unknown[]) => mockSetupReleaseUpdateHandlers(...args),
}));
vi.mock('../handlers/recoveryHandlers', () => ({
  setupRecoveryHandlers: (...args: unknown[]) => mockSetupRecoveryHandlers(...args),
}));
vi.mock('../handlers/setupHandlers', () => ({
  setupSetupHandlers: (...args: unknown[]) => mockSetupSetupHandlers(...args),
}));
vi.mock('../handlers/cacheHandlers', () => ({
  setupCacheHandlers: (...args: unknown[]) => mockSetupCacheHandlers(...args),
}));
vi.mock('../handlers/backupHandlers', () => ({
  setupBackupHandlers: (...args: unknown[]) => mockSetupBackupHandlers(...args),
}));
vi.mock('../handlers/knowledgeHandlers', () => ({
  setupKnowledgeHandlers: (...args: unknown[]) => mockSetupKnowledgeHandlers(...args),
}));
vi.mock('../handlers/privilegedAccessHandlers', () => ({
  setupPrivilegedAccessHandlers: (...args: unknown[]) => mockSetupPrivilegedAccessHandlers(...args),
}));

import { loggers } from '../logger';

beforeEach(() => {
  vi.clearAllMocks();
});

function makeOpts(overrides: Record<string, unknown> = {}) {
  const none = () => null;
  return {
    getMainWindow: vi.fn(none),
    getDataRoot: vi.fn(async () => '/data'),
    getAppConfig: none,
    getCache: none,
    getPendingChanges: none,
    getSyncManager: none,
    getBackupManager: none,
    getDynatraceWindowManager: none,
    getDynatraceProblemsManager: none,
    getPbClient: none,
    getKnowledgePdfService: none,
    getKnowledgeCoverService: none,
    getKnowledgeUploadService: none,
    getKnowledgeSearchService: none,
    knowledgeIndexStatusService: new KnowledgeIndexStatusService(none),
    getPrivilegedRuntime: none,
    getWebApprovalCodes: none,
    getRelayWebServerManager: none,
    getWorkstationAwakeService: none,
    subscribePrivilegedSessionChanged: () => () => undefined,
    subscribeWebApprovalRequestsChanged: () => () => undefined,
    onPrivilegedCredentialChanged: vi.fn(),
    ...overrides,
  } as Parameters<typeof setupIpcHandlers>[0];
}

describe('setupIpcHandlers', () => {
  it('calls all handler setup functions', async () => {
    await setupIpcHandlers(makeOpts());

    expect(mockSetupCloudStatusHandlers).toHaveBeenCalled();
    expect(mockSetupWindowHandlers).toHaveBeenCalled();
    expect(mockSetupReleaseUpdateHandlers).toHaveBeenCalled();
    expect(mockSetupRecoveryHandlers).toHaveBeenCalled();
    expect(mockSetupSetupHandlers).toHaveBeenCalled();
    expect(mockSetupCacheHandlers).toHaveBeenCalled();
    expect(mockSetupBackupHandlers).toHaveBeenCalled();
    expect(mockSetupKnowledgeHandlers).toHaveBeenCalled();
    expect(mockSetupPrivilegedAccessHandlers).toHaveBeenCalled();
  });

  it('passes live PDF services and the shared index status service to knowledge handlers', async () => {
    const getKnowledgePdfService = vi.fn();
    const getKnowledgeCoverService = vi.fn();
    const getKnowledgeUploadService = vi.fn();
    const getKnowledgeSearchService = vi.fn();
    const knowledgeIndexStatusService = new KnowledgeIndexStatusService(() => null);

    await setupIpcHandlers(
      makeOpts({
        getKnowledgePdfService,
        getKnowledgeCoverService,
        getKnowledgeUploadService,
        getKnowledgeSearchService,
        knowledgeIndexStatusService,
      }),
    );

    expect(mockSetupKnowledgeHandlers).toHaveBeenCalledWith(
      getKnowledgePdfService,
      expect.any(Function),
      getKnowledgeUploadService,
      getKnowledgeCoverService,
      getKnowledgeSearchService,
    );
    const getStatusService = mockSetupKnowledgeHandlers.mock.calls[0]?.[1];
    // The web gateway listens on this same instance; a private copy would double the watching.
    expect(getStatusService()).toBe(knowledgeIndexStatusService);
  });

  it('pushes knowledge index status changes to every live window on the status channel', async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const destroyedSend = vi.fn();
      Object.assign(BrowserWindow, {
        getAllWindows: () => [
          { isDestroyed: () => false, webContents: { send } },
          { isDestroyed: () => true, webContents: { send: destroyedSend } },
        ],
      });
      const getFullList = vi.fn(async () => [
        { category: 'Operations', indexedAt: '2026-07-12T12:00:00.000Z', lifecycleState: 'active' },
      ]);
      const pb = {
        collection: () => ({ getFullList, subscribe: async () => async () => undefined }),
      };

      const knowledgeIndexStatusService = new KnowledgeIndexStatusService(() => pb as never);
      const webListener = vi.fn();
      const stopWeb = knowledgeIndexStatusService.onChange(webListener);

      await setupIpcHandlers(makeOpts({ knowledgeIndexStatusService }));
      await vi.advanceTimersByTimeAsync(1_000);

      expect(send).toHaveBeenCalledWith('knowledge:indexStatusChanged', {
        state: 'idle',
        documentCount: 1,
        categoryCount: 1,
        lastIndexedAt: '2026-07-12T12:00:00.000Z',
      });
      expect(webListener).toHaveBeenCalledOnce();
      expect(destroyedSend).not.toHaveBeenCalled();

      // A web server restart drops the gateway's listener; the desktop push must keep watching.
      stopWeb();
      getFullList.mockResolvedValue([
        { category: 'Operations', indexedAt: '2026-07-12T12:00:00.000Z', lifecycleState: 'active' },
        { category: 'Network', indexedAt: '2026-07-12T12:00:00.000Z', lifecycleState: 'active' },
      ]);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(send).toHaveBeenLastCalledWith('knowledge:indexStatusChanged', {
        state: 'idle',
        documentCount: 2,
        categoryCount: 2,
        lastIndexedAt: '2026-07-12T12:00:00.000Z',
      });
      expect(webListener).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes getMainWindow and getDataRoot to window handlers', async () => {
    const getMainWindow = vi.fn();
    const getDataRoot = vi.fn();
    await setupIpcHandlers(makeOpts({ getMainWindow, getDataRoot }));

    expect(mockSetupWindowHandlers).toHaveBeenCalledWith(getMainWindow, getDataRoot);
  });

  it('passes cache-related getters to setup handlers', async () => {
    const getAppConfig = vi.fn();
    const getCache = vi.fn();
    const getPendingChanges = vi.fn();
    await setupIpcHandlers(makeOpts({ getAppConfig, getCache, getPendingChanges }));

    expect(mockSetupSetupHandlers).toHaveBeenCalledWith(getAppConfig, getCache, getPendingChanges);
  });

  it('passes cache, pending, sync, config getters to cache handlers', async () => {
    const getCache = vi.fn();
    const getPendingChanges = vi.fn();
    const getSyncManager = vi.fn();
    const getAppConfig = vi.fn();
    await setupIpcHandlers(makeOpts({ getCache, getPendingChanges, getSyncManager, getAppConfig }));

    expect(mockSetupCacheHandlers).toHaveBeenCalledWith(
      getCache,
      getPendingChanges,
      getSyncManager,
      getAppConfig,
    );
  });

  it('passes backup manager, restartPb, and cache to backup handlers', async () => {
    const getBackupManager = vi.fn();
    const restartPb = vi.fn();
    const getCache = vi.fn();
    await setupIpcHandlers(makeOpts({ getBackupManager, restartPb, getCache }));

    expect(mockSetupBackupHandlers).toHaveBeenCalledWith(getBackupManager, restartPb, getCache);
  });

  it('does not register retired roster handlers', async () => {
    await setupIpcHandlers(makeOpts());

    const retiredPrefix = ['relay', 'Operator:'].join('');
    expect(
      vi
        .mocked(ipcMain.handle)
        .mock.calls.some(([channel]) => String(channel).startsWith(retiredPrefix)),
    ).toBe(false);
  });

  it('passes live runtime and public session subscription to privileged handlers', async () => {
    const runtime = { getView: vi.fn() };
    const getPrivilegedRuntime = vi.fn(() => runtime);
    const subscribePrivilegedSessionChanged = vi.fn(() => vi.fn());
    const appConfig = { load: vi.fn(() => ({ mode: 'server' })) };

    await setupIpcHandlers(
      makeOpts({
        getAppConfig: vi.fn(() => appConfig),
        getPrivilegedRuntime,
        subscribePrivilegedSessionChanged,
      }),
    );

    expect(mockSetupPrivilegedAccessHandlers).toHaveBeenCalledWith(
      expect.objectContaining({
        getRuntime: getPrivilegedRuntime,
        subscribeSessionChanged: subscribePrivilegedSessionChanged,
        isServer: expect.any(Function),
        assertTrustedIpcSender: expect.any(Function),
      }),
    );
  });

  it('continues registering handlers if one setup throws', async () => {
    mockSetupCloudStatusHandlers.mockImplementation(() => {
      throw new Error('cloud status setup failed');
    });

    await setupIpcHandlers(makeOpts());

    // cloud status failed but others should still be called
    expect(mockSetupWindowHandlers).toHaveBeenCalled();
    expect(loggers.main.error).toHaveBeenCalledWith(
      'Failed to setup cloudStatus handlers',
      expect.objectContaining({ error: 'cloud status setup failed' }),
    );
  });
});
