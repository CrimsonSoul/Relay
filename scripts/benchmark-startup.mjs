#!/usr/bin/env node

import { _electron as electron } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildLaunchSpec,
  extractLatestStartupTimeline,
  median,
  parseStartupBenchmarkArgs,
  sliceAppendedLogText,
  waitForProcessQuiescence,
} from './startup-benchmark-utils.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const mainEntry = path.join(root, 'dist/main/index.js');
const warmRunCount = 5;
const launchTimeoutMs = 60_000;
const terminateOwnedWindowsBenchmarkScript = `
$ErrorActionPreference = 'Stop'
$targetPid = [int]$env:RELAY_BENCHMARK_TARGET_PID
$identityToken = $env:RELAY_BENCHMARK_PROCESS_TOKEN
$records = @(Get-CimInstance Win32_Process)
$rootRecord = $records |
  Where-Object { [int]$_.ProcessId -eq $targetPid } |
  Select-Object -First 1
if ($null -eq $rootRecord -or -not ([string]$rootRecord.CommandLine).Contains($identityToken)) {
  exit 3
}

function Get-CreationTimeUtc {
  param([Parameter(Mandatory = $true)][object]$Record)
  if ($Record.CreationDate -is [DateTime]) {
    return $Record.CreationDate.ToUniversalTime()
  }
  return [Management.ManagementDateTimeConverter]::ToDateTime(
    [string]$Record.CreationDate
  ).ToUniversalTime()
}

function Open-MatchingProcessHandle {
  param([Parameter(Mandatory = $true)][object]$Record)
  $process = Get-Process -Id ([int]$Record.ProcessId) -ErrorAction SilentlyContinue
  if ($null -eq $process) {
    return $null
  }
  try {
    # Opening the handle pins this process identity before any PID can be reused.
    $null = $process.Handle
    [long]$actualTicks = $process.StartTime.ToUniversalTime().Ticks
    [long]$expectedTicks = (Get-CreationTimeUtc -Record $Record).Ticks
    # CIM exposes creation time to microsecond precision; compare exactly at that precision.
    $actualTicks = $actualTicks - ($actualTicks % 10)
    $expectedTicks = $expectedTicks - ($expectedTicks % 10)
    if ($actualTicks -ne $expectedTicks) {
      $process.Dispose()
      return $null
    }
    return $process
  }
  catch {
    $process.Dispose()
    return $null
  }
}

$rootProcess = Open-MatchingProcessHandle -Record $rootRecord
if ($null -eq $rootProcess) {
  exit 3
}

$targets = @(
  [pscustomobject]@{ Record = $rootRecord; Depth = 0 }
)
$known = @{}
$known[$targetPid] = $true
$added = $true
while ($added) {
  $added = $false
  foreach ($record in $records) {
    $recordId = [int]$record.ProcessId
    $parentId = [int]$record.ParentProcessId
    if ($known.ContainsKey($recordId) -or -not $known.ContainsKey($parentId)) {
      continue
    }
    $parent = $targets |
      Where-Object { [int]$_.Record.ProcessId -eq $parentId } |
      Select-Object -First 1
    if ((Get-CreationTimeUtc -Record $record) -lt (Get-CreationTimeUtc -Record $parent.Record)) {
      continue
    }
    $targets += [pscustomobject]@{ Record = $record; Depth = $parent.Depth + 1 }
    $known[$recordId] = $true
    $added = $true
  }
}

$pinnedTargets = @(
  [pscustomobject]@{ Process = $rootProcess; Depth = 0 }
)
foreach ($target in @($targets | Where-Object { $_.Depth -gt 0 })) {
  $process = Open-MatchingProcessHandle -Record $target.Record
  if ($null -eq $process) {
    continue
  }
  $pinnedTargets += [pscustomobject]@{ Process = $process; Depth = $target.Depth }
}

foreach ($target in @($pinnedTargets | Sort-Object -Property Depth -Descending)) {
  try {
    $target.Process.Kill()
  }
  catch {
    # A pinned process that has already exited is safely gone.
  }
  finally {
    $target.Process.Dispose()
  }
}
exit 0
`;
const probeRuntimeProcessWindowsScript = `
$ErrorActionPreference = 'Stop'
$targetPath = [IO.Path]::GetFullPath($env:RELAY_BENCHMARK_RUNTIME_EXECUTABLE)
$records = @(Get-CimInstance Win32_Process)
foreach ($record in $records) {
  if ([string]::IsNullOrWhiteSpace([string]$record.ExecutablePath)) {
    continue
  }
  try {
    $candidatePath = [IO.Path]::GetFullPath([string]$record.ExecutablePath)
    if ([string]::Equals($candidatePath, $targetPath, [StringComparison]::OrdinalIgnoreCase)) {
      exit 2
    }
  }
  catch {
    # A process can exit between the CIM snapshot and path inspection.
  }
}
exit 0
`;
const buildIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const reservedWindowsNames = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function isBuildId(value) {
  return (
    typeof value === 'string' &&
    buildIdPattern.test(value) &&
    !value.endsWith('.') &&
    !reservedWindowsNames.has(value.split('.', 1)[0])
  );
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  if (!port) throw new Error('Could not reserve a local PocketBase port.');
  return port;
}

