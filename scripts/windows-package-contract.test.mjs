import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  renderBuildDefines,
  resolveHarnessConfig,
  resolveBuildId,
  validateBuildId,
} from './windows-package-contract.mjs';
import {
  FIXTURE_RUNTIME_INTEGRITY_FILES,
  resolveElectronBuilderArgs,
  resolveHostNativeDependencyRestore,
  resolveMakensisCommand,
  resolveNpmInvocation,
  resolvePackageMode,
  resolveWindowsNativeDependencyInstall,
} from './package-windows.mjs';

describe('Windows package contract', () => {
  it('forwards release publish flags through the nested Windows package script', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

    expect(packageJson.scripts['build:win']).toMatch(/npm run package:win --$/);
    expect(packageJson.scripts).not.toHaveProperty('release');
    expect(resolveElectronBuilderArgs([])).toEqual(['--publish', 'never']);
    expect(resolveElectronBuilderArgs(['--publish', 'always'])).toEqual(['--publish', 'always']);
    expect(resolveElectronBuilderArgs(['--publish=always'])).toEqual(['--publish=always']);
  });

  it('injects only a canonical automated release version into packaged application metadata', () => {
    expect(resolveElectronBuilderArgs([], { RELAY_RELEASE_VERSION: '' })).toEqual([
      '--publish',
      'never',
    ]);
    expect(resolveElectronBuilderArgs([], { RELAY_RELEASE_VERSION: '2.3.4' })).toEqual([
      '--publish',
      'never',
      '--config.extraMetadata.version=2.3.4',
    ]);
    expect(() => resolveElectronBuilderArgs([], { RELAY_RELEASE_VERSION: '2.3.4-beta.1' })).toThrow(
      /release version/i,
    );
    expect(() =>
      resolveElectronBuilderArgs(['--config.extraMetadata.version=9.9.9'], {
        RELAY_RELEASE_VERSION: '2.3.4',
      }),
    ).toThrow(/release version/i);
  });

  it('keeps lightweight fixture flags away from electron-builder', () => {
    expect(resolvePackageMode(['--fixture', '--config.compression=store'])).toEqual({
      compileOnly: false,
      fixture: true,
    });
    expect(resolveElectronBuilderArgs(['--fixture', '--config.compression=store'])).toEqual([
      '--config.compression=store',
      '--publish',
      'never',
    ]);
    expect(() => resolvePackageMode(['--fixture', '--compile-launcher-only'])).toThrow(
      /cannot be combined/i,
    );
  });

  it('stages the Windows Koffi binary before cross-platform packaging', () => {
    expect(resolveWindowsNativeDependencyInstall('3.1.6', 'darwin')).toEqual([
      'install',
      '--no-save',
      '--ignore-scripts',
      '--force',
      '@koromix/koffi-win32-x64@3.1.6',
    ]);
    expect(resolveWindowsNativeDependencyInstall('3.1.6', 'win32')).toEqual([
      'install',
      '--no-save',
      '--ignore-scripts',
      '@koromix/koffi-win32-x64@3.1.6',
    ]);
    expect(() => resolveWindowsNativeDependencyInstall('latest', 'darwin')).toThrow(
      /Koffi version/i,
    );
  });

  it('runs the bundled npm CLI when a direct Windows invocation has no npm_execpath', () => {
    const nodePath = String.raw`C:\hostedtoolcache\windows\node\22.23.0\x64\node.exe`;

    expect(
      resolveNpmInvocation({
        nodePath,
        npmExecPath: undefined,
        platform: 'win32',
      }),
    ).toEqual({
      argsPrefix: [
        String.raw`C:\hostedtoolcache\windows\node\22.23.0\x64\node_modules\npm\bin\npm-cli.js`,
      ],
      command: nodePath,
    });
  });

  it('restores host native dependencies after Windows packaging', () => {
    expect(resolveHostNativeDependencyRestore()).toEqual([
      'rebuild',
      'better-sqlite3',
      '--build-from-source',
    ]);

    const source = readFileSync('scripts/package-windows.mjs', 'utf8');
    expect(source).toContain('finally {');
    expect(source).toContain('await restoreHostNativeDependencies()');
  });

  it('marks untracked non-ignored package inputs as dirty', () => {
    const source = readFileSync('scripts/package-windows.mjs', 'utf8');

    expect(source).toContain("'--untracked-files=normal'");
    expect(source).not.toContain("'--untracked-files=no'");
  });

  it('embeds the runtime build identity inside each packaged app payload', () => {
    const source = readFileSync('scripts/package-windows.mjs', 'utf8');
    const config = readFileSync('electron-builder.yml', 'utf8');

    expect(source).toContain("'relay-build-id.txt'");
    expect(source).toContain("await writeFile(buildIdentityPath, `${buildId}\\n`, 'utf8')");
    expect(config).toContain("from: 'release/windows-bootstrap/relay-build-id.txt'");
    expect(config).toContain("to: 'relay-build-id.txt'");
  });

  it('builds lightweight harness payloads that preserve the launcher benchmark contract', () => {
    const source = readFileSync('scripts/package-windows.mjs', 'utf8');
    const fixture = readFileSync('build/windows/relay-ci-fixture.nsi', 'utf8');

    expect(source).toContain('compileFixtureRuntime');
    expect(source).toContain("'--prepackaged'");
    expect(source).toContain("'relay-fixture-app'");
    expect(fixture).toContain('RequestExecutionLevel user');
    expect(fixture).toContain('SilentInstall silent');
    expect(fixture).toContain('RELAY_BENCHMARK_RUN_ID');
    expect(fixture).toContain('Relay\\startup-benchmark');
    expect(fixture).toContain('.complete');
    expect(source).toContain('`-DRELAY_FIXTURE_BUILD_ID=${buildId}`');
    expect(source).toContain('`-DRELAY_FIXTURE_PROBATION_DURATION_MS=${probationDurationMs}`');
    expect(source).toContain('`-DRELAY_FIXTURE_ROOT=${harness.root}`');
    expect(fixture).toContain('RELAY_FIXTURE_BUILD_ID');
    expect(fixture).toContain('RELAY_FIXTURE_PROBATION_DURATION_MS');
    expect(fixture).toContain('RELAY_FIXTURE_ROOT');
    expect(fixture).toContain('--relay-recovery-probation=');
    expect(fixture).toContain('probation-result.ini');
    const probationReceiptIndex = fixture.indexOf('"durationMs"');
    const probationExitIndex = fixture.indexOf('SetErrorLevel 0', probationReceiptIndex);
    const benchmarkIndex = fixture.indexOf('RELAY_BENCHMARK_RUN_ID');
    expect(probationReceiptIndex).toBeGreaterThan(-1);
    expect(probationExitIndex).toBeGreaterThan(probationReceiptIndex);
    expect(probationExitIndex).toBeLessThan(benchmarkIndex);
    expect(fixture.slice(probationExitIndex, benchmarkIndex)).toContain('Quit');
  });

  it('keeps fixture payloads in parity with every non-executable runtime integrity file', () => {
    const contract = readFileSync('build/windows/include/relay-runtime-contract.nsh', 'utf8');
    const expectedPaths = [
      'd3dcompiler_47.dll',
      'dxcompiler.dll',
      'dxil.dll',
      'ffmpeg.dll',
      'libEGL.dll',
      'libGLESv2.dll',
      'vk_swiftshader.dll',
      'vulkan-1.dll',
      'resources/app.asar',
      'resources/pocketbase/win32-x64/pocketbase.exe',
      'resources/pocketbase/hooks/relay_privileged_reauth.pb.js',
      'resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
      'resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node',
    ];

    expect(FIXTURE_RUNTIME_INTEGRITY_FILES.map(([path]) => path)).toEqual(expectedPaths);
    expect(FIXTURE_RUNTIME_INTEGRITY_FILES.find(([path]) => path.endsWith('.pb.js'))?.[1]).toMatch(
      /^\/\//u,
    );
    for (const path of expectedPaths) {
      expect(contract).toContain(path.replaceAll('/', '\\'));
    }
  });

  it('runs the bundled NSIS executable directly instead of spawning its Windows cmd wrapper', () => {
    expect(
      resolveMakensisCommand(
        { path: '/cache/nsis/makensis.cmd' },
        {
          platform: 'win32',
          dirname: (value) => value.slice(0, value.lastIndexOf('/')),
          join: (...parts) => parts.join('/'),
        },
      ),
    ).toEqual({
      path: '/cache/nsis/windows/makensis.exe',
      env: { NSISDIR: '/cache/nsis/windows' },
    });
    expect(
      resolveMakensisCommand(
        { path: '/cache/nsis/makensis', env: { NSISDIR: '/cache/nsis' } },
        { platform: 'darwin', dirname: () => '', join: (...parts) => parts.join('/') },
      ),
    ).toEqual({ path: '/cache/nsis/makensis', env: { NSISDIR: '/cache/nsis' } });
  });

  it('derives launcher supervision and application probation from one timing contract', () => {
    const timing = JSON.parse(readFileSync('build/windows/recovery-timing.json', 'utf8'));
    const packageSource = readFileSync('scripts/package-windows.mjs', 'utf8');
    const mainSource = readFileSync('src/main/index.ts', 'utf8');

    expect(timing).toEqual({
      startupDeadlineMs: 120_000,
      probationDurationMs: 60_000,
      shutdownOverheadMs: 15_000,
      supervisorTimeoutMs: 195_000,
    });
    expect(packageSource).toContain('RELAY_PROBATION_DURATION_MS');
    expect(packageSource).toContain('RELAY_PROBATION_SUPERVISOR_TIMEOUT_MS');
    expect(mainSource).toContain('recoveryTiming.probationDurationMs');
    expect(mainSource).toContain('recoveryTiming.startupDeadlineMs');
  });

  it('accepts only bounded path-safe build identifiers', () => {
    expect(validateBuildId('r1-7e97e422')).toBe('r1-7e97e422');

    for (const value of [
      '',
      '../build',
      String.raw`C:\Relay`,
      'build id',
      'R1-uppercase',
      'r1-trailing.',
      'con',
      'com1.log',
      `r1-${'a'.repeat(64)}`,
    ]) {
      expect(() => validateBuildId(value)).toThrow(/build id/i);
    }
  });

  it('makes every dirty build unique, including an explicit identity', () => {
    expect(resolveBuildId({ env: { RELAY_BUILD_ID: 'r1-ci' } })).toBe('r1-ci');
    expect(
      resolveBuildId({
        env: { RELAY_BUILD_ID: 'r1-ci' },
        dirty: true,
        nonce: 'abc123',
      }),
    ).toBe('r1-ci-dirty-abc123');
    expect(
      resolveBuildId({
        env: {},
        gitSha: '7e97e422abcd',
        dirty: true,
        nonce: 'abc123',
      }),
    ).toBe('r1-7e97e422abcd-dirty-abc123');
  });

  it('uses a clean commit identity when CI does not provide an override', () => {
    expect(
      resolveBuildId({
        env: {},
        gitSha: '7e97e422abcdef01234567890',
        dirty: false,
      }),
    ).toBe('r1-7e97e422abcdef01');
  });

  it('rejects a missing or malformed Git identity', () => {
    expect(() => resolveBuildId({ env: {} })).toThrow(/Git build identity/i);
    expect(() => resolveBuildId({ env: {}, gitSha: 'not-a-sha' })).toThrow(/Git build identity/i);
  });

  it('renders deterministic NSIS build defines', () => {
    expect(
      renderBuildDefines({
        buildId: 'r1-abc',
        launcherFile: 'RelayLauncher.exe',
        version: '1.7.0',
        targetCommitish: '1'.repeat(40),
        packagedAt: '2026-08-24T15:00:00.000Z',
      }),
    ).toBe(
      [
        '!define RELAY_BUILD_ID "r1-abc"',
        '!define RELAY_LAUNCHER_FILE "RelayLauncher.exe"',
        '!define RELAY_BUILD_VERSION "1.7.0"',
        `!define RELAY_TARGET_COMMITISH "${'1'.repeat(40)}"`,
        '!define RELAY_PACKAGED_AT "2026-08-24T15:00:00.000Z"',
        '!define RELAY_RECOVERY_PROTOCOL "2"',
        '!define RELAY_SERVER_DATA_EPOCH "1"',
        '!define RELAY_CLIENT_DATA_EPOCH "1"',
        '',
      ].join('\n'),
    );
  });

  it('rejects build metadata that cannot safely enter launcher receipts', () => {
    const valid = {
      buildId: 'r1-abc',
      launcherFile: 'RelayLauncher.exe',
      version: '1.7.0',
      targetCommitish: '1'.repeat(40),
      packagedAt: '2026-08-24T15:00:00.000Z',
    };

    expect(() => renderBuildDefines({ ...valid, version: '1.7.0-beta.1' })).toThrow(/version/i);
    expect(() => renderBuildDefines({ ...valid, targetCommitish: 'main' })).toThrow(/commit/i);
  });

  it('rejects unsafe launcher filenames in generated NSIS input', () => {
    expect(() =>
      renderBuildDefines({
        buildId: 'r1-abc',
        launcherFile: '../RelayLauncher.exe',
        version: '1.7.0',
        targetCommitish: '1'.repeat(40),
        packagedAt: '2026-08-24T15:00:00.000Z',
      }),
    ).toThrow(/launcher filename/i);
  });

  it('keeps alternate roots behind an explicit compile-time harness contract', () => {
    expect(resolveHarnessConfig({})).toBeNull();
    expect(() =>
      resolveHarnessConfig({ RELAY_BOOTSTRAP_HARNESS_ROOT: String.raw`C:\relay-test` }),
    ).toThrow(/harness/i);
    expect(
      resolveHarnessConfig({
        RELAY_BOOTSTRAP_HARNESS: '1',
        RELAY_BOOTSTRAP_HARNESS_ROOT: String.raw`C:\runner temp\relay-test`,
      }),
    ).toEqual({ root: String.raw`C:\runner temp\relay-test` });
    expect(() =>
      resolveHarnessConfig({
        RELAY_BOOTSTRAP_HARNESS: '1',
        RELAY_BOOTSTRAP_HARNESS_ROOT: String.raw`C:\runner\..\escape`,
      }),
    ).toThrow(/root/i);
    for (const root of [
      'C:\\',
      'C:\\relay\\trailing\\',
      String.raw`C:\relay\path" !define PWNED`,
      String.raw`C:\relay\path$INSTDIR`,
      'C:\\relay\\path\n!define PWNED',
      `C:\\relay\\control-${String.fromCharCode(1)}`,
      String.raw`C:\relay\trailing.`,
      String.raw`C:\relay\trailing `,
    ]) {
      expect(() =>
        resolveHarnessConfig({
          RELAY_BOOTSTRAP_HARNESS: '1',
          RELAY_BOOTSTRAP_HARNESS_ROOT: root,
        }),
      ).toThrow(/root/i);
    }
  });

  it('renders harness-only NSIS defines only when explicitly requested', () => {
    expect(
      renderBuildDefines({
        buildId: 'h1-abc',
        launcherFile: 'RelayLauncher.exe',
        version: '1.7.0',
        targetCommitish: '1'.repeat(40),
        packagedAt: '2026-08-24T15:00:00.000Z',
        harnessRoot: String.raw`C:\runner temp\relay-boundary`,
      }),
    ).toContain('!define RELAY_BOOTSTRAP_HARNESS_ROOT "C:\\runner temp\\relay-boundary"');
  });
});
