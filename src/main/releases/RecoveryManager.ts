import { randomUUID } from 'node:crypto';
import { lstat, open, readFile, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { IpcResult } from '@shared/ipc';
import type {
  RelayRecoveryBuildStatus,
  RelayRecoveryBuildView,
  RelayRecoveryState,
} from '@shared/recovery';
import {
  parseRecoveryCatalog,
  type RecoveryBuildRecord,
  type RecoveryCatalog,
  type RecoveryInstallationMode,
} from './RecoveryCatalog';
import {
  completeRecoveryRollbackRequest,
  writeRecoveryRollbackRequest,
  type RecoveryRollbackRequest,
} from './RecoveryRollbackRequest';
import { readRecoveryRuntimeMarker } from './RecoveryRuntimeIntegrity';

const MAX_CATALOG_BYTES = 128 * 1_024;
const MAX_MARKER_BYTES = 32 * 1_024;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

type PrepareRollbackInput = {
  relayRoot: string;
  userDataRoot: string;
  transactionId: string;
  sourceBuild: RecoveryBuildRecord;
  targetBuild: RecoveryBuildRecord;
  mode: 'server' | 'client';
};

type PrepareRollbackResult = {
  success: boolean;
  sourceSnapshotId: string | null;
};

type RepairRuntimeInput = {
  relayRoot: string;
  sourceBuild: RecoveryBuildRecord;
  targetBuild: RecoveryBuildRecord;
};

export type RecoveryManagerOptions = {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  localAppData: string;
  execPath: string;
  userDataRoot: string;
  getMode: () => RecoveryInstallationMode;
  createPrivateDirectory: (path: string) => unknown | Promise<unknown>;
  prepareRollback: (input: PrepareRollbackInput) => Promise<PrepareRollbackResult>;
  repairRuntime: (input: RepairRuntimeInput) => Promise<boolean>;
  relaunch: (options: { execPath: string }) => void;
  quit: () => void;
  defer?: (callback: () => void) => void;
  now?: () => Date;
  randomUuid?: () => string;
};

type RecoveryInspection = {
  relayRoot: string;
  stableLauncher: string;
  catalog: RecoveryCatalog;
  currentBuild: RecoveryBuildRecord;
  state: RelayRecoveryState;
};

type RecoveryRoots = {
  relayRoot: string;
  runtimeRoot: string;
  statePath: string;
  execPath: string;
};

function emptyState(supported: boolean, mode: RecoveryInstallationMode): RelayRecoveryState {
  return {
    supported,
    status: 'unavailable',
    mode,
    currentBuildId: null,
    currentVersion: null,
    runningBuildId: null,
    runningVersion: null,
    fallbackActive: false,
    retainedBuilds: [],
  };
}

function isDirectChild(parent: string, child: string, expectedName: string): boolean {
  const childRelative = relative(parent, child);
  return !isAbsolute(childRelative) && childRelative === expectedName;
}

function parseIniSection(text: string, sectionName: string): Map<string, string> | null {
  if (Buffer.byteLength(text, 'utf8') > MAX_MARKER_BYTES || text.includes('\0')) return null;
  const values = new Map<string, string>();
  let inRequestedSection = false;
  for (const sourceLine of text.split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      inRequestedSection = line === `[${sectionName}]`;
      continue;
    }
    if (!inRequestedSection) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) return null;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!key || values.has(key)) return null;
    values.set(key, value);
  }
  return values.size > 0 ? values : null;
}

