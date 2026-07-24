import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  renderBuildDefines,
  resolveHarnessConfig,
  resolveBuildId,
  validateBuildId,
} from './windows-package-contract.mjs';
import {
  resolveElectronBuilderArgs,
  resolveMakensisCommand,
  resolvePackageMode,
} from './package-windows.mjs';

describe('Windows package contract', () => {
  it('forwards release publish flags through the nested Windows package script', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

    expect(packageJson.scripts['build:win']).toMatch(/npm run package:win --$/);
    expect(packageJson.scripts.release).toBe('npm run build:win -- --publish always');
    expect(resolveElectronBuilderArgs([])).toEqual(['--publish', 'never']);
    expect(resolveElectronBuilderArgs(['--publish', 'always'])).toEqual(['--publish', 'always']);
    expect(resolveElectronBuilderArgs(['--publish=always'])).toEqual(['--publish=always']);
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
      }),
    ).toBe('!define RELAY_BUILD_ID "r1-abc"\n!define RELAY_LAUNCHER_FILE "RelayLauncher.exe"\n');
  });

  it('rejects unsafe launcher filenames in generated NSIS input', () => {
    expect(() =>
      renderBuildDefines({ buildId: 'r1-abc', launcherFile: '../RelayLauncher.exe' }),
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
        harnessRoot: String.raw`C:\runner temp\relay-boundary`,
      }),
    ).toContain('!define RELAY_BOOTSTRAP_HARNESS_ROOT "C:\\runner temp\\relay-boundary"');
  });
});
