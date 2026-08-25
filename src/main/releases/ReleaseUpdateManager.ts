import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createReadStream, type Dirent } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  compareRelayVersions,
  type RelayUpdateCheck,
  type RelayUpdateFailureCode,
  type RelayUpdateSnapshot,
} from '@shared/releases';
import { createWindowsPrivateDirectory } from '../pocketbase/WindowsPrivateDirectory';
import {
  downloadReleaseAsset,
  type ReleaseAssetDownloadOptions,
  type ReleaseAssetDownloadResult,
} from './ReleaseAssetDownloader';
import { extractVerifiedRelayInstaller, parseRelayChecksum } from './RelayReleaseArchive';
import type {
  RelayInstallableAsset,
  RelayInstallableRelease,
  ReleaseUpdateService,
} from './ReleaseUpdateService';
import {
  isRecoveryBuildRecord,
  parseRecoveryCatalog,
  type RecoveryBuildRecord,
} from './RecoveryCatalog';
import { writeRecoveryUpdateRequest, type RecoveryUpdateRequest } from './RecoveryUpdateRequest';
import type { PrepareRecoveryRestartResult } from './RecoveryRestartCoordinator';
import { readRecoveryRuntimeMarker } from './RecoveryRuntimeIntegrity';

const BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const LOWER_HEX_PATTERN = /^[0-9a-f]+$/u;
const INSTALLER_NAME = 'Relay.exe';
const PREPARE_ONLY_ARGUMENT = '/relay-prepare-only';
const RECOVERY_TRANSACTION_ARGUMENT = '/relay-transaction=';
const ABANDONED_STAGING_AGE_MS = 24 * 60 * 60 * 1_000;
const DOWNLOAD_RETRY_FAILURES = new Set<RelayUpdateFailureCode>([
  'download-failed',
  'verification-failed',
  'cancelled',
]);

type UpdateService = Pick<ReleaseUpdateService, 'resolveLatestInstallable'>;
type DownloadAsset = (
  asset: RelayInstallableAsset,
  destination: string,
  options: ReleaseAssetDownloadOptions,
) => Promise<ReleaseAssetDownloadResult>;
type ExtractInstaller = (
  archivePath: string,
  destinationPath: string,
) => Promise<{ bytes: number; sha256: string }>;

export type ReleaseUpdateManagerOptions = {
  service: UpdateService;
  getCurrentVersion: () => string;
  platform?: NodeJS.Platform;
  arch?: string;
  isPackaged?: boolean;
  localAppData?: string;
  execPath?: string;
  downloadAsset?: DownloadAsset;
  extractInstaller?: ExtractInstaller;
  spawnInstaller?: (path: string, args: string[]) => Promise<number | null>;
  createPrivateDirectory?: (path: string) => unknown;
  getInstallationMode?: () => 'server' | 'client' | 'unconfigured';
  writeRecoveryRequest?: (
    relayRoot: string,
    request: RecoveryUpdateRequest,
    createPrivateDirectory: (path: string) => unknown,
  ) => Promise<string>;
  prepareRecoveryRestart?: (transactionId: string) => Promise<PrepareRecoveryRestartResult>;
  now?: () => Date;
  restartApp?: (execPath: string) => void;
};

type StagedUpdate = {
  version: string;
  targetCommitish: string;
  directory: string;
  installerPath: string;
  installerBytes: number;
  installerSha256: string;
};

type ManagedRoot = {
  root: string;
  realRoot: string;
  runtimeRoot: string;
  updatesRoot: string;
  stableLauncher: string;
};

function initialSnapshot(currentVersion: string): RelayUpdateSnapshot {
  return {
    phase: 'idle',
    currentVersion,
    latestVersion: null,
    installable: false,
    downloadedBytes: 0,
    totalBytes: null,
    failureCode: null,
  };
}

function preservesManualUpdateProgress(
  state: RelayUpdateSnapshot,
  nextVersion: string | null,
): boolean {
  if (state.latestVersion !== nextVersion) return false;
  if (
    state.phase === 'downloading' ||
    state.phase === 'downloaded' ||
    state.phase === 'installing' ||
    state.phase === 'ready-to-restart'
  ) {
    return true;
  }
  return (
    state.phase === 'error' &&
    (state.failureCode === 'install-failed' || state.failureCode === 'restart-unavailable')
  );
}

