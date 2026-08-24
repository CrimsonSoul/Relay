import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rename, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupWindowsRuntimes, scheduleWindowsRuntimeCleanup } from '../windowsRuntimeCleanup';
import { serializeRecoveryCatalog, type RecoveryBuildRecord } from '../../releases/RecoveryCatalog';

const tempRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'relay-runtime-cleanup-'));
  tempRoots.push(root);
  return root;
}

async function makeCompleteRuntime(runtimeRoot: string, buildId: string): Promise<string> {
  const directory = join(runtimeRoot, buildId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, '.relay-runtime-ready'),
    `[Relay]\nprotocol=1\nbuildId=${buildId}\n`,
  );
  await writeFile(join(directory, 'Relay.exe'), 'fixture');
  return directory;
}

async function makeRecoveryRuntime(runtimeRoot: string, buildId: string): Promise<string> {
  const directory = join(runtimeRoot, buildId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, '.relay-runtime-ready'),
    `[Relay]\nprotocol=2\nbuildId=${buildId}\n`,
  );
  await writeFile(join(directory, 'Relay.exe'), 'fixture');
  return directory;
}

function recoveryBuild(
  buildId: string,
  version: string,
  commit: string,
  snapshotId: string | null,
): RecoveryBuildRecord {
  return {
    buildId,
    version,
    releaseTag: `v${version}`,
    targetCommitish: commit,
    runtimeSha512: 'a'.repeat(128),
    installerSha256: 'b'.repeat(64),
    recoveryProtocol: 2,
    serverDataEpoch: 1,
    clientDataEpoch: 1,
    installedAt: '2026-08-24T15:00:00.000Z',
    health: 'healthy',
    rollbackSnapshotId: snapshotId,
  };
}

