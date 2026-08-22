import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '../../config/AppConfig';
import type { PocketBaseConfig } from '../../pocketbase/PocketBaseProcess';

/**
 * The invocation-order stamp of a mock call, asserting the call actually
 * happened so ordering assertions never silently compare against undefined.
 */
function callOrder(mock: { mock: { invocationCallOrder: number[] } }, index = 0): number {
  const order = mock.mock.invocationCallOrder[index];
  if (order === undefined) {
    throw new Error(`Expected the mock to have been called at least ${index + 1} time(s)`);
  }
  return order;
}

/** The fixed sentences startup failures are reported with, per cause. */
const START_FAILURE = {
  binaryMissing:
    'The PocketBase server bundled with Relay is missing for this platform. Reinstall Relay to restore it.',
  hooksMissing:
    "Relay's bundled PocketBase hook files are missing. Reinstall Relay to restore them.",
  reauthenticationRoute:
    'Relay could not verify its privileged PocketBase route. Reinstall Relay to restore its bundled hook files.',
  rateLimit: 'Relay could not apply the PocketBase rate limits its privileged routes depend on.',
  credentialRepair:
    'Relay could not repair its PocketBase administrator credentials. Restore a backup or reconfigure the workspace.',
  authentication:
    'Relay could not sign in to its PocketBase workspace with the stored passphrase. Reconfigure the workspace to set a new one.',
  appUser:
    'Relay could not prepare the PocketBase account remote clients sign in with. Restart the workspace to try again.',
  fallback: 'Relay could not start its PocketBase workspace. See the Relay logs for details.',
} as const;

const REPAIR_DIRECTORY_PATTERN =
  /^C:\\Users\\Relay\\AppData\\Local\\Temp[/\\]\.relay-pb-repair-[0-9a-f]{16}$/;
const REPAIR_MIGRATIONS_ARGUMENT_PATTERN =
  /^--migrationsDir=C:\\Users\\Relay\\AppData\\Local\\Temp[/\\]\.relay-pb-repair-[0-9a-f]{16}$/;

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
  const appUserAuth = vi.fn().mockResolvedValue({});
  const superuserAuth = vi.fn().mockResolvedValue({});
  const getFirstListItem = vi.fn().mockRejectedValue(new Error('missing'));
  const deleteRecord = vi.fn().mockResolvedValue({});
  const createRecord = vi.fn().mockResolvedValue({});
  const backup = vi.fn().mockResolvedValue(undefined);
  const backupIfDue = vi.fn().mockResolvedValue(null);
  const startSchedule = vi.fn();
  const backupManager = { setPocketBase: vi.fn(), backup, backupIfDue };
  const retentionManager = { startSchedule, stop: vi.fn() };
  const maintenancePb = {
    collection: vi.fn(() => ({ authWithPassword: superuserAuth })),
  };
  const pocketBaseProcessConstructor = vi.fn<(config: PocketBaseConfig) => typeof pbProcess>(
    function MockPocketBaseProcess() {
      return pbProcess;
    },
  );

  return {
    app: {
      isPackaged: true,
    },
    pbProcess,
    getCrashCallback: () => crashCallback,
    setPbProcess: vi.fn(),
    getPbProcess: vi.fn<() => typeof pbProcess | null>(() => null),
    getRetentionManager: vi.fn<() => typeof retentionManager | null>(() => null),
    getBackupManager: vi.fn(() => backupManager),
    getPbClient: vi.fn(() => maintenancePb),
    setRetentionManager: vi.fn(),
    setBackupManager: vi.fn(),
    setPbClient: vi.fn(),
    execFileSync: vi.fn(),
    fetch: vi.fn().mockResolvedValue({ status: 401 }),
    pocketBaseProcessConstructor,
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => 'relay-superuser-repair:11111111222243338444555555555555'),
    rmSync: vi.fn(),
    tmpdir: vi.fn(() => 'C:\\Users\\Relay\\AppData\\Local\\Temp'),
    randomUUID: vi.fn(() => '11111111-2222-4333-8444-555555555555'),
    appUserAuth,
    superuserAuth,
    getFirstListItem,
    deleteRecord,
    createRecord,
    existsSync: vi.fn<(path: unknown) => boolean>(() => false),
    ensurePocketBaseAuthRateLimit: vi.fn().mockResolvedValue(undefined),
    ensureKnowledgeBatchApi: vi.fn().mockResolvedValue(undefined),
    ensureCollections: vi.fn().mockResolvedValue({ privilegedRuntimeReady: true }),
    ensureKnowledgeSearchCollections: vi.fn().mockResolvedValue(undefined),
    startAdvertising: vi.fn(),
    stopAdvertising: vi.fn(),
    requestAppRelaunch: vi.fn(),
    broadcastToAllWindows: vi.fn(),
    backup,
    backupIfDue,
    startSchedule,
    backupManager,
    retentionManager,
    maintenancePb,
    restartKnowledgeSearchRuntime: vi.fn().mockResolvedValue(undefined),
    stopKnowledgeSearchRuntime: vi.fn().mockResolvedValue(undefined),
    primeRelayAppUserAuth: vi.fn(),
    clearRelayAppUserAuthCoordinator: vi.fn(),
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
  mkdirSync: mocks.mkdirSync,
  chmodSync: mocks.chmodSync,
  writeFileSync: mocks.writeFileSync,
  readFileSync: mocks.readFileSync,
  rmSync: mocks.rmSync,
}));

