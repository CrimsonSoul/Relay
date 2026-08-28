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
  parseLegacyRecoveryState,
  parseRecoveryCatalog,
  type RecoveryBuildRecord,
  type LegacyRecoveryState,
  type RecoveryCatalog,
  type RecoveryInstallationMode,
} from './RecoveryCatalog';
import { readRecoveryPreparedUpdate, type RecoveryPreparedUpdate } from './RecoveryPreparedUpdate';
import {
  readRecoveryUpdateRequest,
  writeRecoveryUpdateRequest,
  type RecoveryUpdateRequest,
} from './RecoveryUpdateRequest';
import type { PrepareRecoveryRestartResult } from './RecoveryRestartCoordinator';
import { readRecoveryRuntimeMarker, type RecoveryRuntimeMarker } from './RecoveryRuntimeIntegrity';

const BUILD_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const LOWER_HEX_PATTERN = /^[0-9a-f]+$/u;
const INSTALLER_NAME = 'Relay.exe';
const PREPARE_ONLY_ARGUMENT = '/relay-prepare-only';
const RECOVERY_TRANSACTION_ARGUMENT = '/relay-transaction=';
const ABANDONED_STAGING_AGE_MS = 24 * 60 * 60 * 1_000;
const MAX_LEGACY_STATE_BYTES = 128 * 1_024;
const BOOTSTRAP_FAILURE_FILE = 'bootstrap-error.ini';
const MAX_BOOTSTRAP_FAILURE_BYTES = 4 * 1_024;
const SAFE_DIAGNOSTIC_CODE_PATTERN = /^[A-Z][A-Z0-9_-]{0,63}$/u;
const KNOWN_BOOTSTRAP_FAILURE_REASONS = new Set([
  `Relay could not create its local runtime folder.`,
  `Relay could not inspect its local runtime folder.`,
  `Relay cannot prepare inside a redirected runtime folder.`,
  `Relay could not bind recovery to its current runtime.`,
  `Relay could not find its private recovery request.`,
  `Relay recovery metadata was redirected.`,
  `Relay rejected mismatched retained-build repair metadata.`,
  `Relay rejected a changed retained-build installer.`,
  `Relay rejected mismatched recovery update metadata.`,
  `Relay could not create a staging folder.`,
  `Relay could not verify the embedded runtime archive.`,
  `The prepared Relay runtime is incomplete.`,
  `The prepared Relay executable is not a valid Windows binary.`,
  `Relay could not finalize the new runtime.`,
  `Relay could not verify the extracted runtime contents.`,
  `Relay rejected changed retained-build runtime contents.`,
  `Relay could not inspect the prepared runtime.`,
  `Relay could not safely activate the prepared runtime.`,
  `Relay could not reserve a safe repair location.`,
  `Relay could not quarantine its damaged runtime.`,
  `Relay could not mark its damaged runtime quarantine.`,
  `Relay could not activate the prepared runtime folder.`,
  `Relay could not prepare its stable launcher.`,
  `Relay could not verify its stable launcher.`,
  `Relay could not install its stable launcher.`,
  `Use Relay's update or recovery screen to change a protected runtime.`,
  `Relay could not prepare its runtime state.`,
  `Relay could not activate the prepared build.`,
  `Relay could not write its prepared recovery receipt.`,
  `Relay could not activate its prepared recovery receipt.`,
  `Relay could not write its retained-build repair receipt.`,
  `Relay could not activate its retained-build repair receipt.`,
]);
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

export type ReleaseUpdateInstallerAttemptFailure = Readonly<{
  stage: 'protected-preparation' | 'legacy-direct-preparation';
  exitCode: number | null;
  nativeReason: string | null;
  spawnErrorCode: string | null;
}>;

export type ReleaseUpdateInstallDiagnostic = Readonly<{
  targetVersion: string;
  outcome: 'failed' | 'recovered';
  protectedAttempt: ReleaseUpdateInstallerAttemptFailure;
  legacyFallback:
    | 'ineligible'
    | 'succeeded'
    | 'failed'
    | 'blocked-by-request-cleanup'
    | 'blocked-by-verification';
  fallbackAttempt: ReleaseUpdateInstallerAttemptFailure | null;
}>;

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
  onInstallDiagnostic?: (diagnostic: ReleaseUpdateInstallDiagnostic) => void;
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
  executingBuildId: string;
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
      executingBuildId: parts[0]!,
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

