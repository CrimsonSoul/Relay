import { describe, expect, it } from 'vitest';
import {
  renderBuildDefines,
  resolveBuildId,
  validateBuildId,
} from './windows-package-contract.mjs';

describe('Windows package contract', () => {
  it('accepts only bounded path-safe build identifiers', () => {
    expect(validateBuildId('r1-7e97e422')).toBe('r1-7e97e422');

    for (const value of [
      '',
      '../build',
      String.raw`C:\Relay`,
      'build id',
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
    expect(() => resolveBuildId({ env: {}, gitSha: 'not-a-sha' })).toThrow(
      /Git build identity/i,
    );
  });

  it('renders deterministic NSIS build defines', () => {
    expect(
      renderBuildDefines({
        buildId: 'r1-abc',
        launcherFile: 'RelayLauncher.exe',
      }),
    ).toBe(
      '!define RELAY_BUILD_ID "r1-abc"\n!define RELAY_LAUNCHER_FILE "RelayLauncher.exe"\n',
    );
  });

  it('rejects unsafe launcher filenames in generated NSIS input', () => {
    expect(() =>
      renderBuildDefines({ buildId: 'r1-abc', launcherFile: '../RelayLauncher.exe' }),
    ).toThrow(/launcher filename/i);
  });
});