vi.mock('node:child_process', () => ({
  execFileSync: mocks.execFileSync,
}));

vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomUUID: mocks.randomUUID,
}));

vi.mock('node:os', () => ({
  tmpdir: mocks.tmpdir,
}));

vi.mock('../appState', () => ({
  getPbProcess: mocks.getPbProcess,
  setPbProcess: mocks.setPbProcess,
  getRetentionManager: mocks.getRetentionManager,
  getBackupManager: mocks.getBackupManager,
  getPbClient: mocks.getPbClient,
  setRetentionManager: mocks.setRetentionManager,
  setBackupManager: mocks.setBackupManager,
  setPbClient: mocks.setPbClient,
}));

vi.mock('../../pocketbase/PocketBaseProcess', () => ({
  PocketBaseProcess: mocks.pocketBaseProcessConstructor,
}));

vi.mock('../../pocketbase/binaryPath', () => ({
  getPocketBaseBinaryName: vi.fn(() => 'pocketbase.exe'),
  getPocketBaseBinaryPath: vi.fn(() => 'C:\\Relay\\resources\\pocketbase\\pocketbase.exe'),
}));

vi.mock('../../pocketbase/BackupManager', () => ({
  BackupManager: vi.fn(function MockBackupManager() {
    return mocks.backupManager;
  }),
}));

vi.mock('../../pocketbase/RetentionManager', () => ({
  RetentionManager: vi.fn(function MockRetentionManager() {
    return mocks.retentionManager;
  }),
}));

