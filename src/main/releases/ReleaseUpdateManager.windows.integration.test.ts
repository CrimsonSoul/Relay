import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import type { RelayUpdateCheck } from '@shared/releases';
import { parseRecoveryCatalog, serializeRecoveryCatalog } from './RecoveryCatalog';
import { writeRecoveryRepairRequest } from './RecoveryRepairRequest';
import { repairRecoveryRuntime } from './RecoveryRuntimeRepair';
import { prepareRecoveryRestart } from './RecoveryRestartCoordinator';
import { completeRecoveryUpdateRequest, readRecoveryUpdateRequest } from './RecoveryUpdateRequest';
import { ReleaseUpdateManager } from './ReleaseUpdateManager';
import type { RelayInstallableAsset } from './ReleaseUpdateService';

const INTEGRATION_ENABLED =
  process.platform === 'win32' && process.env.RELAY_UPDATER_INTEGRATION_CONFIRM === '1';
const PROCESS_TIMEOUT_MS = 120_000;
const POWERSHELL_OUTPUT_LIMIT = 64 * 1_024;

type RelayProcess = { pid: number; executablePath: string };
type ShortcutSnapshot = { path: string; backupPath: string | null };

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the Windows updater integration test`);
  return value;
}

function isDirectChild(parent: string, child: string): boolean {
  const childRelative = relative(parent, child);
  return Boolean(childRelative) && !isAbsolute(childRelative) && !childRelative.includes(sep);
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function terminateProcessTree(pid: number): Promise<number | null> {
  return new Promise((resolvePromise) => {
    const taskkill = spawn(
      join(requiredEnvironment('SystemRoot'), 'System32', 'taskkill.exe'),
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    );
    const timeout = setTimeout(() => {
      taskkill.kill();
      resolvePromise(null);
    }, 15_000);
    const finish = (code: number | null) => {
      clearTimeout(timeout);
      resolvePromise(code);
    };
    taskkill.once('error', () => finish(null));
    taskkill.once('close', finish);
  });
}

function runProcess(path: string, args: string[]): Promise<number | null> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(path, args, { windowsHide: true, stdio: 'ignore' });
    let settled = false;
    const timeout = setTimeout(async () => {
      if (settled) return;
      settled = true;
      if (child.pid) await terminateProcessTree(child.pid);
      else child.kill();
      reject(new Error(`Timed out waiting for ${path}`));
    }, PROCESS_TIMEOUT_MS);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise(code);
    });
  });
}

function runPowerShellLines(command: string): Promise<string[]> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      join(
        requiredEnvironment('SystemRoot'),
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); ${command}`,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let settled = false;
    let output = '';
    const fail = async (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (child.pid) await terminateProcessTree(child.pid);
      reject(error);
    };
    const timeout = setTimeout(() => {
      void fail(new Error('Timed out querying Windows process state'));
    }, 30_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      if (Buffer.byteLength(output, 'utf8') > POWERSHELL_OUTPUT_LIMIT) {
        void fail(new Error('Windows process query returned too much output'));
      }
    });
    child.once('error', (error) => void fail(error));
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Windows process query exited with code ${code}`));
        return;
      }
      resolvePromise(
        output
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter(Boolean),
      );
    });
  });
}

async function listRelayProcesses(): Promise<RelayProcess[]> {
  const lines = await runPowerShellLines(
    'Get-CimInstance Win32_Process -Filter "Name = \'Relay.exe\'" | ForEach-Object { if (-not [string]::IsNullOrWhiteSpace([string]$_.ExecutablePath)) { Write-Output ([string]::Concat($_.ProcessId, [char]9, $_.ExecutablePath)) } }',
  );
  return lines.map(parseRelayProcessLine).filter((process) => process !== null);
}

function parseRelayProcessLine(line: string): RelayProcess | null {
  const separator = line.indexOf('\t');
  const pid = Number(line.slice(0, separator));
  const executablePath = line.slice(separator + 1);
  return separator > 0 && Number.isSafeInteger(pid) && pid > 0 && isAbsolute(executablePath)
    ? { pid, executablePath }
    : null;
}

function sameWindowsPath(first: string, second: string): boolean {
  return resolve(first).toLowerCase() === resolve(second).toLowerCase();
}

async function waitForRelayRuntimeQuiescence(executablePath: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  let idleChecks = 0;
  while (Date.now() < deadline) {
    const active = (await listRelayProcesses()).some((process) =>
      sameWindowsPath(process.executablePath, executablePath),
    );
    if (active) idleChecks = 0;
    else if (++idleChecks >= 3) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Relay runtime did not become quiescent: ${executablePath}`);
}

