import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AppConfig, type RelayConfig } from './AppConfig';

describe('AppConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'relay-config-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns null when config.json does not exist', () => {
    const config = new AppConfig(tempDir);
    expect(config.load()).toBeNull();
  });

  it('writes and reads server config', () => {
    const config = new AppConfig(tempDir);
    const serverConfig: RelayConfig = {
      mode: 'server',
      port: 8090,
      secret: 'test-secret',
    };
    config.save(serverConfig);
    const loaded = config.load();
    expect(loaded).toEqual(serverConfig);
  });

  it('writes and reads client config', () => {
    const config = new AppConfig(tempDir);
    const clientConfig: RelayConfig = {
      mode: 'client',
      serverUrl: 'https://192.168.1.50:8090',
      secret: 'test-secret',
    };
    config.save(clientConfig);
    const loaded = config.load();
    expect(loaded).toEqual(clientConfig);
  });

  it('creates data directory if it does not exist', () => {
    const nestedDir = join(tempDir, 'nested', 'data');
    const config = new AppConfig(nestedDir);
    config.save({ mode: 'server', port: 8090, secret: 's' });
    expect(config.load()).not.toBeNull();
  });

  it('returns isConfigured() correctly', () => {
    const config = new AppConfig(tempDir);
    expect(config.isConfigured()).toBe(false);
    config.save({ mode: 'server', port: 8090, secret: 's' });
    expect(config.isConfigured()).toBe(true);
  });

  // --- New tests ---

  it('load returns null when config file is missing (explicit path check)', () => {
    const config = new AppConfig(join(tempDir, 'no-such-dir'));
    expect(config.load()).toBeNull();
  });

  it('load returns null for invalid JSON in config file', () => {
    writeFileSync(join(tempDir, 'config.json'), '{ not valid json }', 'utf-8');
    const config = new AppConfig(tempDir);
    expect(config.load()).toBeNull();
  });

  it('load returns null when config has no readable secret', () => {
    // StoredConfig with no secret and no encryptedSecret
    writeFileSync(
      join(tempDir, 'config.json'),
      JSON.stringify({ mode: 'server', port: 8090 }),
      'utf-8',
    );
    const config = new AppConfig(tempDir);
    expect(config.load()).toBeNull();
  });

  it('load uses plaintext secret when encryptedSecret absent', () => {
    writeFileSync(
      join(tempDir, 'config.json'),
      JSON.stringify({ mode: 'server', port: 9000, secret: 'plain-secret' }),
      'utf-8',
    );
    const config = new AppConfig(tempDir);
    const loaded = config.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.secret).toBe('plain-secret');
    expect((loaded as { port: number }).port).toBe(9000);
  });

  it('save stores secret in config file (plaintext fallback when safeStorage unavailable)', () => {
    // In the test environment electron is unavailable, so getSafeStorage() returns null
    // and the code falls back to storing the secret as plaintext.
    const config = new AppConfig(tempDir);
    config.save({ mode: 'server', port: 8090, secret: 'my-secret' });
    const loaded = config.load();
    expect(loaded?.secret).toBe('my-secret');

    // Verify that the stored file contains either 'secret' or 'encryptedSecret' key
    const raw = readFileSync(join(tempDir, 'config.json'), 'utf-8');
    const stored = JSON.parse(raw);
    const hasSecret = 'secret' in stored || 'encryptedSecret' in stored;
    expect(hasSecret).toBe(true);
  });

  it('mode switching: save server then overwrite with client', () => {
    const config = new AppConfig(tempDir);
    config.save({ mode: 'server', port: 8090, secret: 'sec' });
    config.save({ mode: 'client', serverUrl: 'https://10.0.0.1:8090', secret: 'sec2' });
    const loaded = config.load();
    expect(loaded?.mode).toBe('client');
    expect((loaded as { serverUrl: string }).serverUrl).toBe('https://10.0.0.1:8090');
    expect(loaded?.secret).toBe('sec2');
  });

  it('configPath is always config.json inside dataDir', () => {
    const config = new AppConfig(tempDir);
    config.save({ mode: 'server', port: 8090, secret: 's' });
    expect(existsSync(join(tempDir, 'config.json'))).toBe(true);
  });

  it('getDataDir returns the directory passed to constructor', () => {
    const config = new AppConfig(tempDir);
    expect(config.getDataDir()).toBe(tempDir);
  });

  it('server config uses default port 8090 when port is missing in stored file', () => {
    writeFileSync(
      join(tempDir, 'config.json'),
      JSON.stringify({ mode: 'server', secret: 'sec' }),
      'utf-8',
    );
    const config = new AppConfig(tempDir);
    const loaded = config.load();
    expect((loaded as { port: number }).port).toBe(8090);
  });

  it('client config uses empty string for serverUrl when missing in stored file', () => {
    writeFileSync(
      join(tempDir, 'config.json'),
      JSON.stringify({ mode: 'client', secret: 'sec' }),
      'utf-8',
    );
    const config = new AppConfig(tempDir);
    const loaded = config.load();
    expect((loaded as { serverUrl: string }).serverUrl).toBe('');
  });

  it('isConfigured returns false after load returns null for bad config', () => {
    writeFileSync(join(tempDir, 'config.json'), '!!!invalid!!!', 'utf-8');
    const config = new AppConfig(tempDir);
    expect(config.isConfigured()).toBe(false);
  });
});
