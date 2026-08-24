import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeRecoveryCatalog, type RecoveryBuildRecord } from './RecoveryCatalog';
import { RecoveryManager } from './RecoveryManager';
import { parseRecoveryRollbackRequest } from './RecoveryRollbackRequest';

const SHA512_A = 'a'.repeat(128);
const SHA512_B = 'b'.repeat(128);
const COMMIT_A = '1'.repeat(40);
const COMMIT_B = '2'.repeat(40);
const SNAPSHOT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TRANSACTION_ID = '11111111-2222-4333-8444-555555555555';
const SOURCE_SNAPSHOT_ID = '99999999-8888-4777-8666-555555555555';

let tempRoot: string;
let localAppData: string;
let relayRoot: string;
let userDataRoot: string;
let current: RecoveryBuildRecord;
let previous: RecoveryBuildRecord;

function build(
  buildId: string,
  version: string,
  runtimeSha512: string,
  targetCommitish: string,
  rollbackSnapshotId: string | null,
): RecoveryBuildRecord {
  return {
    buildId,
    version,
    releaseTag: `v${version}`,
    targetCommitish,
    runtimeSha512,
    installerSha256: 'f'.repeat(64),
    recoveryProtocol: 2,
    serverDataEpoch: 1,
    clientDataEpoch: 1,
    installedAt: '2026-08-24T15:00:00.000Z',
    health: 'healthy',
    rollbackSnapshotId,
  };
}

async function makeRuntime(record: RecoveryBuildRecord): Promise<string> {
  const directory = join(relayRoot, 'Runtime', record.buildId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'Relay.exe'), Buffer.from([0x4d, 0x5a, 0x00]));
  await writeFile(
    join(directory, '.relay-runtime-ready'),
    `${[
      '[Relay]',
      'protocol=2',
      `buildId=${record.buildId}`,
      'executable=Relay.exe',
      `payloadHash=${record.runtimeSha512}`,
      `version=${record.version}`,
      `releaseTag=${record.releaseTag}`,
      `targetCommitish=${record.targetCommitish}`,
      `serverDataEpoch=${record.serverDataEpoch}`,
      `clientDataEpoch=${record.clientDataEpoch}`,
      `installedAt=${record.installedAt}`,
    ].join('\n')}\n`,
  );
  return join(directory, 'Relay.exe');
}

async function writeCatalog(): Promise<void> {
  await writeFile(
    join(relayRoot, 'state.ini'),
    serializeRecoveryCatalog({
      protocol: 2,
      generation: 4,
      currentBuildId: current.buildId,
      candidateBuildId: null,
      previousBuildIds: [previous.buildId],
      builds: [current, previous],
      transaction: null,
      failedReleaseFingerprints: [],
    }),
  );
}

async function makeTargetSnapshot(): Promise<void> {
  const directory = join(userDataRoot, 'RecoverySnapshots', SNAPSHOT_ID);
  await mkdir(join(directory, 'data'), { recursive: true });
  await writeFile(join(directory, 'data', 'data.db'), 'snapshot');
  await writeFile(
    join(directory, 'snapshot.ini'),
    `${[
      '[Snapshot]',
      'protocol=1',
      `snapshotId=${SNAPSHOT_ID}`,
      'transactionId=22222222-3333-4444-8555-666666666666',
      `sourceBuildId=${previous.buildId}`,
      'dataEpoch=1',
      'bytes=8',
      'createdAt=2026-08-24T15:01:00.000Z',
      'complete=1',
    ].join('\n')}\n`,
  );
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'relay-recovery-manager-'));
  localAppData = join(tempRoot, 'Local');
  relayRoot = join(localAppData, 'Relay');
  userDataRoot = join(tempRoot, 'Roaming', 'Relay');
  await mkdir(join(relayRoot, 'Runtime'), { recursive: true });
  await mkdir(userDataRoot, { recursive: true });
  await writeFile(join(relayRoot, 'Relay.exe'), Buffer.from([0x4d, 0x5a, 0x00]));
  current = build(`r2-${COMMIT_A}`, '1.6.0', SHA512_A, COMMIT_A, null);
  previous = build(`r2-${COMMIT_B}`, '1.5.0', SHA512_B, COMMIT_B, SNAPSHOT_ID);
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

function createManager(
  mode: 'server' | 'client',
  execPath: string,
  overrides: Partial<ConstructorParameters<typeof RecoveryManager>[0]> = {},
) {
  return new RecoveryManager({
    platform: 'win32',
    arch: 'x64',
    isPackaged: true,
    localAppData,
    execPath,
    userDataRoot,
    getMode: () => mode,
    createPrivateDirectory: (path) => mkdir(path, { mode: 0o700 }),
    prepareRollback: vi.fn(async ({ transactionId, sourceBuild }) => ({
      success: true,
      sourceSnapshotId: mode === 'server' ? SOURCE_SNAPSHOT_ID : null,
      transactionId,
      sourceBuild,
    })),
    repairRuntime: vi.fn(async () => true),
    relaunch: vi.fn(),
    quit: vi.fn(),
    defer: (callback) => callback(),
    now: () => new Date('2026-08-24T15:10:00.000Z'),
    randomUuid: () => TRANSACTION_ID,
    ...overrides,
  });
}

