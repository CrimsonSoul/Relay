import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openRegularFile } from '../utils/regularFile';
import type {
  ReleaseAssetDownloadOptions,
  ReleaseAssetDownloadResult,
} from './ReleaseAssetDownloader';
import { parseRelayChecksum } from './RelayReleaseArchive';
import type { RelayInstallableAsset, RelayInstallableRelease } from './ReleaseUpdateService';
import { hasWindowsExecutableHeader } from './recoveryFormat';

/** Staging, download, and launch of the Relay installer shared by updates and runtime repair. */

export const INSTALLER_NAME = 'Relay.exe';
export const RECOVERY_TRANSACTION_ARGUMENT = '/relay-transaction=';
// Windows can briefly deny deleting an installer that just exited or that antivirus is scanning.
export const STAGING_REMOVAL_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 10,
  retryDelay: 100,
} as const;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export type DownloadAsset = (
  asset: RelayInstallableAsset,
  destination: string,
  options: ReleaseAssetDownloadOptions,
) => Promise<ReleaseAssetDownloadResult>;
export type ExtractInstaller = (
  archivePath: string,
  destinationPath: string,
) => Promise<{ bytes: number; sha256: string }>;

export function spawnInstallerAndWait(path: string, args: string[]): Promise<number | null> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(path, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => resolvePromise(code));
  });
}

/**
 * Hashes a staged installer after checking it is still the extracted Windows executable.
 * `subject` names the installer in the errors.
 */
export async function executableSha256(
  path: string,
  expectedBytes: number,
  subject: string,
): Promise<string> {
  // Check, sniff, and hash one opened file so the path cannot be swapped between the steps.
  const opened = await openRegularFile(path);
  if (opened?.stats.size !== BigInt(expectedBytes) || expectedBytes < 2) {
    await opened?.handle.close();
    throw new Error(`${subject} metadata changed`);
  }
  const { handle } = opened;
  try {
    if (!(await hasWindowsExecutableHeader(handle))) {
      throw new Error(`${subject} was not a Windows executable`);
    }
    const hash = createHash('sha256');
    for await (const value of handle.createReadStream({ start: 0, autoClose: false }))
      hash.update(value);
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

/**
 * Downloads the release checksum and archive into `directory`, checks both against the
 * immutable release metadata, and extracts the installer beside them. Each error names the
 * check that failed, which the updater classifies as a verification failure.
 */
export async function downloadReleaseInstaller(input: {
  release: RelayInstallableRelease;
  directory: string;
  downloadAsset: DownloadAsset;
  extractInstaller: ExtractInstaller;
  signal?: AbortSignal;
  onArchiveProgress?: (downloadedBytes: number, totalBytes: number) => void;
}): Promise<{ installerPath: string; bytes: number; sha256: string }> {
  const { release, directory, signal } = input;
  const checksumPath = join(directory, release.checksum.name);
  const archivePath = join(directory, release.archive.name);
  const installerPath = join(directory, INSTALLER_NAME);

  await input.downloadAsset(release.checksum, checksumPath, { signal });
  signal?.throwIfAborted();
  const declaredArchiveSha256 = parseRelayChecksum(
    await readFile(checksumPath, 'utf8'),
    release.archive.name,
  );
  signal?.throwIfAborted();
  if (declaredArchiveSha256 !== release.archive.sha256) {
    throw new Error('Relay checksum asset disagreed with GitHub release metadata');
  }

  const archive = await input.downloadAsset(release.archive, archivePath, {
    signal,
    ...(input.onArchiveProgress ? { onProgress: input.onArchiveProgress } : {}),
  });
  signal?.throwIfAborted();
  if (archive.bytes !== release.archive.size || archive.sha256 !== release.archive.sha256) {
    throw new Error('Relay archive verification result disagreed with release metadata');
  }

  const installer = await input.extractInstaller(archivePath, installerPath);
  signal?.throwIfAborted();
  if (!SHA256_PATTERN.test(installer.sha256) || installer.bytes < 2) {
    throw new Error('Relay installer extraction result was invalid');
  }
  return { installerPath, bytes: installer.bytes, sha256: installer.sha256 };
}
