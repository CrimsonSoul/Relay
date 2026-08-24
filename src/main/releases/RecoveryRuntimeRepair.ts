import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { createWindowsPrivateDirectory } from '../pocketbase/WindowsPrivateDirectory';
import {
  downloadReleaseAsset,
  type ReleaseAssetDownloadOptions,
  type ReleaseAssetDownloadResult,
} from './ReleaseAssetDownloader';
import { extractVerifiedRelayInstaller, parseRelayChecksum } from './RelayReleaseArchive';
import { isRecoveryBuildRecord, type RecoveryBuildRecord } from './RecoveryCatalog';
import {
  readRecoveryRepairReceipt,
  recoveryRepairArtifactPaths,
  writeRecoveryRepairRequest,
} from './RecoveryRepairRequest';
import {
  ReleaseUpdateService,
  type RelayInstallableAsset,
  type RelayInstallableRelease,
} from './ReleaseUpdateService';

const INSTALLER_NAME = 'Relay.exe';
const REPAIR_ONLY_ARGUMENT = '/relay-repair-only';
const RECOVERY_TRANSACTION_ARGUMENT = '/relay-transaction=';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export type RecoveryRuntimeRepairInput = {
  relayRoot: string;
  sourceBuild: RecoveryBuildRecord;
  targetBuild: RecoveryBuildRecord;
};

type DownloadAsset = (
  asset: RelayInstallableAsset,
  destination: string,
  options: ReleaseAssetDownloadOptions,
) => Promise<ReleaseAssetDownloadResult>;

type RecoveryRuntimeRepairOptions = {
  resolveInstallableByTag: (
    version: string,
    expectedTargetCommitish: string,
  ) => Promise<RelayInstallableRelease>;
  downloadAsset: DownloadAsset;
  extractInstaller: (
    archivePath: string,
    destinationPath: string,
  ) => Promise<{ bytes: number; sha256: string }>;
  spawnInstaller: (path: string, args: string[]) => Promise<number | null>;
  createPrivateDirectory: (path: string) => unknown;
  now: () => Date;
  randomUuid: () => string;
};

function isDirectChild(parent: string, child: string, expectedName: string): boolean {
  const childRelative = relative(parent, child);
  return !isAbsolute(childRelative) && childRelative === expectedName;
}

function spawnInstallerAndWait(path: string, args: string[]): Promise<number | null> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(path, args, { windowsHide: true, stdio: 'ignore' });
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
    throw new Error('Recovery installer metadata changed');
  }
  const handle = await open(path, 'r');
  try {
    const magic = Buffer.alloc(2);
    const result = await handle.read(magic, 0, magic.byteLength, 0);
    if (result.bytesRead !== 2 || magic[0] !== 0x4d || magic[1] !== 0x5a) {
      throw new Error('Recovery installer was not a Windows executable');
    }
  } finally {
    await handle.close();
  }
  const hash = createHash('sha256');
  for await (const value of createReadStream(path)) hash.update(value);
  return hash.digest('hex');
}

async function resolveRelayRoot(relayRoot: string): Promise<string> {
  if (!isAbsolute(relayRoot)) throw new Error('Relay recovery root was invalid');
  const [stats, realRelayRoot] = await Promise.all([lstat(relayRoot), realpath(relayRoot)]);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('Relay recovery root was redirected');
  }
  return realRelayRoot;
}

async function createStagingDirectory(
  realRelayRoot: string,
  version: string,
  transactionId: string,
  createPrivateDirectory: RecoveryRuntimeRepairOptions['createPrivateDirectory'],
): Promise<string> {
  const updatesRoot = join(realRelayRoot, 'Updates');
  await mkdir(updatesRoot, { recursive: true, mode: 0o700 });
  const [updatesStats, realUpdatesRoot] = await Promise.all([
    lstat(updatesRoot),
    realpath(updatesRoot),
  ]);
  if (
    !updatesStats.isDirectory() ||
    updatesStats.isSymbolicLink() ||
    !isDirectChild(realRelayRoot, realUpdatesRoot, 'Updates')
  ) {
    throw new Error('Relay recovery staging root was redirected');
  }

  const name = `v${version}-${transactionId}`;
  const directory = join(realUpdatesRoot, name);
  await createPrivateDirectory(directory);
  const [stats, realDirectory] = await Promise.all([lstat(directory), realpath(directory)]);
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !isDirectChild(realUpdatesRoot, realDirectory, name)
  ) {
    throw new Error('Relay recovery staging directory was redirected');
  }
  return realDirectory;
}

function assertRepairIdentity(
  input: RecoveryRuntimeRepairInput,
  release: RelayInstallableRelease,
): void {
  if (
    !isRecoveryBuildRecord(input.sourceBuild) ||
    !isRecoveryBuildRecord(input.targetBuild) ||
    input.sourceBuild.health !== 'healthy' ||
    input.targetBuild.health !== 'healthy' ||
    input.sourceBuild.buildId === input.targetBuild.buildId ||
    input.targetBuild.recoveryProtocol !== 2 ||
    release.version !== input.targetBuild.version ||
    release.targetCommitish !== input.targetBuild.targetCommitish
  ) {
    throw new Error('Recovery release identity did not match the retained build');
  }
}

