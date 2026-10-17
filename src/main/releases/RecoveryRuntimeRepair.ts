import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createWindowsPrivateDirectory } from '../pocketbase/WindowsPrivateDirectory';
import { downloadReleaseAsset } from './ReleaseAssetDownloader';
import { extractVerifiedRelayInstaller } from './RelayReleaseArchive';
import { isRecoveryBuildRecord, type RecoveryBuildRecord } from './RecoveryCatalog';
import {
  readRecoveryRepairReceipt,
  recoveryRepairArtifactPaths,
  writeRecoveryRepairRequest,
} from './RecoveryRepairRequest';
import { ReleaseUpdateService, type RelayInstallableRelease } from './ReleaseUpdateService';
import { isDirectChild } from './recoveryFormat';
import {
  downloadReleaseInstaller,
  executableSha256,
  INSTALLER_NAME,
  RECOVERY_TRANSACTION_ARGUMENT,
  spawnInstallerAndWait,
  STAGING_REMOVAL_OPTIONS,
  type DownloadAsset,
  type ExtractInstaller,
} from './releaseInstaller';

const REPAIR_ONLY_ARGUMENT = '/relay-repair-only';

type RecoveryRuntimeRepairInput = {
  relayRoot: string;
  sourceBuild: RecoveryBuildRecord;
  targetBuild: RecoveryBuildRecord;
};

type RecoveryRuntimeRepairOptions = {
  resolveInstallableByTag: (
    version: string,
    expectedTargetCommitish: string,
  ) => Promise<RelayInstallableRelease>;
  downloadAsset: DownloadAsset;
  extractInstaller: ExtractInstaller;
  spawnInstaller: (path: string, args: string[]) => Promise<number | null>;
  createPrivateDirectory: (path: string) => unknown;
  now: () => Date;
  randomUuid: () => string;
};

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

  const name = `repair-v${version}-${transactionId}`;
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
  const { requestPath, receiptPath } = recoveryRepairArtifactPaths(realRelayRoot);

  try {
    const installer = await downloadReleaseInstaller({
      release,
      directory: stagingDirectory,
      downloadAsset: options.downloadAsset,
      extractInstaller: options.extractInstaller,
    });
    if (
      input.targetBuild.installerSha256 !== null &&
      input.targetBuild.installerSha256 !== installer.sha256
    ) {
      throw new Error('Recovery installer did not match the retained build');
    }
    const [realDirectory, realInstaller] = await Promise.all([
      realpath(stagingDirectory),
      realpath(installer.installerPath),
    ]);
    if (!isDirectChild(realDirectory, realInstaller, INSTALLER_NAME)) {
      throw new Error('Recovery installer path was redirected');
    }
    if (
      (await executableSha256(realInstaller, installer.bytes, 'Recovery installer')) !==
      installer.sha256
    ) {
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
    if (
      (await executableSha256(realInstaller, installer.bytes, 'Recovery installer')) !==
      installer.sha256
    ) {
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
    // Updater cleanup removes repair staging only once it is abandoned or superseded.
    await Promise.all([
      rm(requestPath, { force: true }).catch(() => undefined),
      rm(receiptPath, { force: true }).catch(() => undefined),
      rm(stagingDirectory, STAGING_REMOVAL_OPTIONS).catch(() => undefined),
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
