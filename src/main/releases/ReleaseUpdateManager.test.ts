import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelayUpdateCheck } from '@shared/releases';
import type { RelayInstallableAsset, RelayInstallableRelease } from './ReleaseUpdateService';
import { serializeRecoveryCatalog, type RecoveryBuildRecord } from './RecoveryCatalog';
import { ReleaseUpdateManager, type ReleaseUpdateManagerOptions } from './ReleaseUpdateManager';

const CURRENT_VERSION = '1.0.0';
const INSTALLER = Buffer.from('MZverified staged installer');
const INSTALLER_SHA256 = createHash('sha256').update(INSTALLER).digest('hex');
const ARCHIVE_SHA256 = 'a'.repeat(64);
const CHECKSUM_SHA256 = 'b'.repeat(64);

type ResolveLatestInstallable = (signal?: AbortSignal) => Promise<RelayInstallableRelease>;
type DownloadAsset = NonNullable<ReleaseUpdateManagerOptions['downloadAsset']>;
type ExtractInstaller = NonNullable<ReleaseUpdateManagerOptions['extractInstaller']>;
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
    targetCommitish: release().targetCommitish,
    updateAvailable: true,
    installable: true,
    assetSizeBytes: 140_000_000,
    releaseNotes: null,
    ...overrides,
  };
}

function recoveryBuild(): RecoveryBuildRecord {
  return {
    buildId: `r1-${'1'.repeat(40)}`,
    version: CURRENT_VERSION,
    releaseTag: `v${CURRENT_VERSION}`,
    targetCommitish: '1'.repeat(40),
    runtimeSha512: 'c'.repeat(128),
    installerSha256: null,
    recoveryProtocol: 1,
    serverDataEpoch: 1,
    clientDataEpoch: 1,
    installedAt: '2026-08-24T15:00:00.000Z',
    health: 'healthy',
    rollbackSnapshotId: null,
  };
}