describe('RecoveryManager', () => {
  it('lists only verified compatible builds and requires a server snapshot', async () => {
    const execPath = await makeRuntime(current);
    await makeRuntime(previous);
    await writeCatalog();
    const manager = createManager('server', execPath);

    expect(await manager.getState()).toMatchObject({
      supported: true,
      status: 'ready',
      mode: 'server',
      currentBuildId: current.buildId,
      currentVersion: current.version,
      retainedBuilds: [
        {
          buildId: previous.buildId,
          version: previous.version,
          status: 'snapshot-missing',
          rollbackAvailable: false,
          repairAvailable: false,
          githubFallbackAvailable: false,
        },
      ],
    });

    await makeTargetSnapshot();
    expect((await manager.getState()).retainedBuilds[0]).toMatchObject({
      status: 'ready',
      rollbackAvailable: true,
    });
  });

  it('reports a missing retained runtime without trusting the catalog marker alone', async () => {
    const execPath = await makeRuntime(current);
    await writeCatalog();

    expect((await createManager('client', execPath).getState()).retainedBuilds[0]).toMatchObject({
      status: 'runtime-missing',
      rollbackAvailable: false,
      repairAvailable: true,
      githubFallbackAvailable: true,
    });
  });

  it('operates from a verified retained recovery runtime when the catalog current cannot start', async () => {
    const execPath = await makeRuntime(previous);
    await writeCatalog();
    const manager = createManager('client', execPath);

    expect(await manager.getState()).toMatchObject({
      supported: true,
      status: 'ready',
      currentBuildId: current.buildId,
      currentVersion: current.version,
      runningBuildId: previous.buildId,
      runningVersion: previous.version,
      fallbackActive: true,
      retainedBuilds: [
        {
          buildId: previous.buildId,
          status: 'ready',
          rollbackAvailable: true,
        },
      ],
    });

    await expect(manager.rollback(previous.buildId)).resolves.toEqual({
      success: true,
      data: true,
    });
  });

  it('repairs one missing retained runtime from its exact catalog identity and revalidates it', async () => {
    const execPath = await makeRuntime(current);
    await writeCatalog();
    const repairRuntime = vi.fn(async () => {
      await makeRuntime(previous);
      return true;
    });
    const manager = createManager('client', execPath, { repairRuntime });

    await expect(manager.repair(previous.buildId)).resolves.toEqual({
      success: true,
      data: true,
    });
    expect(repairRuntime).toHaveBeenCalledWith({
      relayRoot: await realpath(relayRoot),
      sourceBuild: current,
      targetBuild: previous,
    });
    expect((await manager.getState()).retainedBuilds[0]).toMatchObject({
      status: 'ready',
      repairAvailable: false,
      rollbackAvailable: true,
    });
  });

  it('refuses repair when the target runtime is already usable or another request is pending', async () => {
    const execPath = await makeRuntime(current);
    await makeRuntime(previous);
    await writeCatalog();
    const repairRuntime = vi.fn(async () => true);
    const manager = createManager('client', execPath, { repairRuntime });

    await expect(manager.repair(previous.buildId)).resolves.toEqual({
      success: false,
      error: 'target-unavailable',
    });
    expect(repairRuntime).not.toHaveBeenCalled();

    await rm(join(relayRoot, 'Runtime', previous.buildId), { recursive: true, force: true });
    await mkdir(join(relayRoot, 'Recovery'), { recursive: true });
    await writeFile(join(relayRoot, 'Recovery', 'repair-request.ini'), 'pending');
    expect(await manager.getState()).toMatchObject({ status: 'busy' });
    await expect(manager.repair(previous.buildId)).resolves.toEqual({
      success: false,
      error: 'target-unavailable',
    });
    expect(repairRuntime).not.toHaveBeenCalled();
  });

  it('revalidates the target, writes a completed request, then relaunches the stable launcher', async () => {
    const execPath = await makeRuntime(current);
    await makeRuntime(previous);
    await writeCatalog();
    await makeTargetSnapshot();
    const relaunch = vi.fn();
    const quit = vi.fn();
    const prepareRollback = vi.fn(async () => ({
      success: true as const,
      sourceSnapshotId: SOURCE_SNAPSHOT_ID,
    }));
    const manager = createManager('server', execPath, { relaunch, quit, prepareRollback });

    await expect(manager.rollback(previous.buildId)).resolves.toEqual({
      success: true,
      data: true,
    });

    const request = parseRecoveryRollbackRequest(
      await readFile(join(relayRoot, 'Recovery', 'rollback-request.ini'), 'utf8'),
    );
    expect(request).toMatchObject({
      transactionId: TRANSACTION_ID,
      sourceBuildId: current.buildId,
      targetBuildId: previous.buildId,
      checkpoint: 'complete',
      targetSnapshotId: SNAPSHOT_ID,
      sourceSnapshotId: SOURCE_SNAPSHOT_ID,
    });
    expect(prepareRollback).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: TRANSACTION_ID,
        sourceBuild: current,
        targetBuild: previous,
      }),
    );
    expect(relaunch).toHaveBeenCalledWith({
      execPath: join(await realpath(relayRoot), 'Relay.exe'),
    });
    expect(quit).toHaveBeenCalledOnce();
  });

  it('refuses an incompatible target before stopping data services', async () => {
    const execPath = await makeRuntime(current);
    previous.clientDataEpoch = 2;
    await makeRuntime(previous);
    await writeCatalog();
    const prepareRollback = vi.fn();
    const manager = createManager('client', execPath, { prepareRollback });

    await expect(manager.rollback(previous.buildId)).resolves.toEqual({
      success: false,
      error: 'target-unavailable',
    });
    expect(prepareRollback).not.toHaveBeenCalled();
  });
});
