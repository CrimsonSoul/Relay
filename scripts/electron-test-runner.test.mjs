import { describe, expect, it, vi } from 'vitest';
import { runElectronTests } from './electron-test-runner.mjs';

const success = () => ({ status: 0, signal: null });
const failure = (status) => ({ status, signal: null });

const makeOptions = (spawnSync, overrides = {}) => ({
  electronVersion: '42.4.0',
  electronRebuildPath: '/relay/node_modules/@electron/rebuild/lib/cli.js',
  playwrightPath: '/relay/node_modules/@playwright/test/cli.js',
  npmExecPath: '/node/lib/node_modules/npm/bin/npm-cli.js',
  nodePath: '/node/bin/node',
  playwrightArgs: [],
  spawnSync,
  stdout: { write: vi.fn() },
  stderr: { write: vi.fn() },
  ...overrides,
});

const outputFrom = (writer) => writer.write.mock.calls.flat().join('');

describe('runElectronTests', () => {
  it('uses Node and the npm CLI path for restoration on Windows', () => {
    const spawnSync = vi.fn().mockReturnValue(success());
    const options = makeOptions(spawnSync, {
      nodePath: String.raw`C:\Program Files\nodejs\node.exe`,
      npmExecPath: String.raw`C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js`,
    });

    expect(runElectronTests(options)).toBe(0);
    expect(spawnSync).toHaveBeenNthCalledWith(
      3,
      options.nodePath,
      [options.npmExecPath, 'rebuild', 'better-sqlite3', '--build-from-source'],
      expect.any(Object),
    );
    expect(spawnSync.mock.calls.map(([command]) => command)).not.toContain('npm.cmd');
  });

  it('returns the Playwright exit code when restoration succeeds', () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce(success())
      .mockReturnValueOnce(failure(7))
      .mockReturnValueOnce(success());

    expect(runElectronTests(makeOptions(spawnSync))).toBe(7);
    expect(spawnSync).toHaveBeenCalledTimes(3);
  });

  it('returns the restoration exit code when Playwright succeeds', () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce(success())
      .mockReturnValueOnce(success())
      .mockReturnValueOnce(failure(9));

    expect(runElectronTests(makeOptions(spawnSync))).toBe(9);
  });

  it('reports both failures and preserves the Playwright exit code', () => {
    const restoreError = Object.assign(new Error('could not start npm CLI'), {
      code: 'ENOENT',
    });
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce(success())
      .mockReturnValueOnce(failure(7))
      .mockReturnValueOnce({ status: null, signal: null, error: restoreError });
    const options = makeOptions(spawnSync);

    expect(runElectronTests(options)).toBe(7);
    expect(outputFrom(options.stderr)).toContain('Playwright failed with exit code 7');
    expect(outputFrom(options.stderr)).toContain(
      'Node ABI restoration could not start: could not start npm CLI',
    );
  });

  it('attempts restoration after a Playwright spawn error', () => {
    const spawnError = Object.assign(new Error('could not spawn Playwright'), {
      code: 'ENOENT',
    });
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce(success())
      .mockReturnValueOnce({ status: null, signal: null, error: spawnError })
      .mockReturnValueOnce(success());
    const options = makeOptions(spawnSync);

    expect(runElectronTests(options)).toBe(1);
    expect(spawnSync).toHaveBeenCalledTimes(3);
    expect(outputFrom(options.stderr)).toContain(
      'Playwright could not start: could not spawn Playwright',
    );
  });

  it('attempts restoration after Playwright terminates from a signal', () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce(success())
      .mockReturnValueOnce({ status: null, signal: 'SIGTERM' })
      .mockReturnValueOnce(success());
    const options = makeOptions(spawnSync);

    expect(runElectronTests(options)).toBe(1);
    expect(spawnSync).toHaveBeenCalledTimes(3);
    expect(outputFrom(options.stderr)).toContain('Playwright terminated by signal SIGTERM');
  });

  it('restores the Node ABI and returns zero after successful Playwright execution', () => {
    const spawnSync = vi.fn().mockReturnValue(success());

    expect(runElectronTests(makeOptions(spawnSync))).toBe(0);
    expect(spawnSync).toHaveBeenCalledTimes(3);
  });

  it('runs Playwright with an explicitly selected configuration', () => {
    const spawnSync = vi.fn().mockReturnValue(success());
    const options = makeOptions(spawnSync, { playwrightConfigPath: 'playwright.web.config.ts' });

    expect(runElectronTests(options)).toBe(0);
    expect(spawnSync).toHaveBeenNthCalledWith(
      2,
      options.nodePath,
      [options.playwrightPath, 'test', '-c', 'playwright.web.config.ts'],
      expect.any(Object),
    );
  });
});