describe('ReleaseUpdateManager', () => {
  let tempRoot: string;
  let localAppData: string;
  let relayRoot: string;
  let runtimeDirectory: string;
  let execPath: string;
  let resolveLatestInstallable: ReturnType<typeof vi.fn<ResolveLatestInstallable>>;
  let downloadAsset: ReturnType<typeof vi.fn<DownloadAsset>>;
  let extractInstaller: ReturnType<typeof vi.fn<ExtractInstaller>>;
  let revealInstaller: ReturnType<typeof vi.fn<(path: string) => unknown>>;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'relay-update-manager-'));
    localAppData = join(tempRoot, 'LocalAppData');
    relayRoot = join(localAppData, 'Relay');
    runtimeDirectory = join(relayRoot, 'Runtime', `r1-${'1'.repeat(40)}`);
    execPath = join(runtimeDirectory, 'Relay.exe');
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(execPath, 'MZcurrent runtime');

    resolveLatestInstallable = vi.fn<ResolveLatestInstallable>().mockResolvedValue(release());
    downloadAsset = vi.fn<DownloadAsset>().mockImplementation(async (releaseAsset, destination) => {
      if (releaseAsset.name.endsWith('.sha256')) {
        await writeFile(destination, `${ARCHIVE_SHA256}  ${release().archive.name}\n`);
      } else {
        await writeFile(destination, 'verified archive fixture');
      }
      return { bytes: releaseAsset.size, sha256: releaseAsset.sha256 };
    });
    extractInstaller = vi
      .fn<ExtractInstaller>()
      .mockImplementation(async (_archive, destination) => {
        await writeFile(destination, INSTALLER);
        return { bytes: INSTALLER.byteLength, sha256: INSTALLER_SHA256 };
      });
    revealInstaller = vi.fn<(path: string) => unknown>();
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
      revealInstaller,
      createPrivateDirectory: (path) => mkdir(path, { recursive: false, mode: 0o700 }),
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
    expect(revealInstaller).not.toHaveBeenCalled();
  });

  it('suppresses the exact immutable release after probation quarantines it', async () => {
    const currentBuild = recoveryBuild();
    await writeFile(
      join(relayRoot, 'state.ini'),
      serializeRecoveryCatalog({
        protocol: 2,
        generation: 3,
        currentBuildId: currentBuild.buildId,
        candidateBuildId: null,
        previousBuildIds: [],
        builds: [currentBuild],
        transaction: null,
        failedReleaseFingerprints: [`v1.1.0@${release().targetCommitish}`],
      }),
    );
    const updates = manager();
    await expect(updates.noteCheck(updateCheck())).resolves.toMatchObject({
      phase: 'available',
      installable: false,
      failureCode: 'release-quarantined',
    });
    await expect(updates.download()).resolves.toMatchObject({
      failureCode: 'release-quarantined',
    });
    expect(resolveLatestInstallable).not.toHaveBeenCalled();
  });

  it('does not quarantine a different commit published under the same version', async () => {
    const currentBuild = recoveryBuild();
    await writeFile(
      join(relayRoot, 'state.ini'),
      serializeRecoveryCatalog({
        protocol: 2,
        generation: 3,
        currentBuildId: currentBuild.buildId,
        candidateBuildId: null,
        previousBuildIds: [],
        builds: [currentBuild],
        transaction: null,
        failedReleaseFingerprints: [`v1.1.0@${'f'.repeat(40)}`],
      }),
    );
    await expect(manager().noteCheck(updateCheck())).resolves.toMatchObject({
      phase: 'available',
      installable: true,
      failureCode: null,
    });
  });

  it('reveals only the freshly verified installer and keeps it available', async () => {
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await expect(updates.download()).resolves.toMatchObject({
      phase: 'downloaded',
      downloadedBytes: 140_000_000,
      totalBytes: 140_000_000,
    });

    await expect(updates.revealInstaller()).resolves.toMatchObject({
      revealed: true,
      snapshot: { phase: 'downloaded', failureCode: null },
    });
    expect(revealInstaller).toHaveBeenCalledOnce();
    const installerPath = revealInstaller.mock.calls[0]?.[0];
    expect(installerPath).toBeTypeOf('string');
    expect(basename(installerPath!)).toBe('Relay.exe');
    expect(installerPath).toContain(join(relayRoot, 'Updates'));
    await expect(readFile(installerPath!)).resolves.toEqual(INSTALLER);
  });

  it('retains a verified installer when revealing its folder fails', async () => {
    revealInstaller.mockRejectedValueOnce(new Error('Explorer unavailable'));
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await updates.download();

    await expect(updates.revealInstaller()).resolves.toMatchObject({
      revealed: false,
      snapshot: { phase: 'error', failureCode: 'reveal-failed' },
    });
    await expect(updates.revealInstaller()).resolves.toMatchObject({
      revealed: true,
      snapshot: { phase: 'downloaded', failureCode: null },
    });
    expect(revealInstaller).toHaveBeenCalledTimes(2);
  });

  it('re-hashes the staged installer immediately before revealing it', async () => {
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await updates.download();
    const [stagingName] = await readdir(join(relayRoot, 'Updates'));
    await writeFile(join(relayRoot, 'Updates', stagingName!, 'Relay.exe'), 'MZchanged');

    await expect(updates.revealInstaller()).resolves.toMatchObject({
      revealed: false,
      snapshot: { phase: 'error', failureCode: 'verification-failed' },
    });
    expect(revealInstaller).not.toHaveBeenCalled();
    await expect(stat(join(relayRoot, 'Updates', stagingName!))).rejects.toThrow();
  });

  it('fails closed when the checksum and downloaded archive disagree', async () => {
    downloadAsset.mockImplementation(async (releaseAsset, destination) => {
      if (releaseAsset.name.endsWith('.sha256')) {
        await writeFile(destination, `${'f'.repeat(64)}  ${release().archive.name}\n`);
      } else {
        await writeFile(destination, 'archive');
      }
      return { bytes: releaseAsset.size, sha256: releaseAsset.sha256 };
    });
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await expect(updates.download()).resolves.toMatchObject({
      phase: 'error',
      failureCode: 'verification-failed',
    });
    expect(extractInstaller).not.toHaveBeenCalled();
  });

  it('classifies malformed archive extraction as a verification failure', async () => {
    extractInstaller.mockRejectedValueOnce(new Error('Relay release ZIP failed CRC validation'));
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await expect(updates.download()).resolves.toMatchObject({
      phase: 'error',
      failureCode: 'verification-failed',
    });
  });

  it('cancels an in-flight download and removes partial staging', async () => {
    downloadAsset.mockImplementation(async (releaseAsset, destination, options) => {
      if (releaseAsset.name.endsWith('.sha256')) {
        await writeFile(destination, ARCHIVE_SHA256 + '  ' + release().archive.name + '\n');
        return { bytes: releaseAsset.size, sha256: releaseAsset.sha256 };
      }
      await writeFile(destination, 'partial');
      const signal = options.signal;
      if (!signal) throw new Error('Download signal is required');
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      throw new Error('unreachable');
    });
    const updates = manager();
    await updates.noteCheck(updateCheck());
    const pending = updates.download();
    await vi.waitFor(() => expect(downloadAsset).toHaveBeenCalledTimes(2));
    await expect(updates.cancelDownload()).resolves.toMatchObject({
      phase: 'available',
      failureCode: null,
    });
    await pending;
    await expect(readdir(join(relayRoot, 'Updates'))).resolves.toEqual([]);
  });

  it('rejects a release that changes after discovery', async () => {
    resolveLatestInstallable.mockResolvedValueOnce(release('1.2.0'));
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await expect(updates.download()).resolves.toMatchObject({
      phase: 'error',
      failureCode: 'release-changed',
    });
    expect(downloadAsset).not.toHaveBeenCalled();
  });

  it('preserves a verified download when discovery confirms the same release', async () => {
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await updates.download();
    await expect(updates.noteCheck(updateCheck())).resolves.toMatchObject({ phase: 'downloaded' });
    expect(downloadAsset).toHaveBeenCalledTimes(2);
  });

  it('clears the old staged installer when discovery moves to a newer release', async () => {
    const updates = manager();
    await updates.noteCheck(updateCheck());
    await updates.download();
    const [stagingName] = await readdir(join(relayRoot, 'Updates'));

    await updates.noteCheck(
      updateCheck({ latestVersion: '1.2.0', targetCommitish: '2'.repeat(40) }),
    );
    await expect(stat(join(relayRoot, 'Updates', stagingName!))).rejects.toThrow();
    expect(updates.snapshot()).toMatchObject({ phase: 'available', latestVersion: '1.2.0' });
  });

  it('removes only abandoned Relay staging directories during initialization', async () => {
    const updatesRoot = join(relayRoot, 'Updates');
    const stale = join(updatesRoot, 'v1.1.0-12345678-1234-4123-8123-123456789abc');
    const unrelated = join(updatesRoot, 'operator-files');
    await mkdir(stale, { recursive: true });
    await mkdir(unrelated, { recursive: true });
    const old = new Date(Date.now() - 25 * 60 * 60 * 1_000);
    await utimes(stale, old, old);

    await manager().readySnapshot();
    await expect(stat(stale)).rejects.toThrow();
    await expect(stat(unrelated)).resolves.toBeDefined();
  });
});