function writeServerConfig(userDataDir, port, secret) {
  const dataDir = path.join(userDataDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, 'config.json'),
    JSON.stringify({ mode: 'server', port, secret }, null, 2),
    'utf8',
  );
}

async function readTimeline(logPath) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      const timeline = extractLatestStartupTimeline(fs.readFileSync(logPath, 'utf8'));
      if (timeline?.['renderer-mounted'] !== undefined) return timeline;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await delay(25);
  }
  return null;
}

async function measureDevelopmentLaunch(userDataDir) {
  const startedAt = performance.now();
  const launchEnv = { ...process.env, NODE_ENV: 'test' };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  let electronApp;
  try {
    electronApp = await electron.launch({
      args: [`--user-data-dir=${userDataDir}`, mainEntry],
      env: launchEnv,
      timeout: launchTimeoutMs,
    });
    const window = await electronApp.firstWindow({ timeout: launchTimeoutMs });
    await window.waitForFunction(() => globalThis.document.visibilityState === 'visible', null, {
      timeout: launchTimeoutMs,
    });
    const windowVisibleMs = Math.round(performance.now() - startedAt);
    await window
      .getByTestId('sidebar-compose')
      .waitFor({ state: 'visible', timeout: launchTimeoutMs });
    const workspaceVisibleMs = Math.round(performance.now() - startedAt);
    const timeline = await readTimeline(path.join(userDataDir, 'logs', 'relay.log'));
    return { windowVisibleMs, workspaceVisibleMs, timeline };
  } finally {
    await electronApp?.close().catch(() => undefined);
  }
}

function summarizeDevelopment(label, result) {
  return {
    label,
    windowVisibleMs: result.windowVisibleMs,
    workspaceVisibleMs: result.workspaceVisibleMs,
    timeline: result.timeline,
  };
}