async function supportsLegacyDirectActivation(managedRoot: ManagedRoot): Promise<boolean> {
  const statePath = join(managedRoot.realRoot, 'state.ini');
  try {
    const [stats, resolvedStatePath] = await Promise.all([lstat(statePath), realpath(statePath)]);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.size > MAX_LEGACY_STATE_BYTES ||
      !isDirectChild(managedRoot.realRoot, resolvedStatePath, 'state.ini')
    ) {
      return false;
    }
    const state = parseLegacyRecoveryState(await readFile(resolvedStatePath, 'utf8'));
    return state?.currentBuildId === managedRoot.executingBuildId;
  } catch {
    return false;
  }
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

function decodeBootstrapFailure(bytes: Buffer): string | null {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BOOTSTRAP_FAILURE_BYTES) return null;
  let encoding = 'utf-8';
  let offset = 0;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
    offset = 2;
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return null;
  } else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    offset = 3;
  }
  const payload = bytes.subarray(offset);
  if (payload.byteLength === 0 || (encoding === 'utf-16le' && payload.byteLength % 2 !== 0)) {
    return null;
  }
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(payload);
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/u);
  while (lines.at(-1) === '') lines.pop();
  if (lines.length !== 2 || lines[0] !== '[Relay]' || !lines[1]?.startsWith('message=')) {
    return null;
  }
  const reason = lines[1].slice('message='.length);
  return KNOWN_BOOTSTRAP_FAILURE_REASONS.has(reason) ? reason : null;
}

async function clearBootstrapFailure(managedRoot: ManagedRoot): Promise<boolean> {
  try {
    await rm(join(managedRoot.realRoot, BOOTSTRAP_FAILURE_FILE), { force: true });
    return true;
  } catch {
    return false;
  }
}

async function readBootstrapFailure(managedRoot: ManagedRoot): Promise<string | null> {
  const path = join(managedRoot.realRoot, BOOTSTRAP_FAILURE_FILE);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const [pathStats, resolvedPath] = await Promise.all([lstat(path), realpath(path)]);
    if (
      !pathStats.isFile() ||
      pathStats.isSymbolicLink() ||
      pathStats.size <= 0 ||
      pathStats.size > MAX_BOOTSTRAP_FAILURE_BYTES ||
      !isDirectChild(managedRoot.realRoot, resolvedPath, BOOTSTRAP_FAILURE_FILE)
    ) {
      return null;
    }
    handle = await open(resolvedPath, 'r');
    const openedStats = await handle.stat();
    if (
      !openedStats.isFile() ||
      openedStats.size <= 0 ||
      openedStats.size > MAX_BOOTSTRAP_FAILURE_BYTES ||
      openedStats.dev !== pathStats.dev ||
      openedStats.ino !== pathStats.ino ||
      openedStats.size !== pathStats.size
    ) {
      return null;
    }
    const bytes = Buffer.alloc(MAX_BOOTSTRAP_FAILURE_BYTES + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0);
    const finalStats = await handle.stat();
    if (
      bytesRead <= 0 ||
      bytesRead > MAX_BOOTSTRAP_FAILURE_BYTES ||
      bytesRead !== openedStats.size ||
      finalStats.dev !== openedStats.dev ||
      finalStats.ino !== openedStats.ino ||
      finalStats.size !== openedStats.size ||
      finalStats.mtimeMs !== openedStats.mtimeMs
    ) {
      return null;
    }
    return decodeBootstrapFailure(bytes.subarray(0, bytesRead));
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function diagnosticErrorCode(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String(error.code).toUpperCase();
    if (SAFE_DIAGNOSTIC_CODE_PATTERN.test(code)) return code;
  }
  return fallback;
}