async function stopRelayRuntime(executablePath: string): Promise<void> {
  const matches = (await listRelayProcesses()).filter((process) =>
    sameWindowsPath(process.executablePath, executablePath),
  );
  await Promise.all(matches.map(({ pid }) => terminateProcessTree(pid)));
}

async function existingDirectory(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Expected a regular directory or an absent path: ${path}`);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function snapshotShortcuts(paths: string[], backupRoot: string): Promise<ShortcutSnapshot[]> {
  await mkdir(backupRoot, { recursive: false });
  const snapshots: ShortcutSnapshot[] = [];
  for (const [index, path] of paths.entries()) {
    try {
      const stats = await lstat(path);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error(`Updater integration will not replace a redirected shortcut: ${path}`);
      }
      const backupPath = join(backupRoot, `${index}.lnk`);
      await copyFile(path, backupPath);
      snapshots.push({ path, backupPath });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      snapshots.push({ path, backupPath: null });
    }
  }
  return snapshots;
}

async function restoreShortcuts(snapshots: ShortcutSnapshot[]): Promise<void> {
  for (const snapshot of snapshots) {
    if (snapshot.backupPath) {
      await mkdir(dirname(snapshot.path), { recursive: true });
      await copyFile(snapshot.backupPath, snapshot.path);
    } else {
      await rm(snapshot.path, { force: true });
    }
  }
}

async function waitForFile(path: string): Promise<string> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      return (await readFile(path, 'utf8')).trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function asset(id: number, name: string, bytes: number, digest: string): RelayInstallableAsset {
  return {
    id,
    name,
    apiUrl: `https://api.github.com/repos/CrimsonSoul/Relay/releases/assets/${id}`,
    size: bytes,
    sha256: digest,
  };
}

describe('Windows updater native boundary helpers', () => {
  it('parses a real tab delimiter and rejects the literal PowerShell escape text', () => {
    const executablePath = resolve('fixture', 'Relay.exe');

    expect(parseRelayProcessLine(`123\t${executablePath}`)).toEqual({ pid: 123, executablePath });
    expect(parseRelayProcessLine(`123\`t${executablePath}`)).toBeNull();
  });
});