async function runDevelopmentBenchmark() {
  if (!fs.existsSync(mainEntry)) {
    throw new Error('Relay is not built. Run `npm run build` before benchmarking startup.');
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-startup-benchmark-'));
  try {
    const port = await reservePort();
    writeServerConfig(userDataDir, port, `benchmark-${crypto.randomUUID()}`);
    const provisioning = await measureDevelopmentLaunch(userDataDir);
    const secondDevelopmentLaunch = await measureDevelopmentLaunch(userDataDir);
    const warm = [];
    for (let index = 0; index < warmRunCount; index += 1) {
      warm.push(await measureDevelopmentLaunch(userDataDir));
    }

    return {
      scenario: 'development',
      provisioning: summarizeDevelopment('fresh unpackaged development profile', provisioning),
      secondDevelopmentLaunch: summarizeDevelopment(
        'second unpackaged development launch (not an update)',
        secondDevelopmentLaunch,
      ),
      warmMedian: {
        label: `median of ${warmRunCount} subsequent unpackaged launches`,
        windowVisibleMs: median(warm.map((sample) => sample.windowVisibleMs)),
        workspaceVisibleMs: median(warm.map((sample) => sample.workspaceVisibleMs)),
      },
      warm: warm.map((sample, index) =>
        summarizeDevelopment(`unpackaged warm ${index + 1}`, sample),
      ),
    };
  } finally {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

function readLogBaseline(logPath) {
  try {
    const stats = fs.statSync(logPath);
    return {
      exists: true,
      size: stats.size,
      identity: `${stats.dev}:${stats.ino}:${stats.birthtimeMs}`,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, size: 0, identity: null };
    throw error;
  }
}

async function waitForPackagedTimeline(logPath, baseline, startedAt, signal) {
  const deadline = Date.now() + launchTimeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason;
    try {
      const stats = fs.statSync(logPath);
      const identity = `${stats.dev}:${stats.ino}:${stats.birthtimeMs}`;
      const logBuffer = fs.readFileSync(logPath);
      const appendedText =
        baseline.exists && identity === baseline.identity && logBuffer.length >= baseline.size
          ? sliceAppendedLogText(logBuffer, baseline.size)
          : logBuffer.toString('utf8');
      const timeline = extractLatestStartupTimeline(appendedText);
      if (timeline?.['renderer-mounted'] !== undefined) {
        return {
          timeline,
          rendererMountedWallMs: Math.round(performance.now() - startedAt),
        };
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    await delay(25);
  }
  throw new Error(
    `Relay did not write a new renderer startup milestone within ${launchTimeoutMs}ms.`,
  );
}

function listCompleteRuntimeBuilds(runtimeRoot) {
  const complete = new Set();
  try {
    for (const entry of fs.readdirSync(runtimeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isBuildId(entry.name)) continue;
      const runtimeDir = path.join(runtimeRoot, entry.name);
      if (
        fs.existsSync(path.join(runtimeDir, '.relay-runtime-ready')) &&
        fs.existsSync(path.join(runtimeDir, 'Relay.exe'))
      ) {
        complete.add(entry.name);
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return complete;
}

function readCurrentBuildId(statePath) {
  try {
    const match = /^current=(.+)$/m.exec(fs.readFileSync(statePath, 'utf8'));
    const buildId = match?.[1]?.trim();
    return isBuildId(buildId) ? buildId : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function powershellPath(environment = process.env) {
  const windowsRoot = environment.SystemRoot ?? environment.WINDIR;
  return windowsRoot
    ? path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : null;
}

function terminateDirectChild(child) {
  if (!child || child.killed) return;
  try {
    child.kill('SIGKILL');
  } catch {
    // The directly spawned process may have exited while cleanup was requested.
  }
}

function terminateOwnedBenchmarkProcess({ pid, runId, exitMarkerPath, environment = process.env }) {
  if (!pid || fs.existsSync(exitMarkerPath)) return false;
  const shellPath = powershellPath(environment);
  if (process.platform !== 'win32' || !shellPath) return false;
  const identityToken = `--relay-benchmark-run-id=${runId}`;
  const result = spawnSync(
    shellPath,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', terminateOwnedWindowsBenchmarkScript],
    {
      env: {
        ...environment,
        RELAY_BENCHMARK_TARGET_PID: String(pid),
        RELAY_BENCHMARK_PROCESS_TOKEN: identityToken,
      },
      stdio: 'ignore',
      windowsHide: true,
      timeout: 10_000,
    },
  );
  return result.status === 0;
}

function isRuntimeProcessActive(executablePath, environment = process.env) {
  const shellPath = powershellPath(environment);
  if (process.platform !== 'win32' || !shellPath) {
    throw new Error('Windows PowerShell is required to inspect Relay runtime processes.');
  }
  const result = spawnSync(
    shellPath,
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', probeRuntimeProcessWindowsScript],
    {
      env: {
        ...environment,
        RELAY_BENCHMARK_RUNTIME_EXECUTABLE: executablePath,
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    },
  );
  if (result.error) throw result.error;
  if (result.status === 0) return false;
  if (result.status === 2) return true;
  const detail = result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.status}`;
  throw new Error(`Relay runtime process inspection failed: ${detail}`);
}

function waitForRuntimeProcessQuiescence(executablePath, environment = process.env) {
  return waitForProcessQuiescence(() => isRuntimeProcessActive(executablePath, environment), {
    idleChecks: 3,
    pollIntervalMs: 100,
    timeoutMs: 15_000,
  });
}

function readBenchmarkPid(markerPath) {
  try {
    const pid = Number(fs.readFileSync(markerPath, 'utf8').trim());
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error(`Relay wrote an invalid benchmark PID marker: ${markerPath}`);
    }
    return pid;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function waitForBenchmarkPid(markerPath, signal) {
  const deadline = Date.now() + launchTimeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason;
    const pid = readBenchmarkPid(markerPath);
    if (pid) return pid;
    await delay(25);
  }
  throw new Error(`Relay did not publish its benchmark PID within ${launchTimeoutMs}ms.`);
}

async function waitForProcessHandoff(command, args, environment, startedAt, signal) {
  const child = spawn(command, args, {
    env: environment,
    stdio: 'ignore',
    windowsHide: false,
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onAbort = () => {
      terminateDirectChild(child);
      settle(reject, signal.reason);
    };
    const timeout = setTimeout(() => {
      terminateDirectChild(child);
      settle(
        reject,
        new Error(`${path.basename(command)} did not exit within ${launchTimeoutMs}ms.`),
      );
    }, launchTimeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    child.once('error', (error) => settle(reject, error));
    child.once('close', (code, signal) => {
      if (code !== 0) {
        settle(
          reject,
          new Error(
            `${path.basename(command)} exited before handoff with ${
              signal ? `signal ${signal}` : `code ${code}`
            }.`,
          ),
        );
        return;
      }
      settle(resolve, Math.round(performance.now() - startedAt));
    });
  });
}

async function waitForProcessExitMarker(markerPath, startedAt, signal) {
  const deadline = Date.now() + launchTimeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) throw signal.reason;
    if (fs.existsSync(markerPath)) {
      return Math.round(performance.now() - startedAt);
    }
    await delay(25);
  }
  throw new Error(`Relay did not finish cleanly within ${launchTimeoutMs}ms of the outer launch.`);
}

function resolveRuntimeReuse(scenario, activeBuildId, completeBefore) {
  if (scenario === 'portable' || !activeBuildId) return null;
  return completeBefore.has(activeBuildId);
}

function assertRuntimeReusePrecondition(scenario, activeBuildId, runtimeReused) {
  if (scenario === 'prepare' && runtimeReused) {
    throw new Error(
      `The prepare benchmark reused runtime ${activeBuildId}; use a fresh build ID or profile.`,
    );
  }
  if (scenario === 'stable' && runtimeReused !== true) {
    throw new Error('The stable benchmark did not reuse the active prepared runtime.');
  }
}

function resolveRuntimeExecutablePath(runtimeRoot, scenario, activeBuildId) {
  if (scenario === 'portable' || !activeBuildId) return null;
  return path.join(runtimeRoot, activeBuildId, 'Relay.exe');
}

async function runPackagedBenchmark(options) {
  if (process.platform !== 'win32') {
    throw new Error('Packaged Relay startup benchmarks must run on Windows.');
  }
  if (process.env.RELAY_BOOTSTRAP_BENCHMARK_CONFIRM !== '1') {
    throw new Error(
      'Set RELAY_BOOTSTRAP_BENCHMARK_CONFIRM=1 only on the intended Windows benchmark profile.',
    );
  }

  const localAppData = process.env.LOCALAPPDATA;
  const appData = process.env.APPDATA;
  if (!localAppData || !appData) {
    throw new Error('LOCALAPPDATA and APPDATA are required for a packaged Windows benchmark.');
  }

  const runtimeRoot = path.join(localAppData, 'Relay', 'Runtime');
  const statePath = path.join(localAppData, 'Relay', 'state.ini');
  const logPath = path.join(appData, 'Relay', 'logs', 'relay.log');
  const stableLauncher = path.join(localAppData, 'Relay', 'Relay.exe');
  const resolvedOptions = {
    ...options,
    artifact: options.artifact ? path.resolve(options.artifact) : undefined,
    launcher: options.launcher ? path.resolve(options.launcher) : undefined,
  };
  if (
    resolvedOptions.scenario === 'stable' &&
    resolvedOptions.launcher.toLowerCase() !== stableLauncher.toLowerCase()
  ) {
    throw new Error(`The stable scenario must use the installed launcher at ${stableLauncher}.`);
  }

  const launchSpec = buildLaunchSpec(resolvedOptions);
  if (!fs.existsSync(launchSpec.command)) {
    throw new Error(`Startup benchmark executable does not exist: ${launchSpec.command}`);
  }

  const completeBefore = listCompleteRuntimeBuilds(runtimeRoot);
  const baseline = readLogBaseline(logPath);
  const benchmarkRunId = crypto.randomUUID();
  const benchmarkIdentityArg = `--relay-benchmark-run-id=${benchmarkRunId}`;
  const exitMarkerPath = path.join(
    os.tmpdir(),
    'Relay',
    'startup-benchmark',
    `${benchmarkRunId}.complete`,
  );
  const pidMarkerPath = path.join(
    os.tmpdir(),
    'Relay',
    'startup-benchmark',
    `${benchmarkRunId}.pid`,
  );
  fs.rmSync(exitMarkerPath, { force: true });
  fs.rmSync(pidMarkerPath, { force: true });
  const startedAt = performance.now();
  const launchEnv = {
    ...process.env,
    RELAY_BENCHMARK_EXIT_AFTER_RENDER: '1',
    RELAY_BENCHMARK_RUN_ID: benchmarkRunId,
    RELAY_DISABLE_GPU_DIAGNOSTICS: '1',
    RELAY_DISABLE_CRASH_WATCHDOG: '1',
  };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  const controller = new AbortController();
  let benchmarkPid = null;

  try {
    const [processHandoffMs, observed, processExitMs, observedPid] = await Promise.all([
      waitForProcessHandoff(
        launchSpec.command,
        [...launchSpec.args, benchmarkIdentityArg],
        launchEnv,
        startedAt,
        controller.signal,
      ),
      waitForPackagedTimeline(logPath, baseline, startedAt, controller.signal),
      waitForProcessExitMarker(exitMarkerPath, startedAt, controller.signal),
      waitForBenchmarkPid(pidMarkerPath, controller.signal),
    ]);
    benchmarkPid = observedPid;
    const activeBuildId = readCurrentBuildId(statePath);
    const electronRendererMountedMs = observed.timeline['renderer-mounted'];
    const runtimeReused = resolveRuntimeReuse(
      resolvedOptions.scenario,
      activeBuildId,
      completeBefore,
    );
    assertRuntimeReusePrecondition(resolvedOptions.scenario, activeBuildId, runtimeReused);
    const runtimeExecutablePath = resolveRuntimeExecutablePath(
      runtimeRoot,
      resolvedOptions.scenario,
      activeBuildId,
    );
    const processQuiescenceMs = runtimeExecutablePath
      ? await waitForRuntimeProcessQuiescence(runtimeExecutablePath, launchEnv)
      : null;

    return {
      scenario: resolvedOptions.scenario,
      compression: resolvedOptions.compression,
      executable: launchSpec.command,
      executableSizeBytes: fs.statSync(launchSpec.command).size,
      processHandoffMs,
      processExitMs,
      processQuiescenceMs,
      benchmarkPid,
      preparationMs: resolvedOptions.scenario === 'prepare' ? processHandoffMs : null,
      outerProcessLifetimeMs: resolvedOptions.scenario === 'portable' ? processHandoffMs : null,
      rendererMountedWallMs: observed.rendererMountedWallMs,
      beforeElectronEntryMs: Math.max(
        0,
        observed.rendererMountedWallMs - electronRendererMountedMs,
      ),
      runtimeReused,
      activeBuildId,
      timeline: observed.timeline,
    };
  } catch (error) {
    controller.abort(error);
    benchmarkPid ??= readBenchmarkPid(pidMarkerPath);
    if (benchmarkPid) {
      terminateOwnedBenchmarkProcess({
        pid: benchmarkPid,
        runId: benchmarkRunId,
        exitMarkerPath,
        environment: launchEnv,
      });
    }
    throw error;
  } finally {
    fs.rmSync(exitMarkerPath, { force: true });
    fs.rmSync(pidMarkerPath, { force: true });
  }
}

function summarizePackagedSamples(options, samples) {
  if (samples.length === 1) return samples[0];

  return {
    scenario: options.scenario,
    compression: options.compression,
    runs: samples.length,
    runtimeReused:
      options.scenario === 'portable'
        ? null
        : samples.every((sample) => sample.runtimeReused === true),
    packagedMedian: {
      processHandoffMs: median(samples.map((sample) => sample.processHandoffMs)),
      processExitMs: median(samples.map((sample) => sample.processExitMs)),
      rendererMountedWallMs: median(samples.map((sample) => sample.rendererMountedWallMs)),
      beforeElectronEntryMs: median(samples.map((sample) => sample.beforeElectronEntryMs)),
      electronRendererMountedMs: median(
        samples.map((sample) => sample.timeline['renderer-mounted']),
      ),
    },
    samples,
  };
}

export async function runStartupBenchmark(argv = process.argv.slice(2)) {
  const options = parseStartupBenchmarkArgs(argv);
  let report;
  if (options.scenario === 'development') {
    report = await runDevelopmentBenchmark();
  } else {
    const samples = [];
    for (let index = 0; index < options.runs; index += 1) {
      samples.push(await runPackagedBenchmark(options));
    }
    report = summarizePackagedSamples(options, samples);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

const invokedUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedUrl) {
  try {
    await runStartupBenchmark();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
}
