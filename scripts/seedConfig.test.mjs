import { describe, expect, it, vi } from 'vitest';
import { parseSeedInvocation } from './seedConfig.mjs';
import { createSeedCredentials } from './seedCredentials.mjs';

const isolation = { temporaryRoot: '/seed-test-root', resolveDirectory: (path) => path };
const env = {
  RELAY_SEED_PB_URL: 'http://127.0.0.1:41122',
  RELAY_SEED_PB_DATA_DIR: '/seed-test-root/relay-fixture/pb_data',
};
describe('seed authority', () => {
  it('rejects implicit destructive modes, unknown flags, and conflicting modes before resolving a target', () => {
    for (const args of [
      [],
      ['--ful'],
      ['--full'],
      ['--full', '--dynatrace-only'],
      ['--help', '--full'],
    ]) {
      const resolveDirectory = vi.fn();
      expect(() => parseSeedInvocation(args, {}, { ...isolation, resolveDirectory })).toThrow();
      expect(resolveDirectory).not.toHaveBeenCalled();
    }
  });
  it('help has no filesystem or server prerequisites', () => {
    const resolveDirectory = vi.fn();
    expect(parseSeedInvocation(['--help'], {}, { ...isolation, resolveDirectory })).toEqual({
      mode: 'help',
    });
    expect(resolveDirectory).not.toHaveBeenCalled();
  });
  it('requires an explicit temporary local database for a full seed', () => {
    expect(parseSeedInvocation(['--full', '--disposable'], env, isolation)).toEqual({
      mode: 'full',
      baseUrl: env.RELAY_SEED_PB_URL,
      dataDir: env.RELAY_SEED_PB_DATA_DIR,
    });
    for (const overrides of [
      { RELAY_SEED_PB_URL: 'https://example.com' },
      { RELAY_SEED_PB_DATA_DIR: '/Users/user/Library/Application Support/Relay/data/pb_data' },
      { RELAY_SEED_PB_DATA_DIR: '/seed-test-root-unsafe/pb_data' },
    ]) {
      expect(() =>
        parseSeedInvocation(['--full', '--disposable'], { ...env, ...overrides }, isolation),
      ).toThrow();
    }
  });
  it('preserves explicit scoped Dynatrace modes', () => {
    expect(parseSeedInvocation(['--dynatrace-only'], {}, isolation)).toEqual({
      mode: 'dynatrace-only',
      baseUrl: 'http://localhost:8090',
    });
    expect(parseSeedInvocation(['--clear-dynatrace'], env, isolation).mode).toBe('clear-dynatrace');
  });
  it('owns a unique create-only principal before authentication and deletes it without an auth token', () => {
    const run = vi.fn();
    const first = createSeedCredentials({
      binaryPath: 'pocketbase',
      dataDir: '/seed-test-root/fixture',
      run,
    });
    const second = createSeedCredentials({
      binaryPath: 'pocketbase',
      dataDir: '/seed-test-root/fixture',
      run,
    });
    expect(first.identity).not.toBe(second.identity);
    expect(run.mock.calls[0][1]).toEqual([
      'superuser',
      'create',
      first.identity,
      first.password,
      '--dir=/seed-test-root/fixture',
    ]);
    first.cleanup();
    first.cleanup();
    expect(run.mock.calls[2][1]).toEqual([
      'superuser',
      'delete',
      first.identity,
      '--dir=/seed-test-root/fixture',
    ]);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('surfaces cleanup failure without printing credentials and supports a retry', () => {
    const run = vi.fn();
    const credentials = createSeedCredentials({
      binaryPath: 'pocketbase',
      dataDir: '/seed-test-root/fixture',
      run,
    });
    run.mockImplementationOnce(() => {
      throw new Error(credentials.password);
    });
    expect(() => credentials.cleanup()).toThrow('Temporary seed superuser cleanup failed');
    expect(() => credentials.cleanup()).not.toThrow();
  });
});