function unavailableReason(
  supportsInstallation: boolean,
  releaseQuarantined: boolean,
): RelayUpdateFailureCode | null {
  if (!supportsInstallation) return 'unsupported';
  if (releaseQuarantined) return 'release-quarantined';
  return null;
}

function isDirectChild(parent: string, child: string, expectedName: string): boolean {
  const relativePath = relative(parent, child);
  return !isAbsolute(relativePath) && relativePath === expectedName;
}

function isRandomUuid(value: string): boolean {
  const parts = value.split('-');
  const expectedLengths = [8, 4, 4, 4, 12];
  return (
    parts.length === expectedLengths.length &&
    parts.every(
      (part, index) => part.length === expectedLengths[index] && LOWER_HEX_PATTERN.test(part),
    ) &&
    parts[2]?.startsWith('4') === true &&
    '89ab'.includes(parts[3]?.[0] ?? '')
  );
}

function isUpdateStagingDirectory(value: string): boolean {
  const versionEnd = value.indexOf('-');
  if (!value.startsWith('v') || versionEnd <= 1) return false;
  const version = value.slice(1, versionEnd);
  return (
    compareRelayVersions(version, version) !== null && isRandomUuid(value.slice(versionEnd + 1))
  );
}

async function resolveManagedRoot(
  localAppData: string,
  execPath: string,
): Promise<ManagedRoot | null> {
  if (!isAbsolute(localAppData) || !isAbsolute(execPath)) return null;
  const requestedRoot = resolve(localAppData, 'Relay');
  const requestedRuntimeRoot = join(requestedRoot, 'Runtime');

  try {
    const [rootStats, runtimeStats, executableStats] = await Promise.all([
      lstat(requestedRoot),
      lstat(requestedRuntimeRoot),
      lstat(execPath),
    ]);
    if (
      !rootStats.isDirectory() ||
      rootStats.isSymbolicLink() ||
      !runtimeStats.isDirectory() ||
      runtimeStats.isSymbolicLink() ||
      !executableStats.isFile() ||
      executableStats.isSymbolicLink()
    ) {
      return null;
    }

    const [realRoot, runtimeRoot, executingPath] = await Promise.all([
      realpath(requestedRoot),
      realpath(requestedRuntimeRoot),
      realpath(execPath),
    ]);
    if (!isDirectChild(realRoot, runtimeRoot, 'Runtime')) return null;

    const executingRelativePath = relative(runtimeRoot, executingPath);
    if (!executingRelativePath || isAbsolute(executingRelativePath)) return null;
    const parts = executingRelativePath.split(sep);
    if (
      parts.length !== 2 ||
      !BUILD_ID_PATTERN.test(parts[0] ?? '') ||
      parts[1]?.toLowerCase() !== INSTALLER_NAME.toLowerCase()
    ) {
      return null;
    }

    return {
      root: requestedRoot,
      realRoot,
      runtimeRoot,
      updatesRoot: join(requestedRoot, 'Updates'),
      stableLauncher: join(requestedRoot, INSTALLER_NAME),
    };
  } catch {
    return null;
  }
}

async function readCurrentRecoveryBuild(
  execPath: string,
  currentVersion: string,
  observedAt: string,
): Promise<RecoveryBuildRecord> {
  const runtimeDirectory = dirname(execPath);
  const buildId = runtimeDirectory.slice(runtimeDirectory.lastIndexOf(sep) + 1);
  const verifiedMarker = await readRecoveryRuntimeMarker(runtimeDirectory);
  if (!verifiedMarker) throw new Error('Current Relay runtime marker was invalid');
  const marker = verifiedMarker.relay;
  const recoveryProtocol = Number(marker.get('protocol'));
  const serverDataEpoch = Number(marker.get('serverDataEpoch') ?? '1');
  const clientDataEpoch = Number(marker.get('clientDataEpoch') ?? '1');
  const inferredCommit = /^r\d+-([0-9a-f]{40})$/u.exec(buildId)?.[1] ?? '';
  const record: RecoveryBuildRecord = {
    buildId,
    version: currentVersion,
    releaseTag: `v${currentVersion}`,
    targetCommitish: marker.get('targetCommitish') ?? inferredCommit,
    runtimeSha512: verifiedMarker.runtimeSha512,
    installerSha256: marker.get('installerSha256') || null,
    recoveryProtocol,
    serverDataEpoch,
    clientDataEpoch,
    installedAt: marker.get('installedAt') ?? observedAt,
    health: 'healthy',
    rollbackSnapshotId: null,
  };
  if (
    marker.get('buildId') !== buildId ||
    marker.get('executable') !== INSTALLER_NAME ||
    (recoveryProtocol === 2 && !verifiedMarker.contentVerified) ||
    !isRecoveryBuildRecord(record)
  ) {
    throw new Error('Current Relay runtime did not have verified recovery metadata');
  }
  return record;
}

