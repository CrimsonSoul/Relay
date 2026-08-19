import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { RelayUpdateCheck } from '@shared/releases';
import type { RelayInstallableAsset, RelayInstallableRelease } from './ReleaseUpdateService';
import { ReleaseUpdateManager, type ReleaseUpdateManagerOptions } from './ReleaseUpdateManager';

const CURRENT_VERSION = '1.0.0';
const INSTALLER = Buffer.from('MZverified staged installer');
const INSTALLER_SHA256 = createHash('sha256').update(INSTALLER).digest('hex');
const ARCHIVE_SHA256 = 'a'.repeat(64);
const CHECKSUM_SHA256 = 'b'.repeat(64);

type ResolveLatestInstallable = () => Promise<RelayInstallableRelease>;
type DownloadAsset = NonNullable<ReleaseUpdateManagerOptions['downloadAsset']>;
type ExtractInstaller = NonNullable<ReleaseUpdateManagerOptions['extractInstaller']>;
type SpawnInstaller = NonNullable<ReleaseUpdateManagerOptions['spawnInstaller']>;
type Relaunch = NonNullable<ReleaseUpdateManagerOptions['relaunch']>;
type Quit = NonNullable<ReleaseUpdateManagerOptions['quit']>;
type ManagerOverrides = Partial<Omit<ReleaseUpdateManagerOptions, 'service' | 'getCurrentVersion'>>;

function asset(id: number, name: string, size: number, sha256: string): RelayInstallableAsset {
  return {
    id,
    name,
    apiUrl: `https://api.github.com/repos/CrimsonSoul/Relay/releases/assets/${id}`,
    size,
    sha256,
  };
}

function release(version = '1.1.0'): RelayInstallableRelease {
  const archiveName = `Relay-v${version}-windows-x64.zip`;
  return {
    version,
    targetCommitish: '0123456789abcdef0123456789abcdef01234567',
    archive: asset(10, archiveName, 140_000_000, ARCHIVE_SHA256),
    checksum: asset(11, `${archiveName}.sha256`, 95, CHECKSUM_SHA256),
  };
}

function updateCheck(overrides: Partial<RelayUpdateCheck> = {}): RelayUpdateCheck {
  return {
    currentVersion: CURRENT_VERSION,
    latestVersion: '1.1.0',
    updateAvailable: true,
    installable: true,
    assetSizeBytes: 140_000_000,
    ...overrides,
  };
}