async function makeSnapshot(userDataRoot: string, snapshotId: string): Promise<string> {
  const directory = join(userDataRoot, 'RecoverySnapshots', snapshotId);
  await mkdir(join(directory, 'data'), { recursive: true });
  await writeFile(join(directory, 'data', 'data.db'), 'fixture');
  await writeFile(
    join(directory, 'snapshot.ini'),
    `[Snapshot]\nprotocol=1\nsnapshotId=${snapshotId}\ncomplete=1\n`,
  );
  return directory;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Windows runtime cleanup', () => {
  it('is scheduled after workspace readiness and cancelled during app cleanup', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8');

    expect(source).toContain("await import('./app/windowsRuntimeCleanup')");
    expect(source).toContain('cancelWindowsRuntimeCleanup?.();');
    expect(source.indexOf("startupTimeline.mark('workspace-ready')")).toBeLessThan(
      source.indexOf('const postWorkspace = await completePostWorkspaceRuntime('),
    );
    expect(source).toContain('const cancelWindowsRuntimeCleanup = scheduleWindowsRuntimeCleanup(');
  });

  it('removes only unreferenced complete runtimes and stale staging directories', async () => {
    const root = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const currentDir = await makeCompleteRuntime(runtimeRoot, 'r1-current');
    const previousDir = await makeCompleteRuntime(runtimeRoot, 'r1-previous');
    const orphanDir = await makeCompleteRuntime(runtimeRoot, 'r1-orphan');
    const oldStage = join(runtimeRoot, '.staging-r1-old-123');
    const freshStage = join(runtimeRoot, '.staging-r1-fresh-456');
    const oldQuarantine = join(runtimeRoot, '.corrupt-r1-damaged-123-456');
    const freshQuarantine = join(runtimeRoot, '.corrupt-r1-recent-234-567');
    await mkdir(oldStage, { recursive: true });
    await mkdir(freshStage, { recursive: true });
    await mkdir(oldQuarantine, { recursive: true });
    await mkdir(freshQuarantine, { recursive: true });
    await writeFile(join(oldQuarantine, '.relay-quarantine-created'), '');
    await writeFile(join(freshQuarantine, '.relay-quarantine-created'), '');
    const now = Date.now();
    await utimes(
      oldStage,
      new Date(now - 25 * 60 * 60 * 1000),
      new Date(now - 25 * 60 * 60 * 1000),
    );
    await utimes(
      oldQuarantine,
      new Date(now - 25 * 60 * 60 * 1000),
      new Date(now - 25 * 60 * 60 * 1000),
    );
    await utimes(
      join(oldQuarantine, '.relay-quarantine-created'),
      new Date(now - 25 * 60 * 60 * 1000),
      new Date(now - 25 * 60 * 60 * 1000),
    );
    await writeFile(
      join(root, 'state.ini'),
      '[Relay]\nprotocol=1\ncurrent=r1-current\nprevious=r1-previous\n',
    );

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(currentDir, 'Relay.exe'),
      nowMs: now,
    });

    expect(result.removed).toEqual([
      '.corrupt-r1-damaged-123-456',
      '.staging-r1-old-123',
      'r1-orphan',
    ]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        '.corrupt-r1-recent-234-567',
        '.staging-r1-fresh-456',
        'r1-current',
        'r1-previous',
      ]),
    );
    expect(result.failed).toEqual([]);
    expect(existsSync(currentDir)).toBe(true);
    expect(existsSync(previousDir)).toBe(true);
    expect(existsSync(orphanDir)).toBe(false);
    expect(existsSync(oldStage)).toBe(false);
    expect(existsSync(freshStage)).toBe(true);
    expect(existsSync(oldQuarantine)).toBe(false);
    expect(existsSync(freshQuarantine)).toBe(true);
  });

  it('preserves the current, candidate, and all three protocol-2 retained runtimes', async () => {
    const root = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const currentDir = await makeRecoveryRuntime(runtimeRoot, 'r2-current');
    const candidateDir = await makeRecoveryRuntime(runtimeRoot, 'r2-candidate');
    const previous0Dir = await makeRecoveryRuntime(runtimeRoot, 'r2-previous0');
    const previous1Dir = await makeRecoveryRuntime(runtimeRoot, 'r2-previous1');
    const previous2Dir = await makeRecoveryRuntime(runtimeRoot, 'r2-previous2');
    const orphanDir = await makeRecoveryRuntime(runtimeRoot, 'r2-orphan');
    const current = recoveryBuild('r2-current', '1.5.0', '1'.repeat(40), null);
    const candidate = {
      ...recoveryBuild('r2-candidate', '1.6.0', '2'.repeat(40), null),
      health: 'candidate' as const,
    };
    const previous0 = recoveryBuild('r2-previous0', '1.4.0', '3'.repeat(40), null);
    const previous1 = recoveryBuild('r2-previous1', '1.3.0', '4'.repeat(40), null);
    const previous2 = recoveryBuild('r2-previous2', '1.2.0', '5'.repeat(40), null);
    await writeFile(
      join(root, 'state.ini'),
      serializeRecoveryCatalog({
        protocol: 2,
        generation: 5,
        currentBuildId: current.buildId,
        candidateBuildId: candidate.buildId,
        previousBuildIds: [previous0.buildId, previous1.buildId, previous2.buildId],
        builds: [current, candidate, previous0, previous1, previous2],
        transaction: {
          id: '11111111-2222-4333-8444-555555555555',
          kind: 'update',
          phase: 'probation',
          sourceBuildId: current.buildId,
          targetBuildId: candidate.buildId,
          mode: 'client',
          snapshotId: null,
          attempts: 1,
          requestedAt: '2026-08-24T15:05:00.000Z',
        },
        failedReleaseFingerprints: [],
      }),
    );

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(currentDir, 'Relay.exe'),
    });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        'r2-candidate',
        'r2-current',
        'r2-previous0',
        'r2-previous1',
        'r2-previous2',
        'r2-orphan',
      ]),
    );
    expect(existsSync(candidateDir)).toBe(true);
    expect(existsSync(previous0Dir)).toBe(true);
    expect(existsSync(previous1Dir)).toBe(true);
    expect(existsSync(previous2Dir)).toBe(true);
    expect(existsSync(orphanDir)).toBe(true);
  });

  it('preserves every complete runtime while a prepared update receipt is pending ingestion', async () => {
    const root = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const current = recoveryBuild('r2-current', '1.5.0', '1'.repeat(40), null);
    const currentDir = await makeRecoveryRuntime(runtimeRoot, current.buildId);
    const preparedDir = await makeRecoveryRuntime(runtimeRoot, 'r2-prepared');
    await makeRecoveryRuntime(runtimeRoot, 'r2-orphan');
    await writeFile(
      join(root, 'state.ini'),
      serializeRecoveryCatalog({
        protocol: 2,
        generation: 5,
        currentBuildId: current.buildId,
        candidateBuildId: null,
        previousBuildIds: [],
        builds: [current],
        transaction: null,
        failedReleaseFingerprints: [],
      }),
    );
    await mkdir(join(root, 'Recovery'));
    await writeFile(join(root, 'Recovery', 'prepared.ini'), '[Prepared]\nbuildId=r2-prepared\n');

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(currentDir, 'Relay.exe'),
    });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining(['r2-current', 'r2-prepared', 'r2-orphan']),
    );
    expect(existsSync(preparedDir)).toBe(true);
  });

  it('removes only complete unreferenced server snapshots after the catalog settles', async () => {
    const root = await makeRoot();
    const userDataRoot = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const current = recoveryBuild('r2-current', '1.6.0', '1'.repeat(40), null);
    const previous = recoveryBuild(
      'r2-previous',
      '1.5.0',
      '2'.repeat(40),
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    );
    const currentDir = await makeRecoveryRuntime(runtimeRoot, current.buildId);
    await makeRecoveryRuntime(runtimeRoot, previous.buildId);
    await writeFile(
      join(root, 'state.ini'),
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
    const retainedSnapshot = await makeSnapshot(userDataRoot, previous.rollbackSnapshotId!);
    const orphanId = '11111111-2222-4333-8444-555555555555';
    const orphanSnapshot = await makeSnapshot(userDataRoot, orphanId);
    await mkdir(join(userDataRoot, 'RecoverySnapshots', 'unknown-snapshot'));

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(currentDir, 'Relay.exe'),
      userDataRoot,
    });

    expect(result.removed).toContain(`snapshot:${orphanId}`);
    expect(result.skipped).toContain(`snapshot:${previous.rollbackSnapshotId}`);
    expect(result.skipped).toContain('snapshot:unknown-snapshot');
    expect(existsSync(retainedSnapshot)).toBe(true);
    expect(existsSync(orphanSnapshot)).toBe(false);
  });

  it('preserves every snapshot while a recovery request is pending', async () => {
    const root = await makeRoot();
    const userDataRoot = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const current = recoveryBuild('r2-current', '1.6.0', '1'.repeat(40), null);
    const currentDir = await makeRecoveryRuntime(runtimeRoot, current.buildId);
    await writeFile(
      join(root, 'state.ini'),
      serializeRecoveryCatalog({
        protocol: 2,
        generation: 4,
        currentBuildId: current.buildId,
        candidateBuildId: null,
        previousBuildIds: [],
        builds: [current],
        transaction: null,
        failedReleaseFingerprints: [],
      }),
    );
    const orphanId = '11111111-2222-4333-8444-555555555555';
    const orphanSnapshot = await makeSnapshot(userDataRoot, orphanId);
    await mkdir(join(root, 'Recovery'));
    await writeFile(join(root, 'Recovery', 'rollback-request.ini'), 'pending');

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(currentDir, 'Relay.exe'),
      userDataRoot,
    });

    expect(result.removed).not.toContain(`snapshot:${orphanId}`);
    expect(result.skipped).toContain(`snapshot:${orphanId}`);
    expect(existsSync(orphanSnapshot)).toBe(true);
  });

  it('does not run while the bootstrap holds the runtime lock', async () => {
    const root = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const currentDir = await makeCompleteRuntime(runtimeRoot, 'r1-current');
    const orphanDir = await makeCompleteRuntime(runtimeRoot, 'r1-orphan');
    await writeFile(join(root, 'state.ini'), '[Relay]\nprotocol=1\ncurrent=r1-current\n');
    const acquireLock = vi.fn(async () => null);

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(currentDir, 'Relay.exe'),
      acquireLock,
    });

    expect(acquireLock).toHaveBeenCalledWith(await realpath(root));
    expect(result).toEqual({ removed: [], skipped: [], failed: [] });
    expect(existsSync(orphanDir)).toBe(true);
  });

  it('uses quarantine creation time instead of the renamed runtime mtime', async () => {
    const root = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const currentDir = await makeCompleteRuntime(runtimeRoot, 'r1-current');
    const damagedDir = await makeCompleteRuntime(runtimeRoot, 'r1-damaged');
    const quarantineDir = join(runtimeRoot, '.corrupt-r1-damaged-123-456');
    const now = Date.now();
    const old = new Date(now - 25 * 60 * 60 * 1000);
    await utimes(damagedDir, old, old);
    await rename(damagedDir, quarantineDir);
    const createdMarker = join(quarantineDir, '.relay-quarantine-created');
    await writeFile(createdMarker, '');
    await utimes(quarantineDir, old, old);
    await writeFile(join(root, 'state.ini'), '[Relay]\nprotocol=1\ncurrent=r1-current\n');

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(currentDir, 'Relay.exe'),
      nowMs: now,
    });

    expect(result.removed).not.toContain('.corrupt-r1-damaged-123-456');
    expect(result.skipped).toContain('.corrupt-r1-damaged-123-456');
    expect(existsSync(quarantineDir)).toBe(true);
  });

  it('revalidates the managed runtime root after acquiring the lock', async () => {
    const root = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const originalRuntimeRoot = join(root, 'Runtime.original');
    const outsideRuntimeRoot = join(root, 'outside-runtime');
    const currentDir = await makeCompleteRuntime(runtimeRoot, 'r1-current');
    const outsideOrphan = await makeCompleteRuntime(outsideRuntimeRoot, 'r1-orphan');
    await writeFile(join(root, 'state.ini'), '[Relay]\nprotocol=1\ncurrent=r1-current\n');
    const release = vi.fn(async () => undefined);
    const acquireLock = vi.fn(async () => {
      await rename(runtimeRoot, originalRuntimeRoot);
      await symlink(outsideRuntimeRoot, runtimeRoot, 'dir');
      return release;
    });

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(currentDir, 'Relay.exe'),
      acquireLock,
    });

    expect(result).toEqual({ removed: [], skipped: [], failed: [] });
    expect(existsSync(outsideOrphan)).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });

  it('skips symlinks, unknown directories, and runtimes without a valid marker', async () => {
    const root = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const currentDir = await makeCompleteRuntime(runtimeRoot, 'r1-current');
    const outsideTarget = join(root, 'outside-target');
    const linkPath = join(runtimeRoot, 'r1-linked');
    const unknownDir = join(runtimeRoot, 'support-files');
    const incompleteDir = join(runtimeRoot, 'r1-incomplete');
    const reservedQuarantine = join(runtimeRoot, '.corrupt-con-123-456');
    const orphanDir = await makeCompleteRuntime(runtimeRoot, 'r1-orphan');
    await mkdir(outsideTarget, { recursive: true });
    await symlink(outsideTarget, linkPath, 'dir');
    await mkdir(unknownDir, { recursive: true });
    await mkdir(incompleteDir, { recursive: true });
    await mkdir(reservedQuarantine, { recursive: true });
    await writeFile(join(root, 'state.ini'), '[Relay]\nprotocol=1\ncurrent=../escape\n');

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(currentDir, 'Relay.exe'),
      nowMs: Date.now(),
    });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        '.corrupt-con-123-456',
        'r1-current',
        'r1-incomplete',
        'r1-linked',
        'support-files',
      ]),
    );
    expect(existsSync(outsideTarget)).toBe(true);
    expect(existsSync(linkPath)).toBe(true);
    expect(existsSync(incompleteDir)).toBe(true);
    expect(existsSync(reservedQuarantine)).toBe(true);
    expect(existsSync(orphanDir)).toBe(true);
  });

  it('fails closed for complete runtimes when state is missing but still removes stale staging', async () => {
    const root = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const executingDir = await makeCompleteRuntime(runtimeRoot, 'r1-executing');
    const activeDir = await makeCompleteRuntime(runtimeRoot, 'r1-active');
    const oldStage = join(runtimeRoot, '.staging-r1-old-123');
    await mkdir(oldStage, { recursive: true });
    const now = Date.now();
    await utimes(
      oldStage,
      new Date(now - 25 * 60 * 60 * 1000),
      new Date(now - 25 * 60 * 60 * 1000),
    );

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(executingDir, 'Relay.exe'),
      nowMs: now,
    });

    expect(result.removed).toEqual(['.staging-r1-old-123']);
    expect(result.skipped).toEqual(expect.arrayContaining(['r1-active', 'r1-executing']));
    expect(existsSync(activeDir)).toBe(true);
  });

  it('does nothing when the managed Relay root is a symlink', async () => {
    const parent = await makeRoot();
    const targetRoot = join(parent, 'target-root');
    const linkedRoot = join(parent, 'managed-root');
    const runtimeRoot = join(targetRoot, 'Runtime');
    const executingDir = await makeCompleteRuntime(runtimeRoot, 'r1-current');
    const orphanDir = await makeCompleteRuntime(runtimeRoot, 'r1-orphan');
    await writeFile(join(targetRoot, 'state.ini'), '[Relay]\nprotocol=1\ncurrent=r1-current\n');
    await symlink(targetRoot, linkedRoot, 'dir');

    const result = await cleanupWindowsRuntimes({
      root: linkedRoot,
      execPath: join(linkedRoot, 'Runtime', 'r1-current', 'Relay.exe'),
      nowMs: Date.now(),
    });

    expect(result).toEqual({ removed: [], skipped: [], failed: [] });
    expect(existsSync(executingDir)).toBe(true);
    expect(existsSync(orphanDir)).toBe(true);
  });

  it('does nothing when the executing Relay is outside the managed runtime root', async () => {
    const root = await makeRoot();
    const runtimeRoot = join(root, 'Runtime');
    const orphanDir = await makeCompleteRuntime(runtimeRoot, 'r1-orphan');

    const result = await cleanupWindowsRuntimes({
      root,
      execPath: join(root, 'Relay.exe'),
      nowMs: Date.now(),
    });

    expect(result).toEqual({ removed: [], skipped: [], failed: [] });
    expect(existsSync(orphanDir)).toBe(true);
  });

  it('schedules cleanup after readiness and returns a cancellation function', async () => {
    const cleanup = vi.fn(async () => ({ removed: [], skipped: [], failed: [] }));
    const unref = vi.fn();
    const timer = { unref } as unknown as NodeJS.Timeout;
    let scheduledCallback: (() => void) | undefined;
    const setTimer = vi.fn((callback: () => void) => {
      scheduledCallback = callback;
      return timer;
    });
    const clearTimer = vi.fn();

    const cancel = scheduleWindowsRuntimeCleanup({
      platform: 'win32',
      isPackaged: true,
      localAppData: 'C:\\Users\\relay\\AppData\\Local',
      execPath: 'C:\\Users\\relay\\AppData\\Local\\Relay\\Runtime\\r1-current\\Relay.exe',
      userDataRoot: 'C:\\Users\\relay\\AppData\\Roaming\\Relay',
      delayMs: 300_000,
      cleanup,
      setTimer,
      clearTimer,
    });

    expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 300_000);
    expect(unref).toHaveBeenCalledOnce();
    scheduledCallback?.();
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce());
    expect(cleanup).toHaveBeenCalledWith(
      expect.objectContaining({ userDataRoot: 'C:\\Users\\relay\\AppData\\Roaming\\Relay' }),
    );
    cancel();
    expect(clearTimer).toHaveBeenCalledWith(timer);
  });

  it('does not schedule outside a packaged Windows runtime', () => {
    const setTimer = vi.fn();

    scheduleWindowsRuntimeCleanup({ platform: 'darwin', isPackaged: true, setTimer });
    scheduleWindowsRuntimeCleanup({ platform: 'win32', isPackaged: false, setTimer });

    expect(setTimer).not.toHaveBeenCalled();
  });
});