describe.runIf(INTEGRATION_ENABLED)('Windows updater native boundary integration', () => {
  it('downloads, stages, prepares, restarts, promotes, and retains through real native executables', async () => {
    const root = resolve(requiredEnvironment('RELAY_UPDATER_INTEGRATION_ROOT'));
    const runnerTemp = await realpath(requiredEnvironment('RUNNER_TEMP'));
    const localAppData = dirname(root);
    const currentArtifact = resolve(
      requiredEnvironment('RELAY_UPDATER_INTEGRATION_CURRENT_ARTIFACT'),
    );
    const targetArtifact = resolve(
      requiredEnvironment('RELAY_UPDATER_INTEGRATION_TARGET_ARTIFACT'),
    );
    const archivePath = resolve(requiredEnvironment('RELAY_UPDATER_INTEGRATION_ARCHIVE'));
    const checksumPath = resolve(requiredEnvironment('RELAY_UPDATER_INTEGRATION_CHECKSUM'));
    const currentBuildId = requiredEnvironment('RELAY_UPDATER_INTEGRATION_CURRENT_BUILD_ID');
    const targetBuildId = requiredEnvironment('RELAY_UPDATER_INTEGRATION_TARGET_BUILD_ID');
    const currentVersion = requiredEnvironment('RELAY_UPDATER_INTEGRATION_CURRENT_VERSION');
    const targetVersion = requiredEnvironment('RELAY_UPDATER_INTEGRATION_TARGET_VERSION');
    const targetCommitish = requiredEnvironment('RELAY_UPDATER_INTEGRATION_TARGET_COMMITISH');

    if (root !== join(localAppData, 'Relay') || !isDirectChild(runnerTemp, localAppData)) {
      throw new Error('Updater integration root must be RUNNER_TEMP/<run>/Relay');
    }
    await expect(stat(localAppData)).rejects.toMatchObject({ code: 'ENOENT' });

    const appData = join(localAppData, 'AppData');
    const temp = join(localAppData, 'Temp');
    const dataSentinel = join(appData, 'Relay', 'data', 'updater-integration-sentinel.txt');
    const sentinelContents = `relay-updater-${randomUUID()}`;
    const runId = randomUUID();
    const exitMarker = join(temp, 'Relay', 'startup-benchmark', `${runId}.complete`);
    const originalEnvironment = new Map<string, string | undefined>();
    const setEnvironment = (name: string, value: string) => {
      originalEnvironment.set(name, process.env[name]);
      process.env[name] = value;
    };
    const [desktop, programs] = await runPowerShellLines(
      'Write-Output ([Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)); Write-Output ([Environment]::GetFolderPath([Environment+SpecialFolder]::Programs))',
    );
    if (!desktop || !programs || !isAbsolute(desktop) || !isAbsolute(programs)) {
      throw new Error('Windows known shortcut folders were unavailable');
    }
    const programsRelay = join(programs, 'Relay');
    const shortcutPaths = [
      join(desktop, 'Relay.lnk'),
      join(programsRelay, 'Relay.lnk'),
      join(programsRelay, 'Relay Recovery.lnk'),
    ];
    const programsRelayExisted = await existingDirectory(programsRelay);
    const currentRuntimePath = join(root, 'Runtime', currentBuildId, 'Relay.exe');
    const targetRuntimePath = join(root, 'Runtime', targetBuildId, 'Relay.exe');
    let ownsLocalAppData = false;
    let shortcutSnapshots: ShortcutSnapshot[] = [];
    let shortcutsSnapshotted = false;

    try {
      await mkdir(localAppData, { recursive: false });
      ownsLocalAppData = true;
      shortcutSnapshots = await snapshotShortcuts(
        shortcutPaths,
        join(localAppData, 'ShortcutBackups'),
      );
      shortcutsSnapshotted = true;
      await mkdir(dirname(dataSentinel), { recursive: true });
      await mkdir(temp, { recursive: true });
      await writeFile(dataSentinel, sentinelContents, 'utf8');
      setEnvironment('LOCALAPPDATA', localAppData);
      setEnvironment('APPDATA', appData);
      setEnvironment('TEMP', temp);
      setEnvironment('TMP', temp);
      setEnvironment('RELAY_BENCHMARK_EXIT_AFTER_RENDER', '1');
      setEnvironment('RELAY_BENCHMARK_RUN_ID', runId);
      setEnvironment('RELAY_DISABLE_GPU_DIAGNOSTICS', '1');
      setEnvironment('RELAY_DISABLE_CRASH_WATCHDOG', '1');

      await expect(runProcess(currentArtifact, ['/relay-prepare-only'])).resolves.toBe(0);

      const execPath = currentRuntimePath;
      const stableLauncher = join(root, 'Relay.exe');
      expect((await stat(execPath)).isFile()).toBe(true);
      expect((await stat(stableLauncher)).isFile()).toBe(true);

      const archiveName = `Relay-v${targetVersion}-windows-x64.zip`;
      const [archiveStats, checksumStats, archiveDigest, checksumDigest, targetInstallerDigest] =
        await Promise.all([
          stat(archivePath),
          stat(checksumPath),
          sha256(archivePath),
          sha256(checksumPath),
          sha256(targetArtifact),
        ]);
      const archive = asset(9101, archiveName, archiveStats.size, archiveDigest);
      const checksum = asset(9102, `${archiveName}.sha256`, checksumStats.size, checksumDigest);
      let launcherExit: Promise<number | null> | null = null;
      const createManager = () =>
        new ReleaseUpdateManager({
          service: {
            resolveLatestInstallable: async () => ({
              version: targetVersion,
              targetCommitish,
              archive,
              checksum,
            }),
          },
          getCurrentVersion: () => currentVersion,
          platform: 'win32',
          arch: 'x64',
          isPackaged: true,
          localAppData,
          execPath,
          getInstallationMode: () => 'unconfigured',
          downloadAsset: async (releaseAsset, destination, options) => {
            options.signal?.throwIfAborted();
            const source = releaseAsset.name.endsWith('.sha256') ? checksumPath : archivePath;
            await copyFile(source, destination);
            options.signal?.throwIfAborted();
            const copiedBytes = (await stat(destination)).size;
            const copiedDigest = await sha256(destination);
            options.onProgress?.(copiedBytes, releaseAsset.size);
            return { bytes: copiedBytes, sha256: copiedDigest };
          },
          prepareRecoveryRestart: (transactionId) =>
            prepareRecoveryRestart({
              transactionId,
              getRequest: () => readRecoveryUpdateRequest(root),
              getCurrentMode: () => 'unconfigured',
              stopServer: async () => undefined,
              checkpointClient: () => true,
              createServerSnapshot: async () => {
                throw new Error('Unconfigured updater integration must not snapshot server data');
              },
              completeRequest: (matchingTransactionId, snapshotId) =>
                completeRecoveryUpdateRequest(
                  root,
                  matchingTransactionId,
                  'unconfigured',
                  snapshotId,
                ),
            }),
          restartApp: (launcherPath) => {
            expect(resolve(launcherPath)).toBe(resolve(stableLauncher));
            launcherExit = runProcess(launcherPath, []);
          },
        });
      const manager = createManager();
      const updateCheck: RelayUpdateCheck = {
        currentVersion,
        latestVersion: targetVersion,
        targetCommitish,
        updateAvailable: true,
        installable: true,
        assetSizeBytes: archiveStats.size,
        releaseNotes: {
          version: targetVersion,
          title: `Relay v${targetVersion}`,
          body: 'Windows updater integration fixture.',
          publishedAt: '2026-08-27T12:00:00.000Z',
          immutable: true,
        },
      };

      await expect(manager.noteCheck(updateCheck)).resolves.toMatchObject({
        phase: 'available',
        installable: true,
      });
      await expect(manager.download()).resolves.toMatchObject({ phase: 'downloaded' });
      await expect(manager.install()).resolves.toMatchObject({ phase: 'ready-to-restart' });
      const resumedManager = createManager();
      await expect(resumedManager.noteCheck(updateCheck)).resolves.toMatchObject({
        phase: 'ready-to-restart',
        latestVersion: targetVersion,
      });
      await expect(resumedManager.restart()).resolves.toBe(true);
      if (!launcherExit) throw new Error('Updater did not start the stable launcher');
      await expect(launcherExit).resolves.toBe(0);
      await expect(waitForFile(exitMarker)).resolves.toBe(targetBuildId);
      await waitForRelayRuntimeQuiescence(targetRuntimePath);

      const catalog = parseRecoveryCatalog(await readFile(join(root, 'state.ini'), 'utf8'));
      expect(catalog).not.toBeNull();
      expect(catalog).toMatchObject({
        currentBuildId: targetBuildId,
        candidateBuildId: null,
        previousBuildIds: [currentBuildId],
        transaction: null,
      });
      const targetBuild = catalog?.builds.find(({ buildId }) => buildId === targetBuildId);
      expect(targetBuild).toMatchObject({
        version: targetVersion,
        health: 'healthy',
        installerSha256: targetInstallerDigest,
      });
      if (!targetBuild) throw new Error('Updater did not promote the target build');
      const targetMarker = await readFile(
        join(root, 'Runtime', targetBuildId, '.relay-runtime-ready'),
        'utf8',
      );
      const targetPersistedHashes = targetMarker
        .split(/\r?\n/u)
        .filter((line) => line.startsWith('payloadHash=') || line.includes('Sha512='))
        .map((line) => line.slice(line.indexOf('=') + 1));
      expect(targetPersistedHashes).toHaveLength(15);
      expect(targetPersistedHashes.every((hash) => hash === hash.toLowerCase())).toBe(true);
      expect(targetBuild.runtimeSha512).toBe(
        createHash('sha512').update(targetMarker).digest('hex'),
      );
      expect(targetBuild.runtimeSha512).toBe(targetBuild.runtimeSha512.toLowerCase());
      expect(catalog?.builds.find(({ buildId }) => buildId === currentBuildId)).toMatchObject({
        version: currentVersion,
        health: 'healthy',
      });
      expect((await stat(join(root, 'Runtime', currentBuildId, 'Relay.exe'))).isFile()).toBe(true);
      await expect(readdir(join(root, 'Updates'))).resolves.toEqual([]);
      await expect(readFile(dataSentinel, 'utf8')).resolves.toBe(sentinelContents);
      await expect(stat(join(root, 'Recovery', 'update-request.ini'))).rejects.toMatchObject({
        code: 'ENOENT',
      });

      if (!catalog) throw new Error('Updater did not promote a recovery catalog');
      const previousBuild = catalog.builds.find(({ buildId }) => buildId === currentBuildId);
      if (!previousBuild) throw new Error('Updater did not retain the previous build');
      const previousMarkerPath = join(root, 'Runtime', currentBuildId, '.relay-runtime-ready');
      await expect(readFile(previousMarkerPath, 'utf8')).resolves.not.toContain('installerSha256=');

      const currentInstallerDigest = await sha256(currentArtifact);
      previousBuild.installerSha256 = currentInstallerDigest;
      await writeFile(join(root, 'state.ini'), serializeRecoveryCatalog(catalog));
      const repairPreviousBuild = async (): Promise<string> => {
        await Promise.all([
          rm(join(root, 'Recovery', 'repair-request.ini'), { force: true }),
          rm(join(root, 'Recovery', 'repair-result.ini'), { force: true }),
          rm(currentRuntimePath, { force: true }),
        ]);
        const repairTransactionId = randomUUID();
        await writeRecoveryRepairRequest(
          root,
          {
            protocol: 2,
            transactionId: repairTransactionId,
            sourceBuildId: targetBuildId,
            targetBuildId: currentBuildId,
            targetVersion: currentVersion,
            targetCommitish,
            targetInstallerSha256: currentInstallerDigest,
            checkpoint: 'pending',
            requestedAt: new Date().toISOString(),
          },
          (path) => mkdir(path, { recursive: false, mode: 0o700 }),
        );
        await expect(
          runProcess(currentArtifact, [
            '/relay-repair-only',
            '/relay-transaction=' + repairTransactionId,
          ]),
        ).resolves.toBe(0);
        expect((await stat(currentRuntimePath)).isFile()).toBe(true);
        return readFile(previousMarkerPath, 'utf8');
      };

      await expect(repairPreviousBuild()).resolves.not.toContain('installerSha256=');

      const legacyMarker = await readFile(previousMarkerPath, 'utf8');
      const lineEnding = legacyMarker.includes('\r\n') ? '\r\n' : '\n';
      const protectedMarker = legacyMarker.replace(
        /(^installedAt=.*(?:\r?\n))/mu,
        '$1installerSha256=' + currentInstallerDigest + lineEnding,
      );
      expect(protectedMarker).not.toBe(legacyMarker);
      previousBuild.runtimeSha512 = createHash('sha512').update(protectedMarker).digest('hex');
      await writeFile(previousMarkerPath, protectedMarker);
      await writeFile(join(root, 'state.ini'), serializeRecoveryCatalog(catalog));

      const activeBuild = catalog.builds.find(({ buildId }) => buildId === targetBuildId);
      if (!activeBuild) throw new Error('Updater did not retain the active build record');
      const repairArchiveName = 'relay-win-x64.zip';
      const repairArchive = Buffer.from('native updater repair integration archive');
      const repairArchiveDigest = createHash('sha256').update(repairArchive).digest('hex');
      const repairChecksum = Buffer.from(repairArchiveDigest + '  ' + repairArchiveName + '\n');
      const repairChecksumDigest = createHash('sha256').update(repairChecksum).digest('hex');
      const currentArtifactBytes = (await stat(currentArtifact)).size;
      await rm(currentRuntimePath, { force: true });
      await expect(
        repairRecoveryRuntime(
          { relayRoot: root, sourceBuild: activeBuild, targetBuild: previousBuild },
          {
            resolveInstallableByTag: async () => ({
              version: previousBuild.version,
              targetCommitish: previousBuild.targetCommitish,
              archive: {
                id: 1,
                name: repairArchiveName,
                apiUrl: 'https://api.github.com/repos/CrimsonSoul/Relay/releases/assets/1',
                size: repairArchive.byteLength,
                sha256: repairArchiveDigest,
              },
              checksum: {
                id: 2,
                name: repairArchiveName + '.sha256',
                apiUrl: 'https://api.github.com/repos/CrimsonSoul/Relay/releases/assets/2',
                size: repairChecksum.byteLength,
                sha256: repairChecksumDigest,
              },
            }),
            downloadAsset: async (asset, destination) => {
              const contents = asset.name.endsWith('.sha256') ? repairChecksum : repairArchive;
              await writeFile(destination, contents);
              return {
                bytes: contents.byteLength,
                sha256: createHash('sha256').update(contents).digest('hex'),
              };
            },
            extractInstaller: async (_archivePath, destination) => {
              await copyFile(currentArtifact, destination);
              return { bytes: currentArtifactBytes, sha256: currentInstallerDigest };
            },
            spawnInstaller: runProcess,
            createPrivateDirectory: (path) => mkdir(path, { recursive: false, mode: 0o700 }),
            now: () => new Date(),
            randomUuid: randomUUID,
          },
        ),
      ).resolves.toBe(true);
      const repairedProtectedMarker = await readFile(previousMarkerPath, 'utf8');
      expect(repairedProtectedMarker).toContain(
        'installerSha256=' + currentInstallerDigest + lineEnding,
      );
      expect(createHash('sha512').update(repairedProtectedMarker).digest('hex')).toBe(
        previousBuild.runtimeSha512,
      );
    } finally {
      await Promise.all(
        [currentRuntimePath, targetRuntimePath].map((path) =>
          stopRelayRuntime(path).catch(() => undefined),
        ),
      );
      for (const [name, value] of originalEnvironment) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      if (shortcutsSnapshotted) await restoreShortcuts(shortcutSnapshots);
      if (!programsRelayExisted) {
        await rmdir(programsRelay).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY') throw error;
        });
      }
      if (ownsLocalAppData) await rm(localAppData, { recursive: true, force: true });
    }
  }, 180_000);
});