async function isMzExecutable(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 2) return false;
    const handle = await open(path, 'r');
    try {
      const magic = Buffer.alloc(2);
      const result = await handle.read(magic, 0, magic.byteLength, 0);
      return result.bytesRead === 2 && magic[0] === 0x4d && magic[1] === 0x5a;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function isVerifiedRuntime(
  runtimeRoot: string,
  record: RecoveryBuildRecord,
): Promise<boolean> {
  const requestedDirectory = join(runtimeRoot, record.buildId);
  const executable = join(requestedDirectory, 'Relay.exe');
  const markerPath = join(requestedDirectory, '.relay-runtime-ready');
  try {
    const [realRuntimeRoot, directoryStats, realDirectory, markerStats, realExecutable] =
      await Promise.all([
        realpath(runtimeRoot),
        lstat(requestedDirectory),
        realpath(requestedDirectory),
        lstat(markerPath),
        realpath(executable),
      ]);
    if (
      !directoryStats.isDirectory() ||
      directoryStats.isSymbolicLink() ||
      !isDirectChild(realRuntimeRoot, realDirectory, record.buildId) ||
      !markerStats.isFile() ||
      markerStats.isSymbolicLink() ||
      markerStats.size > MAX_MARKER_BYTES ||
      !isDirectChild(realDirectory, realExecutable, 'Relay.exe') ||
      !(await isMzExecutable(realExecutable))
    ) {
      return false;
    }
    const verifiedMarker = await readRecoveryRuntimeMarker(requestedDirectory);
    const marker = verifiedMarker?.relay;
    return Boolean(
      marker &&
      verifiedMarker?.contentVerified &&
      marker.get('protocol') === '2' &&
      marker.get('buildId') === record.buildId &&
      marker.get('executable') === 'Relay.exe' &&
      verifiedMarker.runtimeSha512 === record.runtimeSha512 &&
      marker.get('version') === record.version &&
      marker.get('releaseTag') === record.releaseTag &&
      marker.get('targetCommitish') === record.targetCommitish &&
      marker.get('serverDataEpoch') === String(record.serverDataEpoch) &&
      marker.get('clientDataEpoch') === String(record.clientDataEpoch),
    );
  } catch {
    return false;
  }
}

async function hasValidServerSnapshot(
  userDataRoot: string,
  target: RecoveryBuildRecord,
): Promise<boolean> {
  if (!target.rollbackSnapshotId) return false;
  const snapshotsRoot = join(userDataRoot, 'RecoverySnapshots');
  const snapshotRoot = join(snapshotsRoot, target.rollbackSnapshotId);
  const markerPath = join(snapshotRoot, 'snapshot.ini');
  const dataPath = join(snapshotRoot, 'data');
  try {
    const [realUserDataRoot, snapshotsStats, realSnapshotsRoot, snapshotStats, realSnapshotRoot] =
      await Promise.all([
        realpath(userDataRoot),
        lstat(snapshotsRoot),
        realpath(snapshotsRoot),
        lstat(snapshotRoot),
        realpath(snapshotRoot),
      ]);
    if (
      !snapshotsStats.isDirectory() ||
      snapshotsStats.isSymbolicLink() ||
      !isDirectChild(realUserDataRoot, realSnapshotsRoot, 'RecoverySnapshots') ||
      !snapshotStats.isDirectory() ||
      snapshotStats.isSymbolicLink() ||
      !isDirectChild(realSnapshotsRoot, realSnapshotRoot, target.rollbackSnapshotId)
    ) {
      return false;
    }
    const [markerStats, dataStats, realDataPath] = await Promise.all([
      lstat(markerPath),
      lstat(dataPath),
      realpath(dataPath),
    ]);
    if (
      !markerStats.isFile() ||
      markerStats.isSymbolicLink() ||
      markerStats.size > MAX_MARKER_BYTES ||
      !dataStats.isDirectory() ||
      dataStats.isSymbolicLink() ||
      !isDirectChild(realSnapshotRoot, realDataPath, 'data')
    ) {
      return false;
    }
    const marker = parseIniSection(await readFile(markerPath, 'utf8'), 'Snapshot');
    return Boolean(
      marker &&
      marker.get('protocol') === '1' &&
      marker.get('snapshotId') === target.rollbackSnapshotId &&
      UUID_V4_PATTERN.test(marker.get('transactionId') ?? '') &&
      marker.get('sourceBuildId') === target.buildId &&
      marker.get('dataEpoch') === String(target.serverDataEpoch) &&
      /^(0|[1-9]\d*)$/u.test(marker.get('bytes') ?? '') &&
      marker.get('complete') === '1',
    );
  } catch {
    return false;
  }
}

async function hasPendingRecoveryRequest(relayRoot: string): Promise<boolean> {
  const recoveryRoot = join(relayRoot, 'Recovery');
  try {
    const [stats, realRecoveryRoot] = await Promise.all([
      lstat(recoveryRoot),
      realpath(recoveryRoot),
    ]);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      !isDirectChild(relayRoot, realRecoveryRoot, 'Recovery')
    ) {
      return true;
    }
    for (const name of ['update-request.ini', 'rollback-request.ini', 'repair-request.ini']) {
      try {
        await lstat(join(realRecoveryRoot, name));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true;
      }
    }
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT';
  }
}