async function runInstallerAttempt(
  managedRoot: ManagedRoot,
  spawnInstaller: (path: string, args: string[]) => Promise<number | null>,
  installerPath: string,
  args: string[],
  stage: ReleaseUpdateInstallerAttemptFailure['stage'],
): Promise<{ success: true } | { success: false; failure: ReleaseUpdateInstallerAttemptFailure }> {
  const clearedFailure = await clearBootstrapFailure(managedRoot);
  try {
    const exitCode = await spawnInstaller(installerPath, args);
    if (exitCode === 0) return { success: true };
    return {
      success: false,
      failure: {
        stage,
        exitCode,
        nativeReason: clearedFailure ? await readBootstrapFailure(managedRoot) : null,
        spawnErrorCode: null,
      },
    };
  } catch (error) {
    return {
      success: false,
      failure: {
        stage,
        exitCode: null,
        nativeReason: clearedFailure ? await readBootstrapFailure(managedRoot) : null,
        spawnErrorCode: diagnosticErrorCode(error, 'SPAWN_ERROR'),
      },
    };
  }
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
  if (message.includes('timed out')) return 'download-failed';
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

type ManagedRecoveryState = Readonly<{
  currentBuildId: string;
  catalog: RecoveryCatalog | null;
}>;

function recoveryBuildsMatch(first: RecoveryBuildRecord, second: RecoveryBuildRecord): boolean {
  return (
    first.buildId === second.buildId &&
    first.version === second.version &&
    first.releaseTag === second.releaseTag &&
    first.targetCommitish === second.targetCommitish &&
    first.runtimeSha512 === second.runtimeSha512 &&
    first.installerSha256 === second.installerSha256 &&
    first.recoveryProtocol === second.recoveryProtocol &&
    first.serverDataEpoch === second.serverDataEpoch &&
    first.clientDataEpoch === second.clientDataEpoch &&
    first.installedAt === second.installedAt &&
    first.health === second.health &&
    first.rollbackSnapshotId === second.rollbackSnapshotId
  );
}

function preparedUpdateMatches(
  request: RecoveryUpdateRequest,
  prepared: RecoveryPreparedUpdate,
  state: ManagedRecoveryState,
  currentBuild: RecoveryBuildRecord,
  managedRoot: ManagedRoot,
  currentVersion: string,
  installationMode: RecoveryInstallationMode,
): boolean {
  const catalogCurrent = state.catalog?.builds.find(
    ({ buildId }) => buildId === state.catalog?.currentBuildId,
  );
  const catalogMatches =
    !state.catalog ||
    (state.catalog.candidateBuildId === null &&
      state.catalog.transaction === null &&
      Boolean(catalogCurrent && recoveryBuildsMatch(catalogCurrent, request.source)));
  return (
    request.checkpoint === 'pending' &&
    request.snapshotId === null &&
    request.mode === installationMode &&
    request.source.buildId === managedRoot.executingBuildId &&
    request.source.version === currentVersion &&
    state.currentBuildId === managedRoot.executingBuildId &&
    recoveryBuildsMatch(currentBuild, request.source) &&
    catalogMatches &&
    prepared.transactionId === request.transactionId &&
    prepared.buildId !== managedRoot.executingBuildId &&
    prepared.version === request.targetVersion &&
    compareRelayVersions(prepared.version, currentVersion) === 1 &&
    prepared.targetCommitish === request.targetCommitish &&
    prepared.installerSha256 === request.targetInstallerSha256 &&
    prepared.recoveryProtocol === 2 &&
    prepared.serverDataEpoch === request.source.serverDataEpoch &&
    prepared.clientDataEpoch === request.source.clientDataEpoch
  );
}

function markerMatchesPreparedUpdate(
  marker: RecoveryRuntimeMarker,
  prepared: RecoveryPreparedUpdate,
): boolean {
  const relay = marker.relay;
  return (
    marker.contentVerified &&
    marker.runtimeSha512 === prepared.runtimeSha512 &&
    relay.get('protocol') === '2' &&
    relay.get('buildId') === prepared.buildId &&
    relay.get('executable') === INSTALLER_NAME &&
    relay.get('version') === prepared.version &&
    relay.get('releaseTag') === prepared.releaseTag &&
    relay.get('targetCommitish') === prepared.targetCommitish &&
    relay.get('installerSha256') === prepared.installerSha256 &&
    relay.get('serverDataEpoch') === String(prepared.serverDataEpoch) &&
    relay.get('clientDataEpoch') === String(prepared.clientDataEpoch) &&
    relay.get('installedAt') === prepared.preparedAt
  );
}

async function readManagedRecoveryState(
  managedRoot: ManagedRoot,
): Promise<ManagedRecoveryState | null> {
  const statePath = join(managedRoot.realRoot, 'state.ini');
  try {
    const [stats, resolvedStatePath] = await Promise.all([lstat(statePath), realpath(statePath)]);
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.size <= 0 ||
      stats.size > 128 * 1_024 ||
      !isDirectChild(managedRoot.realRoot, resolvedStatePath, 'state.ini')
    ) {
      return null;
    }
    const contents = await readFile(resolvedStatePath, 'utf8');
    const catalog = parseRecoveryCatalog(contents);
    if (catalog) return { currentBuildId: catalog.currentBuildId, catalog };
    const legacy: LegacyRecoveryState | null = parseLegacyRecoveryState(contents);
    return legacy ? { currentBuildId: legacy.currentBuildId, catalog: null } : null;
  } catch {
    return null;
  }
}

