import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { setupIpcHandlers } from '../ipcHandlers';

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
  return {
    getMainWindow: vi.fn(() => null),
    getDataRoot: vi.fn(async () => '/data'),
    ...overrides,
  };
}

describe('setupIpcHandlers', () => {
  it('calls all handler setup functions', () => {
    setupIpcHandlers(makeOpts());

    expect(mockSetupCloudStatusHandlers).toHaveBeenCalled();
    expect(mockSetupWindowHandlers).toHaveBeenCalled();
    expect(mockSetupSetupHandlers).toHaveBeenCalled();
    expect(mockSetupCacheHandlers).toHaveBeenCalled();
    expect(mockSetupBackupHandlers).toHaveBeenCalled();
    expect(mockSetupKnowledgeHandlers).toHaveBeenCalled();
    expect(mockSetupPrivilegedAccessHandlers).toHaveBeenCalled();
  });

  it('passes live PDF and PocketBase-backed status services to knowledge handlers', () => {
    const getKnowledgePdfService = vi.fn();
    const getKnowledgeUploadService = vi.fn();
    const getPbClient = vi.fn(() => null);

    setupIpcHandlers(makeOpts({ getKnowledgePdfService, getKnowledgeUploadService, getPbClient }));

    expect(mockSetupKnowledgeHandlers).toHaveBeenCalledWith(
      getKnowledgePdfService,
      expect.any(Function),
      getKnowledgeUploadService,
    );
    const getStatusService = mockSetupKnowledgeHandlers.mock.calls[0]?.[1];
    expect(getStatusService()).toEqual(
      expect.objectContaining({ getStatus: expect.any(Function) }),
    );
  });

  it('passes getMainWindow, createAuxWindow, getDataRoot to window handlers', () => {
    const getMainWindow = vi.fn();
    const getDataRoot = vi.fn();
    const createAuxWindow = vi.fn();
    setupIpcHandlers(makeOpts({ getMainWindow, getDataRoot, createAuxWindow }));

    expect(mockSetupWindowHandlers).toHaveBeenCalledWith(
      getMainWindow,
      createAuxWindow,
      getDataRoot,
    );
  });

  it('passes cache-related getters to setup handlers', () => {
    const getAppConfig = vi.fn();
    const getCache = vi.fn();
    const getPendingChanges = vi.fn();
    setupIpcHandlers(makeOpts({ getAppConfig, getCache, getPendingChanges }));

    expect(mockSetupSetupHandlers).toHaveBeenCalledWith(getAppConfig, getCache, getPendingChanges);
  });

  it('passes cache, pending, sync, config getters to cache handlers', () => {
    const getCache = vi.fn();
    const getPendingChanges = vi.fn();
    const getSyncManager = vi.fn();
    const getAppConfig = vi.fn();
    setupIpcHandlers(makeOpts({ getCache, getPendingChanges, getSyncManager, getAppConfig }));

    expect(mockSetupCacheHandlers).toHaveBeenCalledWith(
      getCache,
      getPendingChanges,
      getSyncManager,
      getAppConfig,
    );
  });

  it('passes backup manager, restartPb, and cache to backup handlers', () => {
    const getBackupManager = vi.fn();
    const restartPb = vi.fn();
    const getCache = vi.fn();
    setupIpcHandlers(makeOpts({ getBackupManager, restartPb, getCache }));

    expect(mockSetupBackupHandlers).toHaveBeenCalledWith(getBackupManager, restartPb, getCache);
  });

  it('does not register retired roster handlers', () => {
    setupIpcHandlers(makeOpts());

    const retiredPrefix = ['relay', 'Operator:'].join('');
    expect(
      vi
        .mocked(ipcMain.handle)
        .mock.calls.some(([channel]) => String(channel).startsWith(retiredPrefix)),
    ).toBe(false);
  });

  it('passes live runtime and public session subscription to privileged handlers', () => {
    const runtime = { getView: vi.fn() };
    const getPrivilegedRuntime = vi.fn(() => runtime);
    const subscribePrivilegedSessionChanged = vi.fn(() => vi.fn());
    const appConfig = { load: vi.fn(() => ({ mode: 'server' })) };

    setupIpcHandlers(
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

  it('continues registering handlers if one setup throws', () => {
    mockSetupCloudStatusHandlers.mockImplementation(() => {
      throw new Error('cloud status setup failed');
    });

    setupIpcHandlers(makeOpts());

    // cloud status failed but others should still be called
    expect(mockSetupWindowHandlers).toHaveBeenCalled();
    expect(loggers.main.error).toHaveBeenCalledWith(
      'Failed to setup cloudStatus handlers',
      expect.objectContaining({ error: 'cloud status setup failed' }),
    );
  });

  it('provides default no-op getters for optional parameters', () => {
    // Call with only required params — optional getters should default gracefully
    setupIpcHandlers({
      getMainWindow: vi.fn(),
      getDataRoot: vi.fn(async () => '/data'),
    });

    expect(mockSetupSetupHandlers).toHaveBeenCalled();
    expect(mockSetupCacheHandlers).toHaveBeenCalled();
    expect(mockSetupBackupHandlers).toHaveBeenCalled();
  });
});