function spawnInstallerAndWait(path: string, args: string[]): Promise<number | null> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(path, args, {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('close', (code) => resolvePromise(code));
  });
}

async function executableSha256(path: string, expectedBytes: number): Promise<string> {
  const stats = await lstat(path);
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size !== expectedBytes ||
    expectedBytes < 2
  ) {
    throw new Error('Staged Relay installer metadata changed');
  }

  const handle = await open(path, 'r');
  try {
    const magic = Buffer.alloc(2);
    const result = await handle.read(magic, 0, magic.byteLength, 0);
    if (result.bytesRead !== 2 || magic[0] !== 0x4d || magic[1] !== 0x5a) {
      throw new Error('Staged Relay installer was not a Windows executable');
    }
  } finally {
    await handle.close();
  }

  const hash = createHash('sha256');
  for await (const value of createReadStream(path)) hash.update(value);
  return hash.digest('hex');
}

function releaseResolutionFailure(error: unknown): RelayUpdateFailureCode {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('immutable')) return 'release-not-immutable';
  if (message.includes('changed')) return 'release-changed';
  return 'verification-failed';
}

function downloadFailure(error: unknown): RelayUpdateFailureCode {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return [
    'archive',
    'checksum',
    'digest',
    'executable',
    'extraction',
    'integrity',
    'size',
    'verification',
    'zip',
  ].some((term) => message.includes(term))
    ? 'verification-failed'
    : 'download-failed';
}

function isRestartPending(state: RelayUpdateSnapshot): boolean {
  return (
    state.phase === 'ready-to-restart' ||
    (state.phase === 'error' && state.failureCode === 'restart-unavailable')
  );
}

function canStartDownload(state: RelayUpdateSnapshot): boolean {
  return (
    state.phase === 'available' ||
    (state.phase === 'error' &&
      state.failureCode !== null &&
      DOWNLOAD_RETRY_FAILURES.has(state.failureCode))
  );
}

function canStartInstall(state: RelayUpdateSnapshot): boolean {
  return (
    state.phase === 'downloaded' ||
    (state.phase === 'error' && state.failureCode === 'install-failed')
  );
}

export class ReleaseUpdateManager {
  private readonly options: Required<ReleaseUpdateManagerOptions>;
  private state: RelayUpdateSnapshot;
  private readonly listeners = new Set<(snapshot: RelayUpdateSnapshot) => void>();
  private staged: StagedUpdate | null = null;
  private downloadController: AbortController | null = null;
  private downloadPromise: Promise<RelayUpdateSnapshot> | null = null;
  private installPromise: Promise<RelayUpdateSnapshot> | null = null;
  private restartPromise: Promise<boolean> | null = null;
  private noteCheckPromise: Promise<RelayUpdateSnapshot> | null = null;
  private initializationPromise: Promise<void> | null = null;
  private recoveryTransactionId: string | null = null;

  constructor(options: ReleaseUpdateManagerOptions) {
    this.options = {
      service: options.service,
      getCurrentVersion: options.getCurrentVersion,
      platform: options.platform ?? process.platform,
      arch: options.arch ?? process.arch,
      isPackaged: options.isPackaged ?? false,
      localAppData: options.localAppData ?? '',
      execPath: options.execPath ?? process.execPath,
      downloadAsset: options.downloadAsset ?? downloadReleaseAsset,
      extractInstaller: options.extractInstaller ?? extractVerifiedRelayInstaller,
      spawnInstaller: options.spawnInstaller ?? spawnInstallerAndWait,
      createPrivateDirectory: options.createPrivateDirectory ?? createWindowsPrivateDirectory,
      getInstallationMode: options.getInstallationMode ?? (() => 'unconfigured'),
      writeRecoveryRequest: options.writeRecoveryRequest ?? writeRecoveryUpdateRequest,
      prepareRecoveryRestart: options.prepareRecoveryRestart ?? (async () => 'ready'),
      now: options.now ?? (() => new Date()),
      restartApp: options.restartApp ?? (() => undefined),
    };
    this.state = initialSnapshot(this.options.getCurrentVersion());
  }

