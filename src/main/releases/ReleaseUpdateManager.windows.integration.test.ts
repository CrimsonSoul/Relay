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
  it('downloads, verifies, and reveals the real Windows installer without changing the runtime', async () => {
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
      const statePath = join(root, 'state.ini');
      expect((await stat(execPath)).isFile()).toBe(true);
      expect((await stat(stableLauncher)).isFile()).toBe(true);
      const [currentRuntimeDigest, stableLauncherDigest, currentStateContents] = await Promise.all([
        sha256(execPath),
        sha256(stableLauncher),
        readFile(statePath),
      ]);
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
      let revealedInstaller: string | null = null;
      const manager = new ReleaseUpdateManager({
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
        revealInstaller: (path) => {
          revealedInstaller = path;
        },
      });
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
      const revealResult = await manager.revealInstaller();
      expect(revealResult).toMatchObject({
        revealed: true,
        snapshot: { phase: 'downloaded', failureCode: null },
      });
      if (!revealedInstaller) throw new Error('Updater did not reveal the verified installer');
      expect(relative(join(root, 'Updates'), revealedInstaller).startsWith('..')).toBe(false);
      expect(await sha256(revealedInstaller)).toBe(targetInstallerDigest);
      expect((await stat(currentRuntimePath)).isFile()).toBe(true);
      expect((await stat(stableLauncher)).isFile()).toBe(true);
      expect(await sha256(currentRuntimePath)).toBe(currentRuntimeDigest);
      expect(await sha256(stableLauncher)).toBe(stableLauncherDigest);
      await expect(readFile(statePath)).resolves.toEqual(currentStateContents);
      await expect(stat(targetRuntimePath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(dataSentinel, 'utf8')).resolves.toBe(sentinelContents);
      await expect(stat(join(root, 'Recovery', 'update-request.ini'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(readdir(join(root, 'Updates'))).resolves.toHaveLength(1);
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