function supportsRecovery(options: RecoveryManagerOptions): boolean {
  return (
    options.platform === 'win32' &&
    options.arch === 'x64' &&
    options.isPackaged &&
    isAbsolute(options.localAppData) &&
    isAbsolute(options.execPath) &&
    isAbsolute(options.userDataRoot)
  );
}

async function resolveRecoveryRoots(
  options: RecoveryManagerOptions,
): Promise<RecoveryRoots | null> {
  const requestedRelayRoot = resolve(options.localAppData, 'Relay');
  const requestedRuntimeRoot = join(requestedRelayRoot, 'Runtime');
  const statePath = join(requestedRelayRoot, 'state.ini');
  try {
    const [rootStats, relayRoot, runtimeStats, runtimeRoot, stateStats, execPath] =
      await Promise.all([
        lstat(requestedRelayRoot),
        realpath(requestedRelayRoot),
        lstat(requestedRuntimeRoot),
        realpath(requestedRuntimeRoot),
        lstat(statePath),
        realpath(options.execPath),
      ]);
    const pathsAreSafe =
      rootStats.isDirectory() &&
      !rootStats.isSymbolicLink() &&
      runtimeStats.isDirectory() &&
      !runtimeStats.isSymbolicLink() &&
      isDirectChild(relayRoot, runtimeRoot, 'Runtime');
    const stateIsSafe =
      stateStats.isFile() && !stateStats.isSymbolicLink() && stateStats.size <= MAX_CATALOG_BYTES;
    return pathsAreSafe && stateIsSafe ? { relayRoot, runtimeRoot, statePath, execPath } : null;
  } catch {
    return null;
  }
}

async function inspectRetainedBuild(
  record: RecoveryBuildRecord,
  currentBuild: RecoveryBuildRecord,
  roots: RecoveryRoots,
  options: RecoveryManagerOptions,
  mode: RecoveryInstallationMode,
): Promise<RelayRecoveryBuildStatus> {
  if (
    record.serverDataEpoch !== currentBuild.serverDataEpoch ||
    record.clientDataEpoch !== currentBuild.clientDataEpoch
  ) {
    return 'data-incompatible';
  }
  if (!(await isVerifiedRuntime(roots.runtimeRoot, record))) return 'runtime-missing';
  if (mode === 'server' && !(await hasValidServerSnapshot(options.userDataRoot, record))) {
    return 'snapshot-missing';
  }
  return 'ready';
}

