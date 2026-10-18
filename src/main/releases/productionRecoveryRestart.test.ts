import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecoveryUpdateRequest } from './RecoveryUpdateRequest';

const mocks = vi.hoisted(() => {
  const calls: string[] = [];
  const state: Record<string, unknown> = {};
  return {
    calls,
    state,
    app: { isPackaged: true, getPath: vi.fn(() => 'C:\\Users\\Operator\\AppData\\Roaming\\Relay') },
    readRecoveryUpdateRequest: vi.fn(),
    completeRecoveryUpdateRequest: vi.fn(),
    createRecoveryServerSnapshot: vi.fn(),
    stopPrivilegedRuntime: vi.fn(async () => {
      calls.push('privileged');
    }),
    stopKnowledgeSearchRuntime: vi.fn(async () => {
      calls.push('knowledge-search');
    }),
    stopAdvertising: vi.fn(() => {
      calls.push('advertising');
    }),
  };
});

vi.mock('electron', () => ({ app: mocks.app }));
vi.mock('../app/appState', () => {
  const accessor = (name: string) => ({
    [`get${name}`]: () => mocks.state[name] ?? null,
    [`set${name}`]: (value: unknown) => {
      mocks.state[name] = value;
    },
  });
  return {
    ...accessor('AppConfig'),
    ...accessor('BackupManager'),
    ...accessor('CloudStatusManager'),
    ...accessor('DynatraceProblemsManager'),
    ...accessor('KnowledgeUploadService'),
    ...accessor('OfflineCache'),
    ...accessor('PbProcess'),
    ...accessor('PendingChanges'),
    ...accessor('RadarManager'),
    ...accessor('RetentionManager'),
    ...accessor('RelayWebServerManager'),
    ...accessor('SyncManager'),
  };
});
vi.mock('../app/privilegedRuntimeLifecycle', () => ({
  stopPrivilegedRuntime: mocks.stopPrivilegedRuntime,
}));
vi.mock('../knowledge/knowledgeSearchRuntime', () => ({
  stopKnowledgeSearchRuntime: mocks.stopKnowledgeSearchRuntime,
}));
vi.mock('../discovery/RelayDiscovery', () => ({ stopAdvertising: mocks.stopAdvertising }));
vi.mock('../logger', () => ({ loggers: { main: { error: vi.fn() } } }));
vi.mock('../pocketbase/WindowsPrivateDirectory', () => ({
  createWindowsPrivateDirectory: vi.fn(),
}));
vi.mock('./RecoverySnapshot', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./RecoverySnapshot')>()),
  createRecoveryServerSnapshot: mocks.createRecoveryServerSnapshot,
}));
vi.mock('./RecoveryUpdateRequest', () => ({
  readRecoveryUpdateRequest: mocks.readRecoveryUpdateRequest,
  completeRecoveryUpdateRequest: mocks.completeRecoveryUpdateRequest,
}));

import { prepareProductionRecoveryRestart } from './productionRecoveryRestart';

const TRANSACTION_ID = '11111111-2222-4333-8444-555555555555';
const SNAPSHOT_ID = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const originalPlatform = process.platform;
const originalLocalAppData = process.env.LOCALAPPDATA;

function request(mode: RecoveryUpdateRequest['mode']): RecoveryUpdateRequest {
  return {
    protocol: 2,
    transactionId: TRANSACTION_ID,
    source: {
      buildId: `r1-${'1'.repeat(40)}`,
      version: '1.6.0',
      releaseTag: 'v1.6.0',
      targetCommitish: '1'.repeat(40),
      runtimeSha512: 'a'.repeat(128),
      installerSha256: null,
      recoveryProtocol: 2,
      serverDataEpoch: 3,
      clientDataEpoch: 1,
      installedAt: '2026-08-24T15:00:00.000Z',
      health: 'healthy',
      rollbackSnapshotId: null,
    },
    targetVersion: '1.7.0',
    targetCommitish: '2'.repeat(40),
    targetInstallerSha256: 'b'.repeat(64),
    mode,
    checkpoint: 'pending',
    snapshotId: null,
    requestedAt: '2026-08-24T15:05:00.000Z',
  };
}

