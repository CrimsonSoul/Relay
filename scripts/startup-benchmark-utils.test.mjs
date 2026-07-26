import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as startupBenchmarkUtils from './startup-benchmark-utils.mjs';
import {
  buildLaunchSpec,
  extractLatestStartupTimeline,
  median,
  parseStartupBenchmarkArgs,
  sliceAppendedLogText,
} from './startup-benchmark-utils.mjs';

describe('startup benchmark utilities', () => {
  it('allows the benchmark module to be imported without an entry script argument', () => {
    const result = spawnSync(
      process.execPath,
      ['-e', "import('./scripts/benchmark-startup.mjs')"],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('waits for consecutive idle observations before declaring a process quiescent', async () => {
    expect(startupBenchmarkUtils.waitForProcessQuiescence).toBeTypeOf('function');

    const observations = [true, false, true, false, false];
    let probeCount = 0;
    const elapsedMs = await startupBenchmarkUtils.waitForProcessQuiescence?.(
      async () => {
        probeCount += 1;
        return observations.shift() ?? false;
      },
      {
        idleChecks: 2,
        pollIntervalMs: 0,
        timeoutMs: 100,
      },
    );

    expect(probeCount).toBe(5);
    expect(elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('calculates the median for odd and even samples without mutating input', () => {
    const samples = [900, 100, 500, 300];

    expect(median(samples)).toBe(400);
    expect(samples).toEqual([900, 100, 500, 300]);
    expect(median([9, 1, 5])).toBe(5);
  });

  it('rejects an empty benchmark sample', () => {
    expect(() => median([])).toThrow('at least one sample');
  });

  it('extracts the most recent complete Relay startup timeline', () => {
    const log = [
      '[INFO] Relay startup timing {"entry":0,"window-created":80,"renderer-mounted":400}',
      '[INFO] unrelated message',
      '[INFO] Relay startup timing {"entry":0,"window-created":40,"workspace-ready":210,"renderer-mounted":260}',
    ].join('\n');

    expect(extractLatestStartupTimeline(log)).toEqual({
      entry: 0,
      'window-created': 40,
      'workspace-ready': 210,
      'renderer-mounted': 260,
    });
  });

  it('ignores truncated or malformed startup summaries', () => {
    expect(
      extractLatestStartupTimeline(
        '[INFO] Relay startup timing {"entry":0\n[INFO] Relay startup timing not-json',
      ),
    ).toBeNull();
  });

  it('slices appended log data by bytes so Unicode history cannot shift the boundary', () => {
    const history = Buffer.from('Relay café\n', 'utf8');
    const appended = Buffer.concat([
      history,
      Buffer.from('[INFO] Relay startup timing {"renderer-mounted":42}\n', 'utf8'),
    ]);

    expect(sliceAppendedLogText(appended, history.length)).toContain('"renderer-mounted":42');
  });

  it('keeps the unpackaged benchmark explicit and never labels it as an update', () => {
    expect(parseStartupBenchmarkArgs([])).toEqual({
      scenario: 'development',
      compression: 'development',
      runs: 1,
    });
    expect(() => parseStartupBenchmarkArgs(['--scenario', 'prepare'])).toThrow(/artifact/i);
  });

  it('requires the stable launcher for a packaged stable launch', () => {
    expect(() => parseStartupBenchmarkArgs(['--scenario', 'stable'])).toThrow(/launcher/i);
  });

  it('parses packaged scenarios and compression labels', () => {
    expect(
      parseStartupBenchmarkArgs([
        '--scenario',
        'prepare',
        '--artifact',
        'release/Relay.exe',
        '--compression',
        'store',
        '--runs',
        '1',
      ]),
    ).toEqual({
      scenario: 'prepare',
      artifact: 'release/Relay.exe',
      compression: 'store',
      runs: 1,
    });
  });

  it('builds distinct preparation and stable launcher commands', () => {
    expect(buildLaunchSpec({ scenario: 'prepare', artifact: 'Relay.exe' })).toEqual({
      command: 'Relay.exe',
      args: [],
    });
    expect(buildLaunchSpec({ scenario: 'stable', launcher: 'InstalledRelay.exe' })).toEqual({
      command: 'InstalledRelay.exe',
      args: [],
    });
    expect(buildLaunchSpec({ scenario: 'portable', artifact: 'Relay-portable.exe' })).toEqual({
      command: 'Relay-portable.exe',
      args: [],
    });
  });

  it('supports repeated former-portable baseline samples', () => {
    expect(
      parseStartupBenchmarkArgs([
        '--scenario',
        'portable',
        '--artifact',
        'Relay-portable.exe',
        '--runs',
        '5',
      ]),
    ).toEqual({
      scenario: 'portable',
      artifact: 'Relay-portable.exe',
      compression: 'unspecified',
      runs: 5,
    });
  });

  it('rejects unknown flags, missing values, and unsupported scenarios', () => {
    expect(() => parseStartupBenchmarkArgs(['--unknown'])).toThrow(/unknown/i);
    expect(() => parseStartupBenchmarkArgs(['--artifact'])).toThrow(/value/i);
    expect(() => parseStartupBenchmarkArgs(['--scenario', 'update'])).toThrow(/scenario/i);
    expect(() => parseStartupBenchmarkArgs(['--runs', '0'])).toThrow(/runs/i);
    expect(() =>
      parseStartupBenchmarkArgs([
        '--scenario',
        'prepare',
        '--artifact',
        'Relay.exe',
        '--runs',
        '2',
      ]),
    ).toThrow(/prepare.*runs 1/i);
  });

  it('measures packaged launches through the real executable and exits after the milestone', () => {
    const source = readFileSync('scripts/benchmark-startup.mjs', 'utf8');

    expect(source).toContain('buildLaunchSpec(resolvedOptions)');
    expect(source).toContain('RELAY_BENCHMARK_EXIT_AFTER_RENDER');
    expect(source).toContain('RELAY_BENCHMARK_RUN_ID');
    expect(source).toContain("RELAY_DISABLE_CRASH_WATCHDOG: '1'");
    expect(source).toContain('processHandoffMs');
    expect(source).toContain('processExitMs');
    expect(source).toContain('waitForBenchmarkPid');
    expect(source).toContain('terminateOwnedBenchmarkProcess({');
    expect(source).toContain('Get-CimInstance Win32_Process');
    expect(source).toContain('$null = $process.Handle');
    expect(source).toContain('$rootProcess = Open-MatchingProcessHandle');
    expect(source).toContain('$pinnedTargets = @(');
    expect(source).toContain('$actualTicks = $actualTicks - ($actualTicks % 10)');
    expect(source).not.toContain('-gt 1000');
    expect(source).toContain('fs.existsSync(exitMarkerPath)');
    expect(source).toContain('`--relay-benchmark-run-id=${benchmarkRunId}`');
    expect(source).not.toContain("['/IM', 'Relay.exe'");
    expect(source).not.toContain("['/PID', String(pid)");
    expect(source).toContain('launchTimeoutMs');
    expect(source).toContain("resolvedOptions.scenario === 'prepare'");
    expect(source).toContain('outerProcessLifetimeMs');
    expect(source).toContain('Promise.all([');
    expect(source).toContain(
      'waitForPackagedTimeline(logPath, baseline, startedAt, controller.signal)',
    );
    expect(source).toContain("scenario === 'prepare' && runtimeReused");
    expect(source).toContain('packagedMedian');
    expect(source).not.toContain('postUpdate');
  });

  it('waits for the Windows runtime process tree to settle between packaged samples', () => {
    const source = readFileSync('scripts/benchmark-startup.mjs', 'utf8');

    expect(source).toContain('waitForRuntimeProcessQuiescence');
    expect(source).toContain('RELAY_BENCHMARK_RUNTIME_EXECUTABLE');
    expect(source).toContain('processQuiescenceMs');
    expect(source).toContain('Get-CimInstance Win32_Process');
  });
});