async function readPreparedRuntimeMarker(
  managedRoot: ManagedRoot,
  buildId: string,
): Promise<RecoveryRuntimeMarker | null> {
  const requestedDirectory = join(managedRoot.runtimeRoot, buildId);
  try {
    const [stats, resolvedDirectory] = await Promise.all([
      lstat(requestedDirectory),
      realpath(requestedDirectory),
    ]);
    if (
      !stats.isDirectory() ||
      stats.isSymbolicLink() ||
      !isDirectChild(managedRoot.runtimeRoot, resolvedDirectory, buildId)
    ) {
      return null;
    }
    return readRecoveryRuntimeMarker(resolvedDirectory);
  } catch {
    return null;
  }
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
  private legacyDirectActivationReady = false;

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
      onInstallDiagnostic: options.onInstallDiagnostic ?? (() => undefined),
    };
    this.state = initialSnapshot(this.options.getCurrentVersion());
  }

  snapshot(): RelayUpdateSnapshot {
    return { ...this.state };
  }

  async readySnapshot(): Promise<RelayUpdateSnapshot> {
    await this.initialize();
    return this.snapshot();
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
    this.recoveryTransactionId = null;
    this.legacyDirectActivationReady = false;
    this.publish({ ...this.state, phase: 'installing', failureCode: null });
    let requestPath: string | null = null;
    try {
      await this.validateStagedInstaller(staged);
    } catch {
      await this.clearStagedUpdate();
      return this.fail('verification-failed');
    }

    const managedRoot = await this.supportedManagedRoot();
    if (!managedRoot) return this.fail('unsupported');

    let protectedAttempt: ReleaseUpdateInstallerAttemptFailure;
    try {
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
      const attempt = await runInstallerAttempt(
        managedRoot,
        this.options.spawnInstaller,
        staged.installerPath,
        [PREPARE_ONLY_ARGUMENT, `${RECOVERY_TRANSACTION_ARGUMENT}${transactionId}`],
        'protected-preparation',
      );
      if (attempt.success) {
        this.recoveryTransactionId = transactionId;
        await this.clearStagedUpdate();
        this.publish({ ...this.state, phase: 'ready-to-restart', failureCode: null });
        return this.snapshot();
      }
      protectedAttempt = attempt.failure;
    } catch (error) {
      this.recoveryTransactionId = null;
      protectedAttempt = {
        stage: 'protected-preparation',
        exitCode: null,
        nativeReason: null,
        spawnErrorCode: diagnosticErrorCode(error, 'PREPARATION_SETUP_FAILED'),
      };
    }

    if (requestPath) {
      try {
        await rm(requestPath, { force: true });
        requestPath = null;
      } catch {
        this.reportInstallDiagnostic(
          staged.version,
          protectedAttempt,
          'blocked-by-request-cleanup',
        );
        return this.fail('install-failed');
      }
    }
    try {
      await this.validateStagedInstaller(staged);
    } catch {
      await this.clearStagedUpdate();
      this.reportInstallDiagnostic(staged.version, protectedAttempt, 'blocked-by-verification');
      return this.fail('verification-failed');
    }
    if (!(await supportsLegacyDirectActivation(managedRoot))) {
      this.reportInstallDiagnostic(staged.version, protectedAttempt, 'ineligible');
      return this.fail('install-failed');
    }
    const fallbackAttempt = await runInstallerAttempt(
      managedRoot,
      this.options.spawnInstaller,
      staged.installerPath,
      [PREPARE_ONLY_ARGUMENT],
      'legacy-direct-preparation',
    );
    if (fallbackAttempt.success) {
      this.legacyDirectActivationReady = true;
      await this.clearStagedUpdate();
      this.reportInstallDiagnostic(staged.version, protectedAttempt, 'succeeded');
      this.publish({ ...this.state, phase: 'ready-to-restart', failureCode: null });
      return this.snapshot();
    }
    this.legacyDirectActivationReady = false;
    this.reportInstallDiagnostic(
      staged.version,
      protectedAttempt,
      'failed',
      fallbackAttempt.failure,
    );
    return this.fail('install-failed');
  }

  private reportInstallDiagnostic(
    targetVersion: string,
    protectedAttempt: ReleaseUpdateInstallerAttemptFailure,
    legacyFallback: ReleaseUpdateInstallDiagnostic['legacyFallback'],
    fallbackAttempt: ReleaseUpdateInstallerAttemptFailure | null = null,
  ): void {
    try {
      this.options.onInstallDiagnostic({
        targetVersion,
        outcome: legacyFallback === 'succeeded' ? 'recovered' : 'failed',
        protectedAttempt,
        legacyFallback,
        fallbackAttempt,
      });
    } catch {
      // Diagnostics must never alter the update outcome.
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
    if (this.legacyDirectActivationReady) {
      this.options.restartApp(managedRoot.stableLauncher);
      return true;
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
      release = await this.resolveDownloadRelease(expectedVersion, controller.signal);
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
    this.initializationPromise ??= Promise.all([
      this.cleanupAbandonedStaging().catch(() => undefined),
      this.restorePreparedUpdate().catch(() => undefined),
    ]).then(() => undefined);
    return this.initializationPromise;
  }

  private async restorePreparedUpdate(): Promise<void> {
    const managedRoot = await this.supportedManagedRoot();
    if (!managedRoot) return;
    const [request, prepared, state] = await Promise.all([
      readRecoveryUpdateRequest(managedRoot.root),
      readRecoveryPreparedUpdate(managedRoot.root),
      readManagedRecoveryState(managedRoot),
    ]);
    if (!request || !prepared || !state) return;
    const currentBuild = await readCurrentRecoveryBuild(
      this.options.execPath,
      this.options.getCurrentVersion(),
      request.source.installedAt,
    );
    if (
      !preparedUpdateMatches(
        request,
        prepared,
        state,
        currentBuild,
        managedRoot,
        this.options.getCurrentVersion(),
        this.options.getInstallationMode(),
      )
    ) {
      return;
    }
    const marker = await readPreparedRuntimeMarker(managedRoot, prepared.buildId);
    if (!marker || !markerMatchesPreparedUpdate(marker, prepared)) return;

    this.recoveryTransactionId = request.transactionId;
    this.publish({
      phase: 'ready-to-restart',
      currentVersion: this.options.getCurrentVersion(),
      latestVersion: request.targetVersion,
      installable: true,
      downloadedBytes: 0,
      totalBytes: null,
      failureCode: null,
    });
  }

  private async resolveDownloadRelease(
    expectedVersion: string,
    signal: AbortSignal,
  ): Promise<RelayInstallableRelease> {
    const release = await this.options.service.resolveLatestInstallable(signal);
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