  snapshot(): RelayUpdateSnapshot {
    return { ...this.state };
  }

  subscribe(listener: (snapshot: RelayUpdateSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  noteCheck(check: RelayUpdateCheck): Promise<RelayUpdateSnapshot> {
    if (this.noteCheckPromise) return this.noteCheckPromise;
    const promise = this.performNoteCheck(check);
    this.noteCheckPromise = promise;
    const clearPromise = () => {
      if (this.noteCheckPromise === promise) this.noteCheckPromise = null;
    };
    void promise.then(clearPromise, clearPromise);
    return promise;
  }

  private async performNoteCheck(check: RelayUpdateCheck): Promise<RelayUpdateSnapshot> {
    await this.initialize();
    if (this.installPromise || this.restartPromise || isRestartPending(this.state)) {
      return this.snapshot();
    }
    const nextVersion = check.updateAvailable ? check.latestVersion : null;
    if (this.downloadPromise && this.state.latestVersion !== nextVersion) {
      await this.cancelDownload();
    }
    if (this.staged && this.staged.version !== nextVersion) await this.clearStagedUpdate();

    if (check.updateAvailable && preservesManualUpdateProgress(this.state, nextVersion)) {
      return this.snapshot();
    }

    if (!check.updateAvailable) {
      this.publish(initialSnapshot(check.currentVersion));
      return this.snapshot();
    }

    const managedRoot = await this.supportedManagedRoot();
    const supportsInstallation = Boolean(managedRoot);
    const releaseQuarantined =
      managedRoot && check.targetCommitish
        ? await this.isReleaseQuarantined(managedRoot, check.latestVersion, check.targetCommitish)
        : false;

    this.publish({
      phase: 'available',
      currentVersion: check.currentVersion,
      latestVersion: check.latestVersion,
      installable: check.installable && supportsInstallation && !releaseQuarantined,
      downloadedBytes: 0,
      totalBytes: check.assetSizeBytes,
      failureCode: unavailableReason(supportsInstallation, releaseQuarantined),
    });
    return this.snapshot();
  }

  download(): Promise<RelayUpdateSnapshot> {
    if (this.downloadPromise) return this.downloadPromise;
    if (
      this.installPromise ||
      this.restartPromise ||
      this.noteCheckPromise ||
      !canStartDownload(this.state)
    ) {
      return Promise.resolve(this.snapshot());
    }
    const controller = new AbortController();
    this.downloadController = controller;
    const promise = this.performDownload(controller);
    this.downloadPromise = promise;
    const clearPromise = () => {
      if (this.downloadPromise === promise) this.downloadPromise = null;
      if (this.downloadController === controller) this.downloadController = null;
    };
    void promise.then(clearPromise, clearPromise);
    return promise;
  }

  cancelDownload(): Promise<RelayUpdateSnapshot> {
    const pendingDownload = this.downloadPromise;
    this.downloadController?.abort(new Error('Relay update download cancelled'));
    return pendingDownload ?? Promise.resolve(this.snapshot());
  }

  install(): Promise<RelayUpdateSnapshot> {
    if (this.installPromise) return this.installPromise;
    if (
      this.downloadPromise ||
      this.restartPromise ||
      this.noteCheckPromise ||
      !canStartInstall(this.state)
    ) {
      return Promise.resolve(this.snapshot());
    }
    const promise = this.performInstall();
    this.installPromise = promise;
    const clearPromise = () => {
      if (this.installPromise === promise) this.installPromise = null;
    };
    void promise.then(clearPromise, clearPromise);
    return promise;
  }

  private async performInstall(): Promise<RelayUpdateSnapshot> {
    await this.initialize();
    if (
      !this.staged ||
      (this.state.phase !== 'downloaded' && this.state.failureCode !== 'install-failed')
    ) {
      return this.fail('verification-failed');
    }

    const staged = this.staged;
    this.publish({ ...this.state, phase: 'installing', failureCode: null });
    let requestPath: string | null = null;
    try {
      await this.validateStagedInstaller(staged);
    } catch {
      await this.clearStagedUpdate();
      return this.fail('verification-failed');
    }

    try {
      const managedRoot = await this.supportedManagedRoot();
      if (!managedRoot) return this.fail('unsupported');
      const transactionId = randomUUID();
      const requestedAt = this.options.now().toISOString();
      const request: RecoveryUpdateRequest = {
        protocol: 2,
        transactionId,
        source: await readCurrentRecoveryBuild(
          this.options.execPath,
          this.options.getCurrentVersion(),
          requestedAt,
        ),
        targetVersion: staged.version,
        targetCommitish: staged.targetCommitish,
        targetInstallerSha256: staged.installerSha256,
        mode: this.options.getInstallationMode(),
        checkpoint: 'pending',
        snapshotId: null,
        requestedAt,
      };
      requestPath = await this.options.writeRecoveryRequest(
        managedRoot.root,
        request,
        this.options.createPrivateDirectory,
      );
      const exitCode = await this.options.spawnInstaller(staged.installerPath, [
        PREPARE_ONLY_ARGUMENT,
        `${RECOVERY_TRANSACTION_ARGUMENT}${transactionId}`,
      ]);
      if (exitCode !== 0) {
        await rm(requestPath, { force: true }).catch(() => undefined);
        return this.fail('install-failed');
      }
      this.recoveryTransactionId = transactionId;
      await this.clearStagedUpdate();
      this.publish({ ...this.state, phase: 'ready-to-restart', failureCode: null });
      return this.snapshot();
    } catch {
      if (requestPath) await rm(requestPath, { force: true }).catch(() => undefined);
      this.recoveryTransactionId = null;
      return this.fail('install-failed');
    }
  }

  restart(): Promise<boolean> {
    if (this.restartPromise) return this.restartPromise;
    if (
      this.downloadPromise ||
      this.installPromise ||
      this.noteCheckPromise ||
      !isRestartPending(this.state)
    ) {
      return Promise.resolve(false);
    }
    const promise = this.performRestart();
    this.restartPromise = promise;
    const clearPromise = () => {
      if (this.restartPromise === promise) this.restartPromise = null;
    };
    void promise.then(clearPromise, clearPromise);
    return promise;
  }

  private async performRestart(): Promise<boolean> {
    await this.initialize();

    const managedRoot = await this.supportedManagedRoot();
    if (!managedRoot || !(await this.isValidStableLauncher(managedRoot))) {
      this.fail('restart-unavailable');
      return false;
    }
    if (!this.recoveryTransactionId) {
      this.fail('restart-unavailable');
      return false;
    }

    const preparation = await this.options.prepareRecoveryRestart(this.recoveryTransactionId);
    if (preparation === 'unchanged') {
      this.fail('restart-unavailable');
      return false;
    }
    this.options.restartApp(managedRoot.stableLauncher);
    return true;
  }

  private async performDownload(controller: AbortController): Promise<RelayUpdateSnapshot> {
    await this.initialize();
    if (this.state.failureCode === 'release-quarantined') return this.snapshot();
    if (controller.signal.aborted) return this.restoreAvailableAfterCancellation();
    const managedRoot = await this.supportedManagedRoot();
    if (controller.signal.aborted) return this.restoreAvailableAfterCancellation();
    if (!managedRoot) return this.fail('unsupported');
    if (!this.state.latestVersion || !this.state.installable) {
      return this.fail('release-not-immutable');
    }
    const expectedVersion = this.state.latestVersion;

    let release: RelayInstallableRelease;
    try {
      release = await this.resolveDownloadRelease(expectedVersion);
    } catch (error) {
      if (controller.signal.aborted) return this.restoreAvailableAfterCancellation();
      return this.fail(releaseResolutionFailure(error));
    }
    if (controller.signal.aborted) return this.restoreAvailableAfterCancellation();

    await this.clearStagedUpdate();
    if (controller.signal.aborted) return this.restoreAvailableAfterCancellation();

    try {
      const staged = await this.stageRelease(managedRoot, release, controller);
      if (controller.signal.aborted) {
        await rm(staged.directory, { recursive: true, force: true }).catch(() => undefined);
        return this.restoreAvailableAfterCancellation();
      }
      this.staged = staged;
      this.publish({
        ...this.state,
        phase: 'downloaded',
        downloadedBytes: release.archive.size,
        totalBytes: release.archive.size,
        failureCode: null,
      });
      return this.snapshot();
    } catch (error) {
      this.staged = null;
      if (controller.signal.aborted) {
        this.publish({
          ...this.state,
          phase: 'available',
          downloadedBytes: 0,
          failureCode: null,
        });
        return this.snapshot();
      }
      return this.fail(downloadFailure(error));
    }
  }

  private restoreAvailableAfterCancellation(): RelayUpdateSnapshot {
    this.publish({
      ...this.state,
      phase: this.state.latestVersion ? 'available' : 'idle',
      downloadedBytes: 0,
      failureCode: null,
    });
    return this.snapshot();
  }

  private initialize(): Promise<void> {
    this.initializationPromise ??= this.cleanupAbandonedStaging().catch(() => undefined);
    return this.initializationPromise;
  }

  private async resolveDownloadRelease(expectedVersion: string): Promise<RelayInstallableRelease> {
    const release = await this.options.service.resolveLatestInstallable();
    if (
      release.version !== expectedVersion ||
      compareRelayVersions(release.version, this.options.getCurrentVersion()) !== 1
    ) {
      throw new Error('GitHub latest release changed after update discovery');
    }
    return release;
  }

  private async stageRelease(
    managedRoot: ManagedRoot,
    release: RelayInstallableRelease,
    controller: AbortController,
  ): Promise<StagedUpdate> {
    const directory = await this.createStagingDirectory(managedRoot, release.version);
    const checksumPath = join(directory, release.checksum.name);
    const archivePath = join(directory, release.archive.name);
    const installerPath = join(directory, INSTALLER_NAME);

    try {
      controller.signal.throwIfAborted();
      this.publish({
        ...this.state,
        phase: 'downloading',
        downloadedBytes: 0,
        totalBytes: release.archive.size,
        failureCode: null,
      });
      await this.options.downloadAsset(release.checksum, checksumPath, {
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      const declaredArchiveSha256 = parseRelayChecksum(
        await readFile(checksumPath, 'utf8'),
        release.archive.name,
      );
      controller.signal.throwIfAborted();
      if (declaredArchiveSha256 !== release.archive.sha256) {
        throw new Error('Relay checksum asset disagreed with GitHub release metadata');
      }

      const archiveResult = await this.options.downloadAsset(release.archive, archivePath, {
        signal: controller.signal,
        onProgress: (downloadedBytes, totalBytes) => {
          if (controller.signal.aborted) return;
          this.publish({ ...this.state, downloadedBytes, totalBytes });
        },
      });
      controller.signal.throwIfAborted();
      if (
        archiveResult.bytes !== release.archive.size ||
        archiveResult.sha256 !== release.archive.sha256
      ) {
        throw new Error('Relay archive verification result disagreed with release metadata');
      }

      const installer = await this.options.extractInstaller(archivePath, installerPath);
      controller.signal.throwIfAborted();
      if (!SHA256_PATTERN.test(installer.sha256) || installer.bytes < 2) {
        throw new Error('Relay installer extraction result was invalid');
      }
      return {
        version: release.version,
        targetCommitish: release.targetCommitish,
        directory,
        installerPath,
        installerBytes: installer.bytes,
        installerSha256: installer.sha256,
      };
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }

  private async supportedManagedRoot(): Promise<ManagedRoot | null> {
    if (
      this.options.platform !== 'win32' ||
      this.options.arch !== 'x64' ||
      !this.options.isPackaged ||
      !this.options.localAppData
    ) {
      return null;
    }
    return resolveManagedRoot(this.options.localAppData, this.options.execPath);
  }

  private async isReleaseQuarantined(
    managedRoot: ManagedRoot,
    version: string,
    targetCommitish: string,
  ): Promise<boolean> {
    const statePath = join(managedRoot.realRoot, 'state.ini');
    try {
      const [stats, resolvedStatePath] = await Promise.all([lstat(statePath), realpath(statePath)]);
      if (
        !stats.isFile() ||
        stats.isSymbolicLink() ||
        stats.size > 128 * 1_024 ||
        !isDirectChild(managedRoot.realRoot, resolvedStatePath, 'state.ini')
      ) {
        return false;
      }
      const catalog = parseRecoveryCatalog(await readFile(resolvedStatePath, 'utf8'));
      return catalog?.failedReleaseFingerprints.includes(`v${version}@${targetCommitish}`) ?? false;
    } catch {
      return false;
    }
  }

  private async cleanupAbandonedStaging(): Promise<void> {
    const managedRoot = await this.supportedManagedRoot();
    if (!managedRoot) return;

    let realUpdatesRoot: string;
    let entries: Dirent<string>[];
    try {
      const updatesStats = await lstat(managedRoot.updatesRoot);
      realUpdatesRoot = await realpath(managedRoot.updatesRoot);
      if (
        !updatesStats.isDirectory() ||
        updatesStats.isSymbolicLink() ||
        !isDirectChild(managedRoot.realRoot, realUpdatesRoot, 'Updates')
      ) {
        return;
      }
      entries = await readdir(managedRoot.updatesRoot, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!isUpdateStagingDirectory(entry.name)) continue;
      const path = join(managedRoot.updatesRoot, entry.name);
      try {
        const [currentRootStats, currentRealRoot, stats, resolvedPath] = await Promise.all([
          lstat(managedRoot.updatesRoot),
          realpath(managedRoot.updatesRoot),
          lstat(path),
          realpath(path),
        ]);
        if (
          !currentRootStats.isDirectory() ||
          currentRootStats.isSymbolicLink() ||
          currentRealRoot !== realUpdatesRoot ||
          !entry.isDirectory() ||
          entry.isSymbolicLink() ||
          !stats.isDirectory() ||
          stats.isSymbolicLink() ||
          Date.now() - stats.mtimeMs < ABANDONED_STAGING_AGE_MS ||
          !isDirectChild(realUpdatesRoot, resolvedPath, entry.name)
        ) {
          continue;
        }
        await rm(path, { recursive: true, force: true });
      } catch {
        // A stale or concurrently changed entry is safer to leave in place.
      }
    }
  }

  private async createStagingDirectory(managedRoot: ManagedRoot, version: string): Promise<string> {
    await mkdir(managedRoot.updatesRoot, { recursive: true, mode: 0o700 });
    const updatesStats = await lstat(managedRoot.updatesRoot);
    const realUpdatesRoot = await realpath(managedRoot.updatesRoot);
    if (
      !updatesStats.isDirectory() ||
      updatesStats.isSymbolicLink() ||
      !isDirectChild(managedRoot.realRoot, realUpdatesRoot, 'Updates')
    ) {
      throw new Error('Relay update staging root was redirected');
    }

    const directoryName = `v${version}-${randomUUID()}`;
    const directory = join(managedRoot.updatesRoot, directoryName);
    await this.options.createPrivateDirectory(directory);
    const stats = await lstat(directory);
    const resolvedDirectory = await realpath(directory);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      !isDirectChild(realUpdatesRoot, resolvedDirectory, directoryName)
    ) {
      throw new Error('Relay update staging directory was redirected');
    }
    return directory;
  }

  private async validateStagedInstaller(staged: StagedUpdate): Promise<void> {
    const [directoryStats, installerStats, realDirectory, realInstaller] = await Promise.all([
      lstat(staged.directory),
      lstat(staged.installerPath),
      realpath(staged.directory),
      realpath(staged.installerPath),
    ]);
    if (
      !directoryStats.isDirectory() ||
      directoryStats.isSymbolicLink() ||
      !installerStats.isFile() ||
      installerStats.isSymbolicLink() ||
      !isDirectChild(realDirectory, realInstaller, INSTALLER_NAME)
    ) {
      throw new Error('Staged Relay installer path changed');
    }

    const sha256 = await executableSha256(realInstaller, staged.installerBytes);
    if (sha256 !== staged.installerSha256) {
      throw new Error('Staged Relay installer digest changed');
    }
  }

  private async isValidStableLauncher(managedRoot: ManagedRoot): Promise<boolean> {
    try {
      const stats = await lstat(managedRoot.stableLauncher);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size < 2) return false;
      const stablePath = await realpath(managedRoot.stableLauncher);
      if (!isDirectChild(managedRoot.realRoot, stablePath, INSTALLER_NAME)) return false;
      const handle = await open(stablePath, 'r');
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

  private async clearStagedUpdate(): Promise<void> {
    const staged = this.staged;
    this.staged = null;
    if (staged) {
      await rm(staged.directory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private fail(failureCode: RelayUpdateFailureCode): RelayUpdateSnapshot {
    this.publish({ ...this.state, phase: 'error', failureCode });
    return this.snapshot();
  }

  private publish(snapshot: RelayUpdateSnapshot): void {
    this.state = { ...snapshot };
    const publicSnapshot = this.snapshot();
    for (const listener of this.listeners) listener(publicSnapshot);
  }
}