vi.mock('../../pocketbase/CollectionBootstrap', () => ({
  ensurePocketBaseAuthRateLimit: mocks.ensurePocketBaseAuthRateLimit,
  ensureKnowledgeBatchApi: mocks.ensureKnowledgeBatchApi,
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

vi.mock('../../knowledge/knowledgeSearchRuntime', () => ({
  restartKnowledgeSearchRuntime: mocks.restartKnowledgeSearchRuntime,
  stopKnowledgeSearchRuntime: mocks.stopKnowledgeSearchRuntime,
}));

vi.mock('../../pocketbase/RelayAppUserAuthCoordinator', () => ({
  primeRelayAppUserAuth: mocks.primeRelayAppUserAuth,
  clearRelayAppUserAuthCoordinator: mocks.clearRelayAppUserAuthCoordinator,
}));

vi.mock('pocketbase', () => ({
  default: vi.fn(function MockPocketBase() {
    return {
      collection: vi.fn((name: string) => ({
        authWithPassword: name === '_superusers' ? mocks.superuserAuth : mocks.appUserAuth,
        getFirstListItem: mocks.getFirstListItem,
        delete: mocks.deleteRecord,
        create: mocks.createRecord,
      })),
    };
  }),
}));

vi.stubGlobal('fetch', mocks.fetch);
Object.defineProperty(process, 'resourcesPath', {
  configurable: true,
  value: 'C:\\Relay\\resources',
});

describe('pocketbaseBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS;
    mocks.getPbProcess.mockReturnValue(null);
    mocks.getRetentionManager.mockReturnValue(null);
    mocks.getPbClient.mockReturnValue(mocks.maintenancePb);
    mocks.pbProcess.isRunning.mockReturnValue(false);
    mocks.pbProcess.start.mockResolvedValue(undefined);
    mocks.pbProcess.stop.mockResolvedValue(undefined);
    mocks.appUserAuth.mockResolvedValue({});
    mocks.superuserAuth.mockResolvedValue({});
    mocks.getFirstListItem.mockRejectedValue(new Error('missing'));
    mocks.execFileSync.mockReturnValue(undefined);
    mocks.fetch.mockResolvedValue({ status: 401 });
    mocks.existsSync.mockImplementation((path) =>
      String(path).endsWith('relay_privileged_reauth.pb.js'),
    );
    mocks.mkdirSync.mockReset();
    mocks.chmodSync.mockReset();
    mocks.writeFileSync.mockReset();
    mocks.readFileSync.mockReset();
    mocks.readFileSync.mockReturnValue('relay-superuser-repair:11111111222243338444555555555555');
    mocks.rmSync.mockReset();
    mocks.tmpdir.mockReset();
    mocks.tmpdir.mockReturnValue('C:\\Users\\Relay\\AppData\\Local\\Temp');
    mocks.randomUUID.mockReset();
    mocks.randomUUID.mockReturnValue('11111111-2222-4333-8444-555555555555');
    mocks.backup.mockResolvedValue(undefined);
    mocks.backupIfDue.mockResolvedValue(null);
    mocks.ensurePocketBaseAuthRateLimit.mockResolvedValue(undefined);
    mocks.ensureKnowledgeBatchApi.mockResolvedValue(undefined);
    mocks.ensureCollections.mockResolvedValue({ privilegedRuntimeReady: true });
    mocks.ensureKnowledgeSearchCollections.mockResolvedValue(undefined);
  });

  it('creates the disposable E2E superuser before PocketBase can open its browser installer', async () => {
    process.env.NODE_ENV = 'test';
    process.env.RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS = '1';
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    await expect(
      startPocketBase(
        {
          mode: 'server',
          bindHost: '127.0.0.1',
          port: 8090,
          secret: 'super-secret-passphrase',
        },
        'C:\\Users\\Relay\\data',
      ),
    ).resolves.toEqual({ status: 'started', privilegedRuntimeReady: true });

    expect(mocks.execFileSync).toHaveBeenCalledOnce();
    expect(callOrder(mocks.execFileSync, 0)).toBeLessThan(callOrder(mocks.pbProcess.start, 0));
  });

  it('authenticates a healthy existing superuser without invoking CLI repair', async () => {
    const onHealthy = vi.fn();
    const onCredentialsReady = vi.fn();
    const onSchemaReady = vi.fn();
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
        { onHealthy, onCredentialsReady, onSchemaReady },
      ),
    ).resolves.toEqual({ status: 'started', privilegedRuntimeReady: true });

    expect(mocks.pbProcess.start).toHaveBeenCalledTimes(2);
    expect(mocks.pbProcess.stop).toHaveBeenCalledOnce();
    expect(mocks.pocketBaseProcessConstructor.mock.calls.map(([config]) => config?.host)).toEqual([
      '127.0.0.1',
      '0.0.0.0',
    ]);
    expect(mocks.pocketBaseProcessConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        hooksDir: expect.stringMatching(/[/\\]pocketbase[/\\]hooks$/),
      }),
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/relay\/privileged\/reauth$/),
      {
        body: '{}',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      },
    );
    expect(callOrder(mocks.ensurePocketBaseAuthRateLimit, 0)).toBeLessThan(
      callOrder(mocks.pbProcess.start, 1),
    );
    expect(mocks.superuserAuth).toHaveBeenCalledWith('admin@relay.app', 'super-secret-passphrase');
    expect(mocks.superuserAuth).toHaveBeenCalledTimes(2);
    expect(mocks.execFileSync).not.toHaveBeenCalled();
    expect(mocks.rmSync).toHaveBeenCalledWith(expect.stringMatching(REPAIR_DIRECTORY_PATTERN), {
      recursive: true,
      force: true,
    });
    expect(callOrder(mocks.rmSync, 0)).toBeLessThan(callOrder(mocks.pbProcess.start, 0));
    expect(mocks.ensurePocketBaseAuthRateLimit).toHaveBeenCalledOnce();
    expect(callOrder(mocks.ensurePocketBaseAuthRateLimit, 0)).toBeGreaterThan(
      callOrder(mocks.superuserAuth, 0),
    );
    expect(callOrder(onHealthy, 0)).toBeGreaterThan(
      callOrder(mocks.ensurePocketBaseAuthRateLimit, 0),
    );
    expect(onHealthy).toHaveBeenCalledOnce();
    expect(onCredentialsReady).toHaveBeenCalledOnce();
    expect(onSchemaReady).toHaveBeenCalledOnce();
    expect(mocks.clearRelayAppUserAuthCoordinator).toHaveBeenCalledOnce();
    expect(callOrder(mocks.clearRelayAppUserAuthCoordinator, 0)).toBeLessThan(
      callOrder(mocks.pbProcess.start, 0),
    );
    expect(mocks.primeRelayAppUserAuth).toHaveBeenCalledWith(
      expect.anything(),
      'http://127.0.0.1:8090',
      'super-secret-passphrase',
    );
    expect(callOrder(mocks.primeRelayAppUserAuth, 0)).toBeGreaterThan(
      callOrder(mocks.appUserAuth, 0),
    );
  });

  it('retires the previous retention schedule even when PocketBase is not running', async () => {
    // A crashed process is not "running" while it waits out its restart backoff.
    mocks.getPbProcess.mockReturnValue(mocks.pbProcess);
    mocks.pbProcess.isRunning.mockReturnValue(false);
    mocks.getRetentionManager.mockReturnValue(mocks.retentionManager);
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

    // Otherwise the orphaned daily schedule keeps authenticating on the retired
    // client alongside the new one.
    expect(mocks.retentionManager.stop).toHaveBeenCalledOnce();
    expect(mocks.setRetentionManager).toHaveBeenCalledWith(null);
    // The retired process is stopped before anything new starts, which cancels
    // its pending crash restart.
    expect(callOrder(mocks.pbProcess.stop, 0)).toBeLessThan(callOrder(mocks.pbProcess.start, 0));
  });

  it('reports an occupied port when the PocketBase process cannot start', async () => {
    mocks.existsSync.mockImplementation(
      (path) =>
        String(path).endsWith('relay_privileged_reauth.pb.js') ||
        String(path).endsWith('pocketbase.exe'),
    );
    mocks.pbProcess.start.mockRejectedValueOnce(
      new Error('PocketBase failed to become healthy within 10000ms'),
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
        'C:\\Users\\Relay\\data',
      ),
    ).resolves.toEqual({
      status: 'failed',
      reason:
        'PocketBase could not start on port 8090. Another program may already be using that port.',
    });
  });

  it('reports a missing bundled binary when the PocketBase process cannot start', async () => {
    // Only the hook file exists, so the platform binary is absent.
    mocks.pbProcess.start.mockRejectedValueOnce(new Error('spawn ENOENT'));
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
    ).resolves.toEqual({ status: 'failed', reason: START_FAILURE.binaryMissing });
  });

  it('never logs a server-reflected secret while retrying app-user authentication', async () => {
    vi.useFakeTimers();
    const secret = ['reflected', 'bootstrap', 'secret'].join('-');
    mocks.appUserAuth.mockRejectedValue(
      Object.assign(new Error(`server reflected ${secret}`), {
        status: 500,
        response: { message: `server reflected ${secret}` },
      }),
    );
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    try {
      const startup = startPocketBase(
        {
          mode: 'server',
          bindHost: '0.0.0.0',
          port: 8090,
          secret,
        },
        'C:\\Users\\Relay\\data',
      );
      await vi.advanceTimersByTimeAsync(1_500);

      await expect(startup).resolves.toEqual({
        status: 'failed',
        reason: START_FAILURE.appUser,
      });
      expect(mocks.appUserAuth).toHaveBeenCalledTimes(3);
      expect(mocks.loggers.pocketbase.warn).toHaveBeenCalledWith(
        'Failed to ensure app user',
        expect.objectContaining({
          authFailure: { category: 'server-error', status: 500 },
        }),
      );
      expect(
        JSON.stringify([
          ...mocks.loggers.pocketbase.warn.mock.calls,
          ...mocks.loggers.pocketbase.error.mock.calls,
        ]),
      ).not.toContain(secret);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails closed before spawning PocketBase when the privileged hook is missing', async () => {
    mocks.existsSync.mockReturnValue(false);
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
      status: 'failed',
      reason: START_FAILURE.hooksMissing,
    });

    expect(mocks.pocketBaseProcessConstructor).not.toHaveBeenCalled();
    expect(mocks.pbProcess.start).not.toHaveBeenCalled();
    expect(mocks.superuserAuth).not.toHaveBeenCalled();
  });

  it('stops startup when the privileged reauthentication route is not loaded', async () => {
    mocks.fetch.mockResolvedValueOnce({ status: 404 });
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
      status: 'failed',
      reason: START_FAILURE.reauthenticationRoute,
    });

    expect(mocks.pbProcess.start).toHaveBeenCalledOnce();
    expect(mocks.pbProcess.stop).toHaveBeenCalledOnce();
    expect(mocks.superuserAuth).not.toHaveBeenCalled();
  });

  it('repairs and restarts once after a definitive superuser credential rejection', async () => {
    const onHealthy = vi.fn();
    const secret = 'spaces " & | %PATH% ; $(not-a-command)';
    mocks.superuserAuth
      .mockRejectedValueOnce(Object.assign(new Error('invalid credentials'), { status: 401 }))
      .mockResolvedValue({});
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    await expect(
      startPocketBase(
        {
          mode: 'server',
          bindHost: '0.0.0.0',
          port: 8090,
          secret,
        },
        'C:\\Users\\Relay\\data',
        { onHealthy },
      ),
    ).resolves.toEqual({ status: 'started', privilegedRuntimeReady: true });

    expect(mocks.pbProcess.stop).toHaveBeenCalledTimes(2);
    expect(mocks.pbProcess.start).toHaveBeenCalledTimes(3);
    const [repairBinary, repairArgs, repairOptions] = mocks.execFileSync.mock.calls[0] as [
      string,
      string[],
      {
        env?: NodeJS.ProcessEnv;
        stdio?: string;
        timeout?: number;
        windowsHide?: boolean;
      },
    ];
    expect(repairBinary).toBe('C:\\Relay\\resources\\pocketbase\\pocketbase.exe');
    expect(repairArgs).toEqual([
      'migrate',
      'up',
      expect.stringMatching(REPAIR_MIGRATIONS_ARGUMENT_PATTERN),
      expect.stringMatching(/^--dir=C:\\Users\\Relay\\data[/\\]pb_data$/),
    ]);
    expect(JSON.stringify(repairArgs)).not.toContain(secret);
    expect(repairOptions).toEqual({
      timeout: 10_000,
      stdio: 'ignore',
      windowsHide: true,
    });
    expect(repairOptions).not.toHaveProperty('env');
    expect(JSON.stringify(repairOptions)).not.toContain(secret);
    expect(mocks.mkdirSync).toHaveBeenCalledWith(expect.stringMatching(REPAIR_DIRECTORY_PATTERN), {
      recursive: false,
      mode: 0o700,
    });
    expect(mocks.chmodSync).toHaveBeenCalledWith(
      expect.stringMatching(REPAIR_DIRECTORY_PATTERN),
      0o700,
    );
    const [migrationPath, migrationSource, migrationWriteOptions] = mocks.writeFileSync.mock
      .calls[0] as [string, string, object];
    expect(migrationPath).toMatch(
      /\.relay-pb-repair-[0-9a-f]{16}[/\\]\d+_relay_superuser_repair_11111111222243338444555555555555\.js$/,
    );
    expect(migrationSource).toContain('$os.readFile(');
    expect(migrationSource).toContain('$os.remove(');
    expect(migrationSource).toContain('$os.writeFile(');
    expect(migrationSource).toContain('relay-superuser-repair:11111111222243338444555555555555');
    expect(migrationSource).toContain('admin@relay.app');
    expect(migrationSource).not.toContain(secret);
    expect(migrationSource.indexOf('$os.remove(')).toBeLessThan(
      migrationSource.indexOf('record.set("password", secret)'),
    );
    expect(migrationSource.indexOf('app.save(record)')).toBeLessThan(
      migrationSource.indexOf('$os.writeFile('),
    );
    expect(migrationWriteOptions).toEqual({
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    const [secretPath, secretContents, secretWriteOptions] = mocks.writeFileSync.mock.calls[1] as [
      string,
      string,
      object,
    ];
    expect(secretPath).toMatch(/[/\\]\.relay-superuser-repair-payload$/);
    expect(secretContents).toBe(secret);
    expect(secretWriteOptions).toEqual({
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    expect(mocks.readFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/[/\\]\.relay-superuser-repair-complete$/),
      'utf8',
    );
    expect(mocks.rmSync).toHaveBeenLastCalledWith(expect.stringMatching(REPAIR_DIRECTORY_PATTERN), {
      recursive: true,
      force: true,
    });
    expect(mocks.superuserAuth).toHaveBeenCalledTimes(3);
    expect(mocks.ensurePocketBaseAuthRateLimit).toHaveBeenCalledOnce();
    expect(callOrder(mocks.ensurePocketBaseAuthRateLimit, 0)).toBeGreaterThan(
      callOrder(mocks.superuserAuth, 1),
    );
    expect(onHealthy).toHaveBeenCalledOnce();
    expect(callOrder(onHealthy, 0)).toBeGreaterThan(
      callOrder(mocks.ensurePocketBaseAuthRateLimit, 0),
    );
  });

  it('repairs a minimum-length eight-character server secret', async () => {
    const secret = '12345678';
    mocks.superuserAuth
      .mockRejectedValueOnce(Object.assign(new Error('invalid credentials'), { status: 401 }))
      .mockResolvedValue({});
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    await expect(
      startPocketBase(
        {
          mode: 'server',
          bindHost: '0.0.0.0',
          port: 8090,
          secret,
        },
        'C:\\Users\\Relay\\data',
      ),
    ).resolves.toEqual({ status: 'started', privilegedRuntimeReady: true });

    const migrationSource = mocks.writeFileSync.mock.calls[0]?.[1];
    expect(migrationSource).toContain('secretInfo.size() < 8');
    expect(mocks.writeFileSync.mock.calls[1]?.[1]).toBe(secret);
    expect(mocks.superuserAuth).toHaveBeenCalledTimes(3);
  });

  it('creates and verifies a protected Windows repair directory before writing secrets', async () => {
    const originalPlatform = process.platform;
    const originalSystemRoot = process.env.SystemRoot;
    const secret = 'windows-secret';
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    process.env.SystemRoot = 'D:\\Windows';
    mocks.superuserAuth
      .mockRejectedValueOnce(Object.assign(new Error('invalid credentials'), { status: 401 }))
      .mockResolvedValue({});
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    try {
      await expect(
        startPocketBase(
          {
            mode: 'server',
            bindHost: '0.0.0.0',
            port: 8090,
            secret,
          },
          'C:\\Users\\Relay\\data',
        ),
      ).resolves.toEqual({ status: 'started', privilegedRuntimeReady: true });
    } finally {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: originalPlatform,
      });
      if (originalSystemRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = originalSystemRoot;
    }

    expect(mocks.mkdirSync).not.toHaveBeenCalled();
    const [powerShellPath, powerShellArgs, powerShellOptions] = mocks.execFileSync.mock
      .calls[0] as [string, string[], object];
    expect(powerShellPath).toBe('D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(powerShellArgs.slice(0, -1)).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
    ]);
    const aclScript = Buffer.from(powerShellArgs.at(-1)!, 'base64').toString('utf16le');
    expect(aclScript).toContain('DirectorySecurity');
    expect(aclScript).toContain('DirectoryInfo');
    expect(aclScript).toContain('AreAccessRulesProtected');
    expect(aclScript).toContain('S-1-5-18');
    expect(aclScript).toContain('ContainerInherit');
    expect(aclScript).toContain('ObjectInherit');
    expect(aclScript).not.toContain(secret);
    expect(powerShellOptions).toEqual({
      timeout: 5_000,
      stdio: 'ignore',
      windowsHide: true,
    });
    expect(callOrder(mocks.writeFileSync, 0)).toBeGreaterThan(callOrder(mocks.execFileSync, 0));
    expect(mocks.execFileSync.mock.calls[1]?.[1]).toEqual([
      'migrate',
      'up',
      expect.stringMatching(REPAIR_MIGRATIONS_ARGUMENT_PATTERN),
      expect.stringMatching(/^--dir=C:\\Users\\Relay\\data[/\\]pb_data$/),
    ]);
  });

  it('fails before writing a repair secret when the Windows ACL cannot be secured', async () => {
    const originalPlatform = process.platform;
    const originalSystemRoot = process.env.SystemRoot;
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    process.env.SystemRoot = 'D:\\Windows';
    mocks.superuserAuth.mockRejectedValueOnce(
      Object.assign(new Error('invalid credentials'), { status: 401 }),
    );
    mocks.execFileSync.mockImplementationOnce(() => {
      throw new Error('ACL unavailable');
    });
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    try {
      await expect(
        startPocketBase(
          {
            mode: 'server',
            bindHost: '0.0.0.0',
            port: 8090,
            secret: 'windows-secret',
          },
          'C:\\Users\\Relay\\data',
        ),
      ).resolves.toEqual({
        status: 'failed',
        reason: START_FAILURE.credentialRepair,
      });
    } finally {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: originalPlatform,
      });
      if (originalSystemRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = originalSystemRoot;
    }

    expect(mocks.execFileSync).toHaveBeenCalledOnce();
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
  });

  it('uses a fresh migration on each successive credential repair', async () => {
    mocks.randomUUID
      .mockReturnValueOnce('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
      .mockReturnValueOnce('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    mocks.readFileSync
      .mockReturnValueOnce('relay-superuser-repair:aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa')
      .mockReturnValueOnce('relay-superuser-repair:bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb');
    mocks.superuserAuth
      .mockRejectedValueOnce(Object.assign(new Error('invalid credentials'), { status: 401 }))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(Object.assign(new Error('invalid credentials'), { status: 401 }))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    const config: ServerConfig = {
      mode: 'server',
      bindHost: '0.0.0.0',
      port: 8090,
      secret: 'rotated-secret',
    };
    await expect(startPocketBase(config, 'C:\\Users\\Relay\\data')).resolves.toEqual({
      status: 'started',
      privilegedRuntimeReady: true,
    });
    await expect(startPocketBase(config, 'C:\\Users\\Relay\\data')).resolves.toEqual({
      status: 'started',
      privilegedRuntimeReady: true,
    });

    expect(mocks.execFileSync).toHaveBeenCalledTimes(2);
    expect(mocks.writeFileSync).toHaveBeenCalledTimes(4);
    const migrationPaths = mocks.writeFileSync.mock.calls
      .map(([path]) => path as string)
      .filter((path) => path.endsWith('.js'));
    expect(migrationPaths[0]).toContain(
      'relay_superuser_repair_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa.js',
    );
    expect(migrationPaths[1]).toContain(
      'relay_superuser_repair_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb.js',
    );
    expect(new Set(migrationPaths).size).toBe(2);
    expect(mocks.execFileSync.mock.calls.every(([, , options]) => !('env' in options))).toBe(true);
    expect(JSON.stringify(mocks.execFileSync.mock.calls)).not.toContain(config.secret);
    expect(
      mocks.rmSync.mock.calls.filter(([path]) => REPAIR_DIRECTORY_PATTERN.test(String(path))),
    ).toHaveLength(4);
  });

  it('does not mutate credentials after an ambiguous superuser failure', async () => {
    const secret = ['reflected', 'superuser', 'secret'].join('-');
    mocks.superuserAuth.mockRejectedValueOnce(
      Object.assign(new Error(`server reflected ${secret}`), {
        status: 0,
        response: { message: `server reflected ${secret}` },
      }),
    );
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    await expect(
      startPocketBase(
        {
          mode: 'server',
          bindHost: '0.0.0.0',
          port: 8090,
          secret,
        },
        'C:\\Users\\Relay\\data',
      ),
    ).resolves.toEqual({
      status: 'failed',
      reason: START_FAILURE.authentication,
    });

    expect(mocks.execFileSync).not.toHaveBeenCalled();
    expect(mocks.pbProcess.stop).not.toHaveBeenCalled();
    expect(mocks.pbProcess.start).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.loggers.pocketbase.error.mock.calls)).not.toContain(secret);
  });

  it('fails startup before healthy callbacks when auth rate limiting cannot be enforced', async () => {
    const onHealthy = vi.fn();
    const onCredentialsReady = vi.fn();
    const onSchemaReady = vi.fn();
    mocks.ensurePocketBaseAuthRateLimit.mockRejectedValueOnce(
      new Error('required auth rate limit unavailable'),
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
        'C:\\Users\\Relay\\data',
        { onHealthy, onCredentialsReady, onSchemaReady },
      ),
    ).resolves.toEqual({
      status: 'failed',
      reason: START_FAILURE.rateLimit,
    });

    expect(mocks.ensurePocketBaseAuthRateLimit).toHaveBeenCalledOnce();
    expect(mocks.pbProcess.stop).toHaveBeenCalledOnce();
    expect(onHealthy).not.toHaveBeenCalled();
    expect(onCredentialsReady).not.toHaveBeenCalled();
    expect(onSchemaReady).not.toHaveBeenCalled();
    expect(mocks.appUserAuth).not.toHaveBeenCalled();
    expect(mocks.ensureKnowledgeBatchApi).not.toHaveBeenCalled();
    expect(mocks.ensureCollections).not.toHaveBeenCalled();
  });

  it('fails startup when credential repair cannot complete', async () => {
    mocks.superuserAuth.mockRejectedValueOnce(
      Object.assign(new Error('invalid credentials'), { status: 401 }),
    );
    mocks.execFileSync.mockImplementationOnce(() => {
      throw new Error('database locked');
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
      status: 'failed',
      reason: START_FAILURE.credentialRepair,
    });

    expect(mocks.pbProcess.stop).toHaveBeenCalledOnce();
    expect(mocks.pbProcess.start).toHaveBeenCalledOnce();
  });

  it('stops the restarted server when post-repair authentication still fails', async () => {
    mocks.pbProcess.isRunning.mockReturnValue(true);
    mocks.superuserAuth
      .mockRejectedValueOnce(Object.assign(new Error('invalid credentials'), { status: 401 }))
      .mockRejectedValueOnce(Object.assign(new Error('still invalid'), { status: 401 }));
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
      status: 'failed',
      reason: START_FAILURE.authentication,
    });

    expect(mocks.pbProcess.start).toHaveBeenCalledTimes(2);
    expect(mocks.pbProcess.stop).toHaveBeenCalledTimes(2);
  });

  it('fails closed when PocketBase exits zero without applying the repair migration', async () => {
    mocks.superuserAuth.mockRejectedValueOnce(
      Object.assign(new Error('invalid credentials'), { status: 401 }),
    );
    mocks.readFileSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('completion marker missing'), { code: 'ENOENT' });
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
      status: 'failed',
      reason: START_FAILURE.credentialRepair,
    });

    expect(mocks.execFileSync).toHaveBeenCalledOnce();
    expect(mocks.pbProcess.start).toHaveBeenCalledOnce();
    expect(mocks.superuserAuth).toHaveBeenCalledOnce();
    expect(mocks.rmSync).toHaveBeenLastCalledWith(expect.stringMatching(REPAIR_DIRECTORY_PATTERN), {
      recursive: true,
      force: true,
    });
  });

  it('logs only allowlisted metadata when credential repair fails', async () => {
    const visibleSuffix = ['visible', 'suffix'].join('-');
    const secret = `x --${visibleSuffix}`;
    const renderedCommand = [
      'Command failed: pocketbase superuser upsert admin@relay.app',
      secret,
      '--dir=C:\\Users\\Relay\\data\\pb_data',
    ].join(' ');
    const repairError = Object.assign(new Error(renderedCommand), {
      code: 'ERR_REPAIR_FAILED',
      status: 1,
      signal: 'SIGTERM',
      killed: true,
      cmd: renderedCommand,
      spawnargs: ['superuser', 'upsert', 'admin@relay.app', secret],
      stdout: `stdout echoed ${secret}`,
      stderr: `stderr echoed ${visibleSuffix}`,
    });
    mocks.superuserAuth.mockRejectedValueOnce(
      Object.assign(new Error('invalid credentials'), { status: 401 }),
    );
    mocks.execFileSync.mockImplementationOnce(() => {
      throw repairError;
    });
    const { startPocketBase } = await import('../pocketbaseBootstrap');

    await expect(
      startPocketBase(
        {
          mode: 'server',
          bindHost: '0.0.0.0',
          port: 8090,
          secret,
        },
        'C:\\Users\\Relay\\data',
      ),
    ).resolves.toEqual({
      status: 'failed',
      reason: START_FAILURE.credentialRepair,
    });

    const repairLog = mocks.loggers.pocketbase.error.mock.calls.find(
      ([message]) => message === 'Failed to repair superuser via CLI',
    );
    expect(repairLog?.[1]).toEqual({
      failure: {
        code: 'ERR_REPAIR_FAILED',
        status: 1,
        signal: 'SIGTERM',
        killed: true,
      },
      binaryPath: 'C:\\Relay\\resources\\pocketbase\\pocketbase.exe',
      pbDataDir: expect.stringContaining('pb_data'),
    });
    expect(repairLog?.[1]).not.toHaveProperty('error');
    expect(JSON.stringify(repairLog)).not.toContain(secret);
    expect(JSON.stringify(repairLog)).not.toContain(visibleSuffix);

    const startupLog = mocks.loggers.pocketbase.error.mock.calls.find(
      ([message]) => message === 'Failed to start PocketBase',
    );
    const startupError = (startupLog?.[1] as { error?: unknown } | undefined)?.error;
    expect(startupError).toBeInstanceOf(Error);
    expect((startupError as Error).message).toBe('PocketBase superuser credential repair failed.');
    expect((startupError as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it('keeps optional Wiki search storage entirely outside required startup', async () => {
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
    expect(mocks.ensureKnowledgeSearchCollections).not.toHaveBeenCalled();
  });

  it('stops startup when the required PocketBase batch API cannot be enabled', async () => {
    mocks.ensureKnowledgeBatchApi.mockRejectedValue(new Error('batch API unavailable'));
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
    ).resolves.toEqual({
      status: 'failed',
      reason: START_FAILURE.fallback,
    });

    expect(mocks.ensureCollections).not.toHaveBeenCalled();
    expect(mocks.ensureKnowledgeSearchCollections).not.toHaveBeenCalled();
    expect(mocks.loggers.pocketbase.error).toHaveBeenCalledWith(
      'Failed to start PocketBase',
      expect.objectContaining({ error: expect.any(Error) }),
    );
  });

  it('waits the full 250ms before retrying optional Wiki search storage', async () => {
    vi.useFakeTimers();
    mocks.ensureKnowledgeSearchCollections.mockRejectedValueOnce(
      new Error('temporary search storage failure'),
    );
    const { initializeOptionalKnowledgeSearch } = await import('../pocketbaseBootstrap');

    try {
      const startup = initializeOptionalKnowledgeSearch({} as never);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledOnce();
      expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledWith(expect.anything(), {
        batchApiReady: true,
      });

      await vi.advanceTimersByTimeAsync(249);
      expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledTimes(2);
      await expect(startup).resolves.toBe(true);
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
    const { initializeOptionalKnowledgeSearch } = await import('../pocketbaseBootstrap');

    try {
      const startup = initializeOptionalKnowledgeSearch({} as never);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(3_000);

      await expect(startup).resolves.toBe(false);
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
    const { initializeOptionalKnowledgeSearch } = await import('../pocketbaseBootstrap');

    try {
      const startup = initializeOptionalKnowledgeSearch({} as never);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(3_000);

      await expect(startup).resolves.toBe(false);
      rejectOptionalBootstrap(new Error('late optional bootstrap failure'));
      await vi.advanceTimersByTimeAsync(250);

      expect(unhandledRejections).toEqual([]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
      vi.useRealTimers();
    }
  });

  it('does not let a cancelled optional Wiki bootstrap mutate a newer runtime', async () => {
    const oldPb = { id: 'old' };
    const newPb = { id: 'new' };
    let resolveBootstrap!: () => void;
    mocks.ensureKnowledgeSearchCollections.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveBootstrap = resolve;
        }),
    );
    mocks.getPbClient.mockReturnValue(oldPb as never);
    const { startDeferredPocketBaseServices } = await import('../pocketbaseBootstrap');

    const cancel = startDeferredPocketBaseServices({
      mode: 'server',
      bindHost: '127.0.0.1',
      port: 8090,
      secret: 'super-secret-passphrase',
    });
    await vi.waitFor(() => expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledOnce());

    cancel();
    mocks.getPbClient.mockReturnValue(newPb as never);
    resolveBootstrap();
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.restartKnowledgeSearchRuntime).not.toHaveBeenCalled();
    expect(mocks.stopKnowledgeSearchRuntime).not.toHaveBeenCalled();
  });

  it('starts optional Wiki search only for the still-current PocketBase client', async () => {
    const currentPb = { id: 'current' };
    mocks.getPbClient.mockReturnValue(currentPb as never);
    const { startDeferredPocketBaseServices } = await import('../pocketbaseBootstrap');

    startDeferredPocketBaseServices({
      mode: 'server',
      bindHost: '127.0.0.1',
      port: 8090,
      secret: 'super-secret-passphrase',
    });

    await vi.waitFor(() => expect(mocks.restartKnowledgeSearchRuntime).toHaveBeenCalledOnce());
    expect(mocks.stopKnowledgeSearchRuntime).not.toHaveBeenCalled();
  });

  it('checks whether the daily automatic backup is due before retention cleanup', async () => {
    const { startPocketBase, startPocketBaseMaintenanceSchedule } =
      await import('../pocketbaseBootstrap');

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

    expect(mocks.startSchedule).not.toHaveBeenCalled();
    mocks.getRetentionManager.mockReturnValue(mocks.retentionManager);
    startPocketBaseMaintenanceSchedule({
      mode: 'server',
      bindHost: '0.0.0.0',
      port: 8090,
      secret: 'super-secret-passphrase',
    });
    expect(mocks.startSchedule).toHaveBeenCalledWith(
      24 * 60 * 60 * 1000,
      expect.any(Function),
      30_000,
    );
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
