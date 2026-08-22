import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RELAY_APP_USER_EMAIL } from '@shared/ipc';

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
  BaseAuthStore: class MockBaseAuthStore {},
  default: class MockPocketBase {
    authStore = {
      token: '',
      record: null as Record<string, unknown> | null,
      get isValid() {
        return Boolean(this.token);
      },
      save(token: string, record?: Record<string, unknown> | null) {
        this.token = token;
        this.record = record ?? null;
      },
      clear() {
        this.token = '';
        this.record = null;
      },
    };

    collection() {
      return {
        authWithPassword: async (...args: unknown[]) => {
          const result = await mocks.authWithPassword(...args);
          this.authStore.save('valid-token-offline', {
            id: 'relay-user',
            email: 'relay@relay.app',
            collectionId: '_pb_users_auth_',
            collectionName: 'users',
          });
          return result;
        },
      };
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
}));

import { initializeClientOfflineInfrastructure } from '../clientOfflineInfrastructure';
import {
  clearRelayAppUserAuthCoordinator,
  primeRelayAppUserAuth,
} from '../../pocketbase/RelayAppUserAuthCoordinator';
import {
  getOfflineCache,
  getPendingChanges,
  getSyncManager,
  setOfflineCache,
  setPendingChanges,
  setSyncManager,
} from '../appState';

const createFixtureCredential = () => ['fixture', 'credential', '123'].join('-');

describe('initializeClientOfflineInfrastructure', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'relay-offline-'));
    clearRelayAppUserAuthCoordinator();
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
    const secret = createFixtureCredential();
    mocks.authWithPassword.mockRejectedValue(new Error(`server reflected ${secret}`));

    await initializeClientOfflineInfrastructure(dir, {
      serverUrl: 'https://192.168.1.10:8090',
      secret,
    });

    expect(getOfflineCache()).not.toBeNull();
    expect(getPendingChanges()).not.toBeNull();
    expect(getSyncManager()).not.toBeNull();
    expect(mocks.loggers.pocketbase.warn).toHaveBeenCalledWith(
      'Offline infrastructure ready; server auth deferred',
      { authFailure: { category: 'unknown' } },
    );
    expect(JSON.stringify(mocks.loggers.pocketbase.warn.mock.calls)).not.toContain(secret);
  });

  it('opens the offline cache when auth succeeds (unchanged behavior)', async () => {
    mocks.authWithPassword.mockResolvedValue({});

    await initializeClientOfflineInfrastructure(dir, {
      serverUrl: 'https://192.168.1.10:8090',
      secret: createFixtureCredential(),
    });

    expect(getOfflineCache()).not.toBeNull();
    expect(getPendingChanges()).not.toBeNull();
    expect(getSyncManager()).not.toBeNull();
    expect(mocks.authWithPassword).toHaveBeenCalled();
  });

  it('does not consume the startup auth budget when authentication is deferred', async () => {
    mocks.authWithPassword.mockResolvedValue({});

    await initializeClientOfflineInfrastructure(
      dir,
      {
        serverUrl: 'https://192.168.1.10:8090',
        secret: createFixtureCredential(),
      },
      { deferAuthentication: true },
    );
    await Promise.resolve();

    expect(getOfflineCache()).not.toBeNull();
    expect(getPendingChanges()).not.toBeNull();
    expect(getSyncManager()).not.toBeNull();
    expect(mocks.authWithPassword).not.toHaveBeenCalled();
  });

  it('reuses the startup snapshot when deferred pending sync re-authenticates', async () => {
    const serverUrl = 'https://192.168.1.10:8090';
    const secret = createFixtureCredential();
    primeRelayAppUserAuth(
      {
        authStore: {
          token: 'valid-token-bootstrap',
          record: {
            id: 'relay-user',
            email: 'relay@relay.app',
            collectionId: '_pb_users_auth_',
            collectionName: 'users',
          },
          isValid: true,
          save: vi.fn(),
          clear: vi.fn(),
        },
      } as never,
      serverUrl,
      secret,
    );
    await initializeClientOfflineInfrastructure(
      dir,
      { serverUrl, secret },
      { deferAuthentication: true },
    );
    const syncManager = getSyncManager();

    expect(syncManager?.isAuthenticated()).toBe(false);
    await syncManager?.reauthenticate(RELAY_APP_USER_EMAIL, secret);

    expect(syncManager?.isAuthenticated()).toBe(true);
    expect(mocks.authWithPassword).not.toHaveBeenCalled();
  });

  it('hydrates non-deferred startup from the shared app-user authentication window', async () => {
    primeRelayAppUserAuth(
      {
        authStore: {
          token: 'valid-token-bootstrap',
          record: {
            id: 'relay-user',
            email: 'relay@relay.app',
            collectionId: '_pb_users_auth_',
            collectionName: 'users',
          },
          isValid: true,
          save: vi.fn(),
          clear: vi.fn(),
        },
      } as never,
      'https://192.168.1.10:8090',
      createFixtureCredential(),
    );

    await initializeClientOfflineInfrastructure(dir, {
      serverUrl: 'https://192.168.1.10:8090',
      secret: createFixtureCredential(),
    });

    expect(getSyncManager()).not.toBeNull();
    expect(mocks.authWithPassword).not.toHaveBeenCalled();
  });
});
