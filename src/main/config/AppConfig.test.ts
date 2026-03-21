import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
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
});