describe('ReleaseUpdateManager', () => {
  let tempRoot: string;
  let localAppData: string;
  let relayRoot: string;
  let runtimeDirectory: string;
  let execPath: string;
  let stableLauncher: string;
  let resolveLatestInstallable: Mock<ResolveLatestInstallable>;
  let downloadAsset: Mock<DownloadAsset>;
  let extractInstaller: Mock<ExtractInstaller>;
  let spawnInstaller: Mock<SpawnInstaller>;
  let relaunch: Mock<Relaunch>;
  let quit: Mock<Quit>;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'relay-update-manager-'));
    localAppData = join(tempRoot, 'LocalAppData');
    relayRoot = join(localAppData, 'Relay');
    runtimeDirectory = join(relayRoot, 'Runtime', 'r1-currentbuild');
    execPath = join(runtimeDirectory, 'Relay.exe');
    stableLauncher = join(relayRoot, 'Relay.exe');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(execPath, 'MZcurrent runtime');
    await writeFile(stableLauncher, 'MZstable launcher');

    resolveLatestInstallable = vi.fn<ResolveLatestInstallable>(async () => release());
    downloadAsset = vi.fn<DownloadAsset>(
      async (releaseAsset: RelayInstallableAsset, destination: string, options) => {
        if (releaseAsset.name.endsWith('.sha256')) {
          await writeFile(destination, `${ARCHIVE_SHA256}  Relay-v1.1.0-windows-x64.zip\n`);
        } else {
          await writeFile(destination, 'archive bytes');
          options.onProgress?.(releaseAsset.size, releaseAsset.size);
        }
        return { bytes: releaseAsset.size, sha256: releaseAsset.sha256 };
      },
    );
    extractInstaller = vi.fn<ExtractInstaller>(async (_archive: string, destination: string) => {
      await writeFile(destination, INSTALLER);
      return { bytes: INSTALLER.byteLength, sha256: INSTALLER_SHA256 };
    });
    spawnInstaller = vi.fn<SpawnInstaller>(async () => 0);
    relaunch = vi.fn<Relaunch>();
    quit = vi.fn<Quit>();
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  function manager(overrides: ManagerOverrides = {}) {
    return new ReleaseUpdateManager({
      service: { resolveLatestInstallable },
      getCurrentVersion: () => CURRENT_VERSION,
      platform: 'win32',
      arch: 'x64',
      isPackaged: true,
      localAppData,
      execPath,
      downloadAsset,
      extractInstaller,
      spawnInstaller,
      relaunch,
      quit,
      createPrivateDirectory: (path: string) => mkdir(path, { recursive: false, mode: 0o700 }),
      ...overrides,
    });
  }

  it('keeps discovery advisory until the operator explicitly downloads', async () => {
    const updates = manager();

    await expect(updates.noteCheck(updateCheck())).resolves.toMatchObject({
      phase: 'available',
      latestVersion: '1.1.0',
      installable: true,
    });
    expect(resolveLatestInstallable).not.toHaveBeenCalled();
    expect(downloadAsset).not.toHaveBeenCalled();
    expect(spawnInstaller).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('requires separate download, install, and restart actions', async () => {
    const updates = manager();
    const snapshots: string[] = [];
    updates.subscribe((snapshot) => snapshots.push(snapshot.phase));
    await updates.noteCheck(updateCheck());

    await expect(updates.download()).resolves.toMatchObject({
      phase: 'downloaded',
      downloadedBytes: 140_000_000,
      totalBytes: 140_000_000,
    });
    expect(resolveLatestInstallable).toHaveBeenCalledOnce();
    expect(downloadAsset).toHaveBeenCalledTimes(2);
    expect(extractInstaller).toHaveBeenCalledOnce();
    expect(spawnInstaller).not.toHaveBeenCalled();

    await expect(updates.install()).resolves.toMatchObject({ phase: 'ready-to-restart' });
    expect(spawnInstaller).toHaveBeenCalledWith(expect.stringMatching(/Relay\.exe$/u), [
      '/relay-prepare-only',
    ]);
    expect(relaunch).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();

    await expect(updates.restart()).resolves.toBe(true);
    expect(relaunch).toHaveBeenCalledWith({ execPath: stableLauncher });
    expect(quit).toHaveBeenCalledOnce();
    expect(snapshots).toEqual(
      expect.arrayContaining([
        'available',
        'downloading',
        'downloaded',
        'installing',
        'ready-to-restart',
      ]),
    );
  });

  it('does not offer download for a mutable notification-only release', async () => {
    const updates = manager();
    await updates.noteCheck(updateCheck({ installable: false, assetSizeBytes: null }));

    await expect(updates.download()).resolves.toMatchObject({
      phase: 'error',
      failureCode: 'release-not-immutable',
    });
    expect(resolveLatestInstallable).not.toHaveBeenCalled();
    expect(downloadAsset).not.toHaveBeenCalled();
  });

  it('cancels a download, removes staging, and returns to the available state', async () => {
    downloadAsset.mockImplementation(
      async (_releaseAsset: RelayInstallableAsset, destination: string, options) => {
        await writeFile(destination, 'partial');
        return new Promise((_resolve, reject) => {
          options.signal!.addEventListener(
            'abort',
            () => reject(options.signal!.reason ?? new Error('cancelled')),
            { once: true },
          );
        });
      },
    );
    const updates = manager();
    await updates.noteCheck(updateCheck());

    const pending = updates.download();
    await vi.waitFor(() => expect(downloadAsset).toHaveBeenCalledOnce());
    void updates.cancelDownload();

    await expect(pending).resolves.toMatchObject({
      phase: 'available',
      latestVersion: '1.1.0',
      failureCode: null,
    });
    const stagingDirectory = join(relayRoot, 'Updates');
    await expect(stat(stagingDirectory)).resolves.toBeDefined();
    await expect(readFile(downloadAsset.mock.calls[0]![1])).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('fails closed when the checksum and downloaded archive disagree', async () => {
    downloadAsset.mockImplementation(
      async (releaseAsset: RelayInstallableAsset, destination: string) => {
        if (releaseAsset.name.endsWith('.sha256')) {
          await writeFile(destination, `${'c'.repeat(64)}  Relay-v1.1.0-windows-x64.zip\n`);
        } else {
          await writeFile(destination, 'archive bytes');
        }
        return { bytes: releaseAsset.size, sha256: releaseAsset.sha256 };
      },
    );
    const updates = manager();
    await updates.noteCheck(updateCheck());

    await expect(updates.download()).resolves.toMatchObject({
      phase: 'error',
      failureCode: 'verification-failed',
    });
    expect(extractInstaller).not.toHaveBeenCalled();
    expect(spawnInstaller).not.toHaveBeenCalled();
  });

  it('classifies malformed archive extraction as a verification failure', async () => {
    extractInstaller.mockRejectedValueOnce(new Error('Relay release ZIP failed CRC validation'));
    const updates = manager();
    await updates.noteCheck(updateCheck());

    await expect(updates.download()).resolves.toMatchObject({
      phase: 'error',
      failureCode: 'verification-failed',
    });
    expect(spawnInstaller).not.toHaveBeenCalled();
  });

  it('re-hashes the staged installer immediately before execution', async () => {
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await updates.download();
    const installerPath = extractInstaller.mock.calls[0]![1];
    await writeFile(installerPath, 'MZtampered after verification');

    await expect(updates.install()).resolves.toMatchObject({
      phase: 'error',
      failureCode: 'verification-failed',
    });
    expect(spawnInstaller).not.toHaveBeenCalled();
  });

  it('keeps the staged update retryable when the bootstrap exits unsuccessfully', async () => {
    spawnInstaller.mockResolvedValue(1);
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await updates.download();

    await expect(updates.install()).resolves.toMatchObject({
      phase: 'error',
      failureCode: 'install-failed',
    });
    await expect(updates.install()).resolves.toMatchObject({
      phase: 'error',
      failureCode: 'install-failed',
    });
    expect(spawnInstaller).toHaveBeenCalledTimes(2);
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('defers a newer release check while an older release is being prepared', async () => {
    const deferredSpawn: { resolve?: (exitCode: number | null) => void } = {};
    spawnInstaller.mockReturnValueOnce(
      new Promise<number | null>((resolvePromise) => {
        deferredSpawn.resolve = resolvePromise;
      }),
    );
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await updates.download();

    const pendingInstall = updates.install();
    await vi.waitFor(() => expect(spawnInstaller).toHaveBeenCalledOnce());
    await expect(
      updates.noteCheck(updateCheck({ latestVersion: '1.2.0', assetSizeBytes: 150_000_000 })),
    ).resolves.toMatchObject({
      phase: 'installing',
      latestVersion: '1.1.0',
    });

    deferredSpawn.resolve?.(0);
    await expect(pendingInstall).resolves.toMatchObject({
      phase: 'ready-to-restart',
      latestVersion: '1.1.0',
    });
    expect(updates.snapshot()).toMatchObject({
      phase: 'ready-to-restart',
      latestVersion: '1.1.0',
    });
  });

  it('single-flights install and rejects a competing download without changing state', async () => {
    const deferredSpawn: { resolve?: (exitCode: number | null) => void } = {};
    spawnInstaller.mockReturnValueOnce(
      new Promise<number | null>((resolvePromise) => {
        deferredSpawn.resolve = resolvePromise;
      }),
    );
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await updates.download();
    const downloadCallsBeforeInstall = downloadAsset.mock.calls.length;

    const firstInstall = updates.install();
    const duplicateInstall = updates.install();
    expect(duplicateInstall).toBe(firstInstall);
    await vi.waitFor(() => expect(spawnInstaller).toHaveBeenCalledOnce());
    await expect(updates.download()).resolves.toMatchObject({
      phase: 'installing',
      latestVersion: '1.1.0',
    });
    expect(downloadAsset).toHaveBeenCalledTimes(downloadCallsBeforeInstall);

    deferredSpawn.resolve?.(0);
    await expect(firstInstall).resolves.toMatchObject({ phase: 'ready-to-restart' });
    expect(spawnInstaller).toHaveBeenCalledOnce();
  });

  it('single-flights duplicate restart requests', async () => {
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await updates.download();
    await updates.install();

    const firstRestart = updates.restart();
    const duplicateRestart = updates.restart();
    expect(duplicateRestart).toBe(firstRestart);
    await expect(firstRestart).resolves.toBe(true);
    expect(relaunch).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
  });

  it('discards a staged older release when discovery advances', async () => {
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await updates.download();
    const installerPath = extractInstaller.mock.calls[0]![1];

    await expect(
      updates.noteCheck(updateCheck({ latestVersion: '1.2.0', assetSizeBytes: 150_000_000 })),
    ).resolves.toMatchObject({
      phase: 'available',
      latestVersion: '1.2.0',
      downloadedBytes: 0,
    });
    await expect(stat(installerPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('aborts and drains an older in-flight download before publishing a newer release', async () => {
    let archiveAbortObserved = false;
    let partialArchivePath = '';
    downloadAsset.mockImplementation(
      async (releaseAsset: RelayInstallableAsset, destination: string, options) => {
        if (releaseAsset.name.endsWith('.sha256')) {
          await writeFile(destination, `${ARCHIVE_SHA256}  Relay-v1.1.0-windows-x64.zip\n`);
          return { bytes: releaseAsset.size, sha256: releaseAsset.sha256 };
        }

        partialArchivePath = destination;
        await writeFile(destination, 'partial archive');
        return new Promise((_resolve, reject) => {
          options.signal!.addEventListener(
            'abort',
            () => {
              archiveAbortObserved = true;
              reject(options.signal!.reason ?? new Error('cancelled'));
            },
            { once: true },
          );
        });
      },
    );
    const updates = manager();
    await updates.noteCheck(updateCheck());
    const pendingDownload = updates.download();
    await vi.waitFor(() => expect(downloadAsset).toHaveBeenCalledTimes(2));

    const superseding = await updates.noteCheck(
      updateCheck({ latestVersion: '1.2.0', assetSizeBytes: 150_000_000 }),
    );
    const wasAbortedBeforeFallbackCleanup = archiveAbortObserved;
    await pendingDownload;

    expect(wasAbortedBeforeFallbackCleanup).toBe(true);
    expect(superseding).toMatchObject({
      phase: 'available',
      latestVersion: '1.2.0',
      downloadedBytes: 0,
    });
    expect(updates.snapshot()).toMatchObject({
      phase: 'available',
      latestVersion: '1.2.0',
      downloadedBytes: 0,
    });
    await expect(stat(partialArchivePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(extractInstaller).not.toHaveBeenCalled();
  });

  it('drains a superseded download while release verification is still pending', async () => {
    const deferredRelease: { resolve?: (value: RelayInstallableRelease) => void } = {};
    resolveLatestInstallable.mockReturnValueOnce(
      new Promise<RelayInstallableRelease>((resolvePromise) => {
        deferredRelease.resolve = resolvePromise;
      }),
    );
    const updates = manager();
    await updates.noteCheck(updateCheck());

    const pendingDownload = updates.download();
    await vi.waitFor(() => expect(resolveLatestInstallable).toHaveBeenCalledOnce());

    let supersedingSettled = false;
    const supersedingPromise = updates
      .noteCheck(updateCheck({ latestVersion: '1.2.0', assetSizeBytes: 150_000_000 }))
      .then((snapshot) => {
        supersedingSettled = true;
        return snapshot;
      });
    await Promise.resolve();
    expect(supersedingSettled).toBe(false);

    deferredRelease.resolve?.(release());
    const [superseding] = await Promise.all([supersedingPromise, pendingDownload]);

    expect(superseding).toMatchObject({
      phase: 'available',
      latestVersion: '1.2.0',
      downloadedBytes: 0,
    });
    expect(updates.snapshot()).toMatchObject({
      phase: 'available',
      latestVersion: '1.2.0',
      downloadedBytes: 0,
    });
    expect(downloadAsset).not.toHaveBeenCalled();
    expect(extractInstaller).not.toHaveBeenCalled();
  });

  it('preserves manual progress when discovery confirms the same release again', async () => {
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await updates.download();

    await expect(updates.noteCheck(updateCheck())).resolves.toMatchObject({
      phase: 'downloaded',
      latestVersion: '1.1.0',
      downloadedBytes: 140_000_000,
    });

    await updates.install();
    await expect(updates.noteCheck(updateCheck())).resolves.toMatchObject({
      phase: 'ready-to-restart',
      latestVersion: '1.1.0',
    });
  });

  it('refuses updater actions outside packaged Windows x64 Relay', async () => {
    const updates = manager({ platform: 'darwin' });
    await expect(updates.noteCheck(updateCheck())).resolves.toMatchObject({
      phase: 'available',
      installable: false,
      failureCode: 'unsupported',
    });

    await expect(updates.download()).resolves.toMatchObject({
      phase: 'error',
      failureCode: 'unsupported',
    });
    expect(resolveLatestInstallable).not.toHaveBeenCalled();
  });

  it('refuses restart when the stable launcher becomes a symbolic link', async () => {
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await updates.download();
    await updates.install();
    await rm(stableLauncher);
    await symlink(execPath, stableLauncher);

    await expect(updates.restart()).resolves.toBe(false);
    expect(relaunch).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
    expect(updates.snapshot()).toMatchObject({
      phase: 'error',
      failureCode: 'restart-unavailable',
    });

    await rm(stableLauncher);
    await writeFile(stableLauncher, 'MZstable launcher restored');
    await expect(updates.restart()).resolves.toBe(true);
    expect(relaunch).toHaveBeenCalledWith({ execPath: stableLauncher });
    expect(quit).toHaveBeenCalledOnce();
  });

  it('removes only updater staging directories that have been abandoned for over 24 hours', async () => {
    const updatesRoot = join(relayRoot, 'Updates');
    const staleDirectory = join(updatesRoot, 'v1.0.1-12345678-1234-4123-8123-123456789abc');
    const recentDirectory = join(updatesRoot, 'v1.0.3-12345678-1234-4123-8123-123456789abc');
    const unrelatedDirectory = join(updatesRoot, 'operator-files');
    const linkedDirectory = join(updatesRoot, 'v1.0.2-12345678-1234-4123-8123-123456789abc');
    await mkdir(staleDirectory, { recursive: true });
    await writeFile(join(staleDirectory, 'partial.zip'), 'partial');
    await mkdir(recentDirectory);
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    await utimes(staleDirectory, staleTime, staleTime);
    await mkdir(unrelatedDirectory);
    await symlink(unrelatedDirectory, linkedDirectory);

    const updates = manager();
    await updates.noteCheck(updateCheck());

    await expect(stat(staleDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(recentDirectory)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(stat(unrelatedDirectory)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(lstat(linkedDirectory)).resolves.toMatchObject({
      isSymbolicLink: expect.any(Function),
    });
  });

  it('uses an app-private version directory for every staged update', async () => {
    const createPrivateDirectory = vi.fn((path: string) =>
      mkdir(path, { recursive: false, mode: 0o700 }),
    );
    const updates = manager({ createPrivateDirectory });
    await updates.noteCheck(updateCheck());
    await updates.download();

    expect(createPrivateDirectory).toHaveBeenCalledOnce();
    const privatePath = createPrivateDirectory.mock.calls[0]![0];
    expect(privatePath.startsWith(join(relayRoot, 'Updates'))).toBe(true);
    expect(basename(privatePath)).toMatch(/^v1\.1\.0-[0-9a-f-]+$/u);
    await expect(stat(privatePath)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  });

  it('fails before downloading when private staging cannot be secured', async () => {
    const updates = manager({
      createPrivateDirectory: () => {
        throw new Error('Windows private DACL unavailable');
      },
    });
    await updates.noteCheck(updateCheck());

    await expect(updates.download()).resolves.toMatchObject({
      phase: 'error',
      failureCode: 'download-failed',
    });
    expect(downloadAsset).not.toHaveBeenCalled();
    expect(extractInstaller).not.toHaveBeenCalled();
  });
});