async function createRetainedBuildViews(
  catalog: RecoveryCatalog,
  currentBuild: RecoveryBuildRecord,
  roots: RecoveryRoots,
  options: RecoveryManagerOptions,
  busy: boolean,
): Promise<RelayRecoveryBuildView[] | null> {
  const mode = options.getMode();
  const retainedBuilds: RelayRecoveryBuildView[] = [];
  for (const buildId of catalog.previousBuildIds) {
    const record = catalog.builds.find((item) => item.buildId === buildId);
    if (!record) return null;
    const status = await inspectRetainedBuild(record, currentBuild, roots, options, mode);
    retainedBuilds.push({
      buildId: record.buildId,
      version: record.version,
      releaseTag: record.releaseTag,
      installedAt: record.installedAt,
      status,
      rollbackAvailable: !busy && mode !== 'unconfigured' && status === 'ready',
      repairAvailable: !busy && mode !== 'unconfigured' && status === 'runtime-missing',
      githubFallbackAvailable: status === 'runtime-missing',
    });
  }
  return retainedBuilds;
}

async function inspect(options: RecoveryManagerOptions): Promise<RecoveryInspection | null> {
  const mode = options.getMode();
  if (!supportsRecovery(options)) return null;
  const roots = await resolveRecoveryRoots(options);
  if (!roots) return null;
  try {
    const executableRelative = relative(roots.runtimeRoot, roots.execPath).split(sep);
    if (executableRelative.length !== 2 || executableRelative[1]?.toLowerCase() !== 'relay.exe') {
      return null;
    }
    const executingBuildId = executableRelative[0] ?? '';
    const catalog = parseRecoveryCatalog(await readFile(roots.statePath, 'utf8'));
    const currentBuild = catalog?.builds.find(
      (record) => record.buildId === catalog.currentBuildId,
    );
    const runningBuild = catalog?.builds.find((record) => record.buildId === executingBuildId);
    if (
      !catalog ||
      !currentBuild ||
      !runningBuild ||
      (executingBuildId !== catalog.currentBuildId &&
        !catalog.previousBuildIds.includes(executingBuildId)) ||
      !(await isVerifiedRuntime(roots.runtimeRoot, runningBuild)) ||
      !(await isMzExecutable(join(roots.relayRoot, 'Relay.exe')))
    ) {
      return null;
    }

    const busy =
      catalog.candidateBuildId !== null ||
      catalog.transaction !== null ||
      (await hasPendingRecoveryRequest(roots.relayRoot));
    const retainedBuilds = await createRetainedBuildViews(
      catalog,
      currentBuild,
      roots,
      options,
      busy,
    );
    if (!retainedBuilds) return null;
    return {
      relayRoot: roots.relayRoot,
      stableLauncher: join(roots.relayRoot, 'Relay.exe'),
      catalog,
      currentBuild,
      state: {
        supported: true,
        status: busy ? 'busy' : 'ready',
        mode,
        currentBuildId: currentBuild.buildId,
        currentVersion: currentBuild.version,
        runningBuildId: runningBuild.buildId,
        runningVersion: runningBuild.version,
        fallbackActive: runningBuild.buildId !== currentBuild.buildId,
        retainedBuilds,
      },
    };
  } catch {
    return null;
  }
}

export class RecoveryManager {
  private readonly options: RecoveryManagerOptions;
  private operationPromise: Promise<IpcResult<boolean>> | null = null;

  constructor(options: RecoveryManagerOptions) {
    this.options = options;
  }

  async getState(): Promise<RelayRecoveryState> {
    const mode = this.options.getMode();
    const supported =
      this.options.platform === 'win32' && this.options.arch === 'x64' && this.options.isPackaged;
    const inspection = await inspect(this.options);
    if (!inspection) return emptyState(supported, mode);
    return this.operationPromise ? { ...inspection.state, status: 'busy' } : inspection.state;
  }

  rollback(targetBuildId: string): Promise<IpcResult<boolean>> {
    return this.runOperation(() => this.performRollback(targetBuildId));
  }

  repair(targetBuildId: string): Promise<IpcResult<boolean>> {
    return this.runOperation(() => this.performRepair(targetBuildId));
  }

  private runOperation(operation: () => Promise<IpcResult<boolean>>): Promise<IpcResult<boolean>> {
    if (this.operationPromise) return Promise.resolve({ success: false, error: 'busy' });
    const promise = operation();
    this.operationPromise = promise;
    const clear = () => {
      if (this.operationPromise === promise) this.operationPromise = null;
    };
    void promise.then(clear, clear);
    return promise;
  }

