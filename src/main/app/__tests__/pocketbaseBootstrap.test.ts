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
    ensureCollections: vi.fn().mockResolvedValue({ privilegedRuntimeReady: true }),
    ensureKnowledgeSearchCollections: vi.fn().mockResolvedValue(undefined),
    startAdvertising: vi.fn(),
    stopAdvertising: vi.fn(),
    requestAppRelaunch: vi.fn(),
    broadcastToAllWindows: vi.fn(),
    backup: vi.fn().mockResolvedValue(undefined),
    backupIfDue: vi.fn().mockResolvedValue(null),
    startSchedule: vi.fn(),
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
    return {
      setPocketBase: vi.fn(),
      backup: mocks.backup,
      backupIfDue: mocks.backupIfDue,
    };
  }),
}));

vi.mock('../../pocketbase/RetentionManager', () => ({
  RetentionManager: vi.fn(function MockRetentionManager() {
    return { startSchedule: mocks.startSchedule, stop: vi.fn() };
  }),
}));

vi.mock('../../pocketbase/CollectionBootstrap', () => ({
  ensureCollections: mocks.ensureCollections,
  ensureKnowledgeSearchCollections: mocks.ensureKnowledgeSearchCollections,
}));

vi.mock('../../utils/broadcastToAllWindows', () => ({
  broadcastToAllWindows: mocks.broadcastToAllWindows,
}));

vi.mock('../../discovery/RelayDiscovery', () => ({
  startAdvertising: mocks.startAdvertising,
  stopAdvertising: mocks.stopAdvertising,
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
    mocks.backup.mockResolvedValue(undefined);
    mocks.backupIfDue.mockResolvedValue(null);
    mocks.ensureCollections.mockResolvedValue({ privilegedRuntimeReady: true });
    mocks.ensureKnowledgeSearchCollections.mockResolvedValue(undefined);
  });

  it('keeps server startup successful when optional Wiki search storage rejects', async () => {
    mocks.ensureKnowledgeSearchCollections.mockRejectedValue(
      new Error('search storage unavailable'),
    );
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    await expect(
      startPocketBase(
        {
          mode: 'server',
          bindHost: '0.0.0.0',
          port: 8090,
          secret: 'super-secret-passphrase',
        },
        'C:\\\\Users\\\\Relay\\\\data',
      ),
    ).resolves.toEqual({ status: 'started', privilegedRuntimeReady: true });

    expect(mocks.ensureCollections).toHaveBeenCalledOnce();
    expect(mocks.setPbClient).toHaveBeenCalledOnce();
    expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledTimes(2);
    expect(mocks.loggers.pocketbase.warn).toHaveBeenCalledWith(
      'Optional Wiki search storage is unavailable',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('waits the full 250ms before retrying optional Wiki search storage', async () => {
    vi.useFakeTimers();
    mocks.ensureKnowledgeSearchCollections.mockRejectedValueOnce(
      new Error('temporary search storage failure'),
    );
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    try {
      const startup = startPocketBase(
        {
          mode: 'server',
          bindHost: '0.0.0.0',
          port: 8090,
          secret: 'super-secret-passphrase',
        },
        'C:\\\\Users\\\\Relay\\\\data',
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(249);
      expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledTimes(2);
      await expect(startup).resolves.toEqual({ status: 'started', privilegedRuntimeReady: true });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns server startup after the fixed optional Wiki search storage deadline', async () => {
    vi.useFakeTimers();
    mocks.ensureKnowledgeSearchCollections.mockImplementation(
      () => new Promise<void>(() => undefined),
    );
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    try {
      const startup = startPocketBase(
        {
          mode: 'server',
          bindHost: '0.0.0.0',
          port: 8090,
          secret: 'super-secret-passphrase',
        },
        'C:\\\\Users\\\\Relay\\\\data',
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(3_000);

      await expect(startup).resolves.toEqual({ status: 'started', privilegedRuntimeReady: true });
      expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('contains a deferred optional Wiki search rejection after startup reaches its deadline', async () => {
    vi.useFakeTimers();
    let rejectOptionalBootstrap!: (reason?: unknown) => void;
    mocks.ensureKnowledgeSearchCollections.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOptionalBootstrap = reject;
        }),
    );
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    try {
      const startup = startPocketBase(
        {
          mode: 'server',
          bindHost: '0.0.0.0',
          port: 8090,
          secret: 'super-secret-passphrase',
        },
        'C:\\\\Users\\\\Relay\\\\data',
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(3_000);

      await expect(startup).resolves.toEqual({ status: 'started', privilegedRuntimeReady: true });
      rejectOptionalBootstrap(new Error('late optional bootstrap failure'));
      await vi.advanceTimersByTimeAsync(250);

      expect(unhandledRejections).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
      vi.useRealTimers();
    }
  });

  it('checks whether the daily automatic backup is due before retention cleanup', async () => {
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
    ).resolves.toEqual({ status: 'started', privilegedRuntimeReady: true });

    await vi.waitFor(() => expect(mocks.startSchedule).toHaveBeenCalledOnce());
    const beforeCleanup = mocks.startSchedule.mock.calls[0]?.[1] as () => Promise<void>;
    await beforeCleanup();

    expect(mocks.backupIfDue).toHaveBeenCalledOnce();
    expect(mocks.backup).not.toHaveBeenCalled();
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
    ).resolves.toEqual({ status: 'started', privilegedRuntimeReady: true });

    expect(mocks.startAdvertising).toHaveBeenCalledWith(8090);

    mocks.getCrashCallback()?.('PocketBase exited with code 1');

    expect(mocks.broadcastToAllWindows).toHaveBeenCalledWith('pb:crashed', {
      error: 'PocketBase exited with code 1',
    });
    expect(mocks.requestAppRelaunch).toHaveBeenCalledWith('pocketbase-crash-loop', {
      exitCode: 1,
    });
  });

  it('reports server readiness but defers privileged runtime readiness when identity migration is deferred', async () => {
    mocks.ensureCollections.mockResolvedValueOnce({
      privilegedRuntimeReady: false,
      reason: 'Ryan Bledsoe cannot be resolved uniquely.',
    });
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
    ).resolves.toEqual({
      status: 'started',
      privilegedRuntimeReady: false,
      reason: 'Ryan Bledsoe cannot be resolved uniquely.',
    });
    expect(mocks.startAdvertising).toHaveBeenCalledWith(8090);
  });
});