function configure(mode: 'server' | 'client') {
  mocks.state.AppConfig = { load: () => ({ mode }) };
  mocks.readRecoveryUpdateRequest.mockResolvedValue(request(mode));
}

function installServerServices(options: { backupClose?: () => Promise<void> } = {}) {
  const service = (name: string) => ({
    stop: vi.fn(async () => {
      mocks.calls.push(name);
    }),
  });
  const pocketBase = service('pocketbase');
  const backups = {
    restoring: false,
    close: vi.fn(
      options.backupClose ??
        (async () => {
          mocks.calls.push('backups');
        }),
    ),
  };
  Object.assign(mocks.state, {
    RelayWebServerManager: service('relay-web'),
    DynatraceProblemsManager: service('dynatrace'),
    CloudStatusManager: service('cloud-status'),
    RadarManager: service('radar'),
    RetentionManager: service('retention'),
    KnowledgeUploadService: {
      handleSessionChanged: vi.fn(),
      dispose: vi.fn(async () => {
        mocks.calls.push('knowledge-upload');
      }),
    },
    BackupManager: backups,
    PbProcess: pocketBase,
  });
  return { pocketBase, backups };
}

function installClientStores(options: { checkpoints?: boolean } = {}) {
  const store = (name: string) => ({
    checkpoint: vi.fn(() => {
      mocks.calls.push(`${name}-checkpoint`);
      return options.checkpoints ?? true;
    }),
    close: vi.fn(() => {
      mocks.calls.push(`${name}-close`);
    }),
    getAllStrict: vi.fn(() => []),
  });
  const cache = store('cache');
  const pending = store('pending');
  Object.assign(mocks.state, {
    OfflineCache: cache,
    PendingChanges: pending,
    SyncManager: { name: 'sync' },
    RadarManager: { stop: vi.fn(() => mocks.calls.push('radar')) },
  });
  return { cache, pending };
}