  private async performRepair(targetBuildId: string): Promise<IpcResult<boolean>> {
    const inspection = await inspect(this.options);
    const targetView = inspection?.state.retainedBuilds.find(
      (build) => build.buildId === targetBuildId,
    );
    const targetBuild = inspection?.catalog.builds.find((build) => build.buildId === targetBuildId);
    if (
      !inspection ||
      inspection.state.status !== 'ready' ||
      !targetView?.repairAvailable ||
      !targetBuild
    ) {
      return { success: false, error: 'target-unavailable' };
    }
    try {
      if (
        !(await this.options.repairRuntime({
          relayRoot: inspection.relayRoot,
          sourceBuild: inspection.currentBuild,
          targetBuild,
        }))
      ) {
        throw new Error('Runtime repair failed');
      }
      const refreshed = await inspect(this.options);
      const repaired = refreshed?.state.retainedBuilds.find(
        (build) => build.buildId === targetBuildId,
      );
      return repaired && repaired.status !== 'runtime-missing'
        ? { success: true, data: true }
        : { success: false, error: 'repair-failed' };
    } catch {
      return { success: false, error: 'repair-failed' };
    }
  }

  private async performRollback(targetBuildId: string): Promise<IpcResult<boolean>> {
    const inspection = await inspect(this.options);
    const mode = inspection?.state.mode;
    const targetView = inspection?.state.retainedBuilds.find(
      (build) => build.buildId === targetBuildId,
    );
    const targetBuild = inspection?.catalog.builds.find((build) => build.buildId === targetBuildId);
    if (
      !inspection ||
      inspection.state.status !== 'ready' ||
      (mode !== 'server' && mode !== 'client') ||
      !targetView?.rollbackAvailable ||
      !targetBuild
    ) {
      return { success: false, error: 'target-unavailable' };
    }

    const transactionId = this.options.randomUuid?.() ?? randomUUID();
    const request: RecoveryRollbackRequest = {
      protocol: 2,
      transactionId,
      sourceBuildId: inspection.currentBuild.buildId,
      targetBuildId: targetBuild.buildId,
      mode,
      checkpoint: 'pending',
      targetSnapshotId: mode === 'server' ? targetBuild.rollbackSnapshotId : null,
      sourceSnapshotId: null,
      requestedAt: (this.options.now?.() ?? new Date()).toISOString(),
    };

    let preparationStarted = false;
    const requestPath = join(inspection.relayRoot, 'Recovery', 'rollback-request.ini');
    try {
      await writeRecoveryRollbackRequest(
        inspection.relayRoot,
        request,
        this.options.createPrivateDirectory,
      );
      preparationStarted = true;
      const prepared = await this.options.prepareRollback({
        relayRoot: inspection.relayRoot,
        userDataRoot: this.options.userDataRoot,
        transactionId,
        sourceBuild: inspection.currentBuild,
        targetBuild,
        mode,
      });
      if (!prepared.success) throw new Error('Rollback preparation failed');
      await completeRecoveryRollbackRequest(
        inspection.relayRoot,
        transactionId,
        prepared.sourceSnapshotId,
      );
      const defer = this.options.defer ?? ((callback: () => void) => setImmediate(callback));
      defer(() => {
        this.options.relaunch({ execPath: inspection.stableLauncher });
        this.options.quit();
      });
      return { success: true, data: true };
    } catch {
      await rm(requestPath, { force: true }).catch(() => undefined);
      if (preparationStarted) {
        const defer = this.options.defer ?? ((callback: () => void) => setImmediate(callback));
        defer(() => {
          this.options.relaunch({ execPath: inspection.stableLauncher });
          this.options.quit();
        });
      }
      return { success: false, error: 'preparation-failed' };
    }
  }
}
