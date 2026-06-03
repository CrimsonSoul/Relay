import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let crashCallback: ((error: string) => void) | null = null;
  const localUrl = ['http', '://127.0.0.1:8090'].join('');
  const publicUrl = ['http', '://0.0.0.0:8090'].join('');
  const pbProcess = {
    isRunning: vi.fn(() => false),
    stop: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    getUrl: vi.fn(() => publicUrl),
    getLocalUrl: vi.fn(() => localUrl),
    onCrash: vi.fn((callback: (error: string) => void) => {
      crashCallback = callback;
    }),
  };

  return {
    app: {
      isPackaged: true,
    },
    pbProcess,
    getCrashCallback: () => crashCallback,
    setPbProcess: vi.fn(),
    getPbProcess: vi.fn(() => null),
    getRetentionManager: vi.fn(() => null),
    setRetentionManager: vi.fn(),
    setBackupManager: vi.fn(),
    setPbClient: vi.fn(),
    execFileSync: vi.fn(),
    existsSync: vi.fn(() => false),
    ensureCollections: vi.fn().mockResolvedValue(undefined),
    requestAppRelaunch: vi.fn(),
    broadcastToAllWindows: vi.fn(),
    loggers: {
      pocketbase: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    },
  };
});

vi.mock('electron', () => ({
  app: mocks.app,
}));

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
}));

vi.mock('node:child_process', () => ({
  execFileSync: mocks.execFileSync,
}));

vi.mock('../appState', () => ({
  getPbProcess: mocks.getPbProcess,
  setPbProcess: mocks.setPbProcess,
  getRetentionManager: mocks.getRetentionManager,
  setRetentionManager: mocks.setRetentionManager,
  setBackupManager: mocks.setBackupManager,
  setPbClient: mocks.setPbClient,
}));

vi.mock('../../pocketbase/PocketBaseProcess', () => ({
  PocketBaseProcess: vi.fn(function MockPocketBaseProcess() {
    return mocks.pbProcess;
  }),
}));

vi.mock('../../pocketbase/binaryPath', () => ({
  getPocketBaseBinaryName: vi.fn(() => 'pocketbase.exe'),
  getPocketBaseBinaryPath: vi.fn(() => 'C:\\Relay\\resources\\pocketbase\\pocketbase.exe'),
}));

vi.mock('../../pocketbase/BackupManager', () => ({
  BackupManager: vi.fn(function MockBackupManager() {
    return { setPocketBase: vi.fn(), backup: vi.fn().mockResolvedValue(undefined) };
  }),
}));

vi.mock('../../pocketbase/RetentionManager', () => ({
  RetentionManager: vi.fn(function MockRetentionManager() {
    return { startSchedule: vi.fn(), stop: vi.fn() };
  }),
}));

vi.mock('../../pocketbase/CollectionBootstrap', () => ({
  ensureCollections: mocks.ensureCollections,
}));

vi.mock('../../utils/broadcastToAllWindows', () => ({
  broadcastToAllWindows: mocks.broadcastToAllWindows,
}));

vi.mock('../relaunch', () => ({
  requestAppRelaunch: mocks.requestAppRelaunch,
}));

vi.mock('../../logger', () => ({
  loggers: mocks.loggers,
}));

vi.mock('pocketbase', () => ({
  default: vi.fn(function MockPocketBase() {
    return {
      collection: vi.fn(() => ({
        authWithPassword: vi.fn().mockResolvedValue({}),
        getFirstListItem: vi.fn().mockRejectedValue(new Error('missing')),
        delete: vi.fn().mockResolvedValue({}),
        create: vi.fn().mockResolvedValue({}),
      })),
    };
  }),
}));

describe('pocketbaseBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPbProcess.mockReturnValue(null);
    mocks.pbProcess.isRunning.mockReturnValue(false);
    mocks.pbProcess.start.mockResolvedValue(undefined);
  });

  it('relaunches Relay when PocketBase exhausts its own restart recovery', async () => {
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    await expect(
      startPocketBase(
        {
          mode: 'server',
          bindHost: '0.0.0.0',
          port: 8090,
          secret: 'super-secret-passphrase',
        },
        'C:\\Users\\Relay\\data',
      ),
    ).resolves.toBe(true);

    mocks.getCrashCallback()?.('PocketBase exited with code 1');

    expect(mocks.broadcastToAllWindows).toHaveBeenCalledWith('pb:crashed', {
      error: 'PocketBase exited with code 1',
    });
    expect(mocks.requestAppRelaunch).toHaveBeenCalledWith('pocketbase-crash-loop', {
      exitCode: 1,
    });
  });
});
