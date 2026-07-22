import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  renderBuildDefines,
  resolveHarnessConfig,
  resolveBuildId,
  validateBuildId,
} from './windows-package-contract.mjs';

describe('Windows package contract', () => {
  it('forwards release publish flags through the nested Windows package script', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

    expect(packageJson.scripts['build:win']).toMatch(/npm run package:win --$/);
    expect(packageJson.scripts.release).toBe('npm run build:win -- --publish always');
  });

  it('marks untracked non-ignored package inputs as dirty', () => {
    const source = readFileSync('scripts/package-windows.mjs', 'utf8');

    expect(source).toContain("'--untracked-files=normal'");
    expect(source).not.toContain("'--untracked-files=no'");
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

  it('makes dirty local builds unique without changing an explicit CI identity', () => {
    expect(resolveBuildId({ env: { RELAY_BUILD_ID: 'r1-ci' } })).toBe('r1-ci');
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