export async function repairRecoveryRuntime(
  input: RecoveryRuntimeRepairInput,
  options: RecoveryRuntimeRepairOptions,
): Promise<boolean> {
  const realRelayRoot = await resolveRelayRoot(input.relayRoot);
  const release = await options.resolveInstallableByTag(
    input.targetBuild.version,
    input.targetBuild.targetCommitish,
  );
  assertRepairIdentity(input, release);

  const transactionId = options.randomUuid();
  const stagingDirectory = await createStagingDirectory(
    realRelayRoot,
    release.version,
    transactionId,
    options.createPrivateDirectory,
  );
  const checksumPath = join(stagingDirectory, release.checksum.name);
  const archivePath = join(stagingDirectory, release.archive.name);
  const installerPath = join(stagingDirectory, INSTALLER_NAME);
  const { requestPath, receiptPath } = recoveryRepairArtifactPaths(realRelayRoot);

  try {
    const controller = new AbortController();
    await options.downloadAsset(release.checksum, checksumPath, { signal: controller.signal });
    const declaredArchiveSha256 = parseRelayChecksum(
      await readFile(checksumPath, 'utf8'),
      release.archive.name,
    );
    if (declaredArchiveSha256 !== release.archive.sha256) {
      throw new Error('Recovery checksum disagreed with the immutable release metadata');
    }
    const archive = await options.downloadAsset(release.archive, archivePath, {
      signal: controller.signal,
    });
    if (archive.bytes !== release.archive.size || archive.sha256 !== release.archive.sha256) {
      throw new Error('Recovery archive verification disagreed with the immutable release');
    }

    const installer = await options.extractInstaller(archivePath, installerPath);
    if (
      installer.bytes < 2 ||
      !SHA256_PATTERN.test(installer.sha256) ||
      (input.targetBuild.installerSha256 !== null &&
        input.targetBuild.installerSha256 !== installer.sha256)
    ) {
      throw new Error('Recovery installer did not match the retained build');
    }
    const [realDirectory, realInstaller] = await Promise.all([
      realpath(stagingDirectory),
      realpath(installerPath),
    ]);
    if (!isDirectChild(realDirectory, realInstaller, INSTALLER_NAME)) {
      throw new Error('Recovery installer path was redirected');
    }
    if ((await executableSha256(realInstaller, installer.bytes)) !== installer.sha256) {
      throw new Error('Recovery installer digest changed');
    }

    await rm(receiptPath, { force: true });
    await writeRecoveryRepairRequest(
      realRelayRoot,
      {
        protocol: 2,
        transactionId,
        sourceBuildId: input.sourceBuild.buildId,
        targetBuildId: input.targetBuild.buildId,
        targetVersion: input.targetBuild.version,
        targetCommitish: input.targetBuild.targetCommitish,
        targetInstallerSha256: installer.sha256,
        checkpoint: 'pending',
        requestedAt: options.now().toISOString(),
      },
      options.createPrivateDirectory,
    );
    if ((await executableSha256(realInstaller, installer.bytes)) !== installer.sha256) {
      throw new Error('Recovery installer digest changed before execution');
    }
    const exitCode = await options.spawnInstaller(realInstaller, [
      REPAIR_ONLY_ARGUMENT,
      `${RECOVERY_TRANSACTION_ARGUMENT}${transactionId}`,
    ]);
    if (exitCode !== 0) throw new Error('Recovery installer failed');

    const receipt = await readRecoveryRepairReceipt(realRelayRoot);
    if (
      receipt?.transactionId !== transactionId ||
      receipt.buildId !== input.targetBuild.buildId ||
      receipt.version !== input.targetBuild.version ||
      receipt.targetCommitish !== input.targetBuild.targetCommitish ||
      receipt.runtimeSha512 !== input.targetBuild.runtimeSha512 ||
      receipt.installerSha256 !== installer.sha256
    ) {
      throw new Error('Recovery repair receipt did not match the retained build');
    }
    return true;
  } finally {
    await Promise.all([
      rm(requestPath, { force: true }).catch(() => undefined),
      rm(receiptPath, { force: true }).catch(() => undefined),
      rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined),
    ]);
  }
}

export async function repairProductionRecoveryRuntime(
  input: RecoveryRuntimeRepairInput,
): Promise<boolean> {
  const service = new ReleaseUpdateService({ getCurrentVersion: () => input.sourceBuild.version });
  return repairRecoveryRuntime(input, {
    resolveInstallableByTag: (version, targetCommitish) =>
      service.resolveInstallableByTag(version, targetCommitish),
    downloadAsset: downloadReleaseAsset,
    extractInstaller: extractVerifiedRelayInstaller,
    spawnInstaller: spawnInstallerAndWait,
    createPrivateDirectory: createWindowsPrivateDirectory,
    now: () => new Date(),
    randomUuid: () => randomUUID(),
  });
}