describe('prepareProductionRecoveryRestart', () => {
  beforeEach(() => {
    for (const key of Object.keys(mocks.state)) delete mocks.state[key];
    mocks.calls.length = 0;
    vi.clearAllMocks();
    mocks.app.isPackaged = true;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.LOCALAPPDATA = 'C:\\Users\\Operator\\AppData\\Local';
    mocks.completeRecoveryUpdateRequest.mockResolvedValue(undefined);
    mocks.createRecoveryServerSnapshot.mockImplementation(async () => {
      mocks.calls.push('snapshot');
      return { snapshotId: SNAPSHOT_ID, path: 'snapshot', bytes: 1 };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
  });

  it('stops every server service and PocketBase before snapshotting the server data', async () => {
    configure('server');
    const { pocketBase } = installServerServices();

    await expect(prepareProductionRecoveryRestart(TRANSACTION_ID)).resolves.toBe('ready');

    expect(mocks.calls.indexOf('pocketbase')).toBe(mocks.calls.indexOf('snapshot') - 1);
    expect(mocks.calls.slice(0, -2)).toEqual(
      expect.arrayContaining([
        'relay-web',
        'dynatrace',
        'cloud-status',
        'radar',
        'knowledge-upload',
        'knowledge-search',
        'privileged',
        'advertising',
        'retention',
        'backups',
      ]),
    );
    expect(mocks.calls.indexOf('backups')).toBeLessThan(mocks.calls.indexOf('pocketbase'));
    expect(pocketBase.stop).toHaveBeenCalledTimes(1);
    expect(mocks.state.PbProcess).toBeNull();
    expect(mocks.state.RelayWebServerManager).toBeNull();
    expect(mocks.createRecoveryServerSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        userDataRoot: 'C:\\Users\\Operator\\AppData\\Roaming\\Relay',
        dataDirectory: expect.stringMatching(/Roaming[\\/]Relay[\\/]data$/u),
        transactionId: TRANSACTION_ID,
        sourceBuildId: `r1-${'1'.repeat(40)}`,
        dataEpoch: 3,
      }),
    );
    expect(mocks.completeRecoveryUpdateRequest).toHaveBeenCalledWith(
      expect.stringMatching(/Local[\\/]Relay$/u),
      TRANSACTION_ID,
      'server',
      SNAPSHOT_ID,
    );
  });

  it('snapshots after a long backup check stops waiting, without leaving PocketBase running', async () => {
    vi.useFakeTimers();
    configure('server');
    installServerServices({ backupClose: () => new Promise<void>(() => undefined) });

    const result = prepareProductionRecoveryRestart(TRANSACTION_ID);
    await vi.advanceTimersByTimeAsync(120_000);

    await expect(result).resolves.toBe('ready');
    expect(mocks.calls.slice(-2)).toEqual(['pocketbase', 'snapshot']);
  });

  it('leaves a running backup restore and every server service alone', async () => {
    configure('server');
    const { pocketBase, backups } = installServerServices();
    backups.restoring = true;

    await expect(prepareProductionRecoveryRestart(TRANSACTION_ID)).resolves.toBe('restore-running');
    expect(mocks.calls).toEqual([]);
    expect(pocketBase.stop).not.toHaveBeenCalled();
    expect(mocks.createRecoveryServerSnapshot).not.toHaveBeenCalled();
  });

  it('reopens the current version when the server snapshot fails after teardown', async () => {
    configure('server');
    installServerServices();
    mocks.createRecoveryServerSnapshot.mockRejectedValue(
      Object.assign(new Error('locked'), { code: 'EBUSY' }),
    );

    await expect(prepareProductionRecoveryRestart(TRANSACTION_ID)).resolves.toEqual({
      status: 'restart-current',
      failure: 'snapshot-locked',
    });
    expect(mocks.completeRecoveryUpdateRequest).not.toHaveBeenCalled();
  });

  it('checkpoints and releases the client stores before completing a client update', async () => {
    configure('client');
    const { cache, pending } = installClientStores();

    await expect(prepareProductionRecoveryRestart(TRANSACTION_ID)).resolves.toBe('ready');

    expect(pending.getAllStrict).toHaveBeenCalled();
    expect(mocks.calls).toEqual(expect.arrayContaining(['cache-checkpoint', 'pending-checkpoint']));
    expect(mocks.calls.indexOf('cache-close')).toBeGreaterThan(
      mocks.calls.indexOf('pending-checkpoint'),
    );
    expect(cache.close).toHaveBeenCalledTimes(1);
    expect(pending.close).toHaveBeenCalledTimes(1);
    expect(mocks.state.OfflineCache).toBeNull();
    expect(mocks.state.PendingChanges).toBeNull();
    expect(mocks.state.SyncManager).toBeNull();
    expect(mocks.createRecoveryServerSnapshot).not.toHaveBeenCalled();
    expect(mocks.completeRecoveryUpdateRequest).toHaveBeenCalledWith(
      expect.any(String),
      TRANSACTION_ID,
      'client',
      null,
    );
  });

  it('keeps the client stores open when they cannot be checkpointed', async () => {
    configure('client');
    installClientStores({ checkpoints: false });

    await expect(prepareProductionRecoveryRestart(TRANSACTION_ID)).resolves.toEqual({
      status: 'restart-current',
      failure: 'client-checkpoint',
    });
    expect(mocks.state.OfflineCache).not.toBeNull();
    expect(mocks.completeRecoveryUpdateRequest).not.toHaveBeenCalled();
  });

  it('refuses a client update before teardown when its offline stores are not open', async () => {
    configure('client');

    await expect(prepareProductionRecoveryRestart(TRANSACTION_ID)).resolves.toBe(
      'client-data-unavailable',
    );
    expect(mocks.calls).toEqual([]);
    expect(mocks.completeRecoveryUpdateRequest).not.toHaveBeenCalled();
  });

  it('does not tear down a server whose prepared update was made in client mode', async () => {
    configure('server');
    mocks.readRecoveryUpdateRequest.mockResolvedValue(request('client'));
    const { pocketBase } = installServerServices();

    await expect(prepareProductionRecoveryRestart(TRANSACTION_ID)).resolves.toBe('unchanged');
    expect(pocketBase.stop).not.toHaveBeenCalled();
  });

  it('leaves unpackaged runtimes unchanged', async () => {
    configure('server');
    installServerServices();
    mocks.app.isPackaged = false;

    await expect(prepareProductionRecoveryRestart(TRANSACTION_ID)).resolves.toBe('unchanged');
    expect(mocks.readRecoveryUpdateRequest).not.toHaveBeenCalled();
  });
});
