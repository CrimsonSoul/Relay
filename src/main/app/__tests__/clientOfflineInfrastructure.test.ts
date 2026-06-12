import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  authWithPassword: vi.fn(),
  loggers: {
    main: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    sync: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    pocketbase: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    security: { warn: vi.fn() },
  },
}));

vi.mock('pocketbase', () => ({
  default: class MockPocketBase {
    collection() {
      return { authWithPassword: mocks.authWithPassword };
    }
  },
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/userData'),
    isPackaged: false,
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('../../logger', () => ({
  loggers: mocks.loggers,
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

import { initializeClientOfflineInfrastructure } from '../clientOfflineInfrastructure';
import {
  getOfflineCache,
  getPendingChanges,
  getSyncManager,
  setOfflineCache,
  setPendingChanges,
  setSyncManager,
} from '../appState';

describe('initializeClientOfflineInfrastructure', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'relay-offline-'));
    mocks.authWithPassword.mockReset();
  });

  afterEach(() => {
    getOfflineCache()?.close();
    getPendingChanges()?.close();
    setOfflineCache(null);
    setPendingChanges(null);
    setSyncManager(null);
    rmSync(dir, { recursive: true, force: true });
  });

  it('opens the offline cache even when server auth fails', async () => {
    mocks.authWithPassword.mockRejectedValue(new Error('ECONNREFUSED'));

    await initializeClientOfflineInfrastructure(dir, {
      serverUrl: 'https://192.168.1.10:8090',
      secret: 'secret123',
    });

    expect(getOfflineCache()).not.toBeNull();
    expect(getPendingChanges()).not.toBeNull();
    expect(getSyncManager()).not.toBeNull();
    expect(mocks.loggers.pocketbase.warn).toHaveBeenCalledWith(
      'Offline infrastructure ready; server auth deferred',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('opens the offline cache when auth succeeds (unchanged behavior)', async () => {
    mocks.authWithPassword.mockResolvedValue({});

    await initializeClientOfflineInfrastructure(dir, {
      serverUrl: 'https://192.168.1.10:8090',
      secret: 'secret123',
    });

    expect(getOfflineCache()).not.toBeNull();
    expect(getPendingChanges()).not.toBeNull();
    expect(getSyncManager()).not.toBeNull();
    expect(mocks.authWithPassword).toHaveBeenCalled();
  });
});
