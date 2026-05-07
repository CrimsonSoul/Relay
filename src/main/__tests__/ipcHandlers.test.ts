import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupIpcHandlers } from '../ipcHandlers';

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
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
