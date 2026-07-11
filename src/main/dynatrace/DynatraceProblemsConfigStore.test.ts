import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DynatraceProblemsConfigStore } from './DynatraceProblemsConfigStore';

describe('DynatraceProblemsConfigStore', () => {
  let dir: string;
  const secureStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/, ''),
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'relay-dynatrace-problems-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('encrypts the platform token at rest and exposes only public settings', () => {
    const store = new DynatraceProblemsConfigStore(dir, {
      isPackaged: true,
      secureStorage,
    });
    store.save({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'dt0s16.platform-read-only-token',
    });

    const raw = readFileSync(join(dir, 'dynatrace-problems.json'), 'utf8');
    expect(raw).not.toContain('dt0s16.platform-read-only-token');
    expect(statSync(join(dir, 'dynatrace-problems.json')).mode & 0o777).toBe(0o600);
    expect(store.load()).toEqual({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'dt0s16.platform-read-only-token',
      alertingProfiles: null,
    });
    expect(store.getPublicSettings()).toEqual({
      configured: true,
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      profileFilterConfigured: false,
      selectedAlertingProfiles: [],
    });
  });

  it('normalizes a classic tenant origin to the platform tenant origin', () => {
    const store = new DynatraceProblemsConfigStore(dir, {
      isPackaged: true,
      secureStorage,
    });
    store.save({
      environmentUrl: 'https://abc123.live.dynatrace.com',
      apiToken: 'dt0s16.platform-read-only-token',
    });

    expect(store.load()).toEqual({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'dt0s16.platform-read-only-token',
      alertingProfiles: null,
    });
  });

  it('preserves the stored token when settings are saved with a blank token', () => {
    const store = new DynatraceProblemsConfigStore(dir, {
      isPackaged: true,
      secureStorage,
    });
    store.save({
      environmentUrl: 'https://first.apps.dynatrace.com',
      apiToken: 'dt0s16.existing-platform-token',
    });
    store.save({ environmentUrl: 'https://second.apps.dynatrace.com', apiToken: '' });

    expect(store.load()).toEqual({
      environmentUrl: 'https://second.apps.dynatrace.com',
      apiToken: 'dt0s16.existing-platform-token',
      alertingProfiles: null,
    });
  });

  it('persists a deduplicated alerting profile filter without exposing the token', () => {
    const store = new DynatraceProblemsConfigStore(dir, {
      isPackaged: true,
      secureStorage,
    });
    store.save({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'dt0s16.platform-read-only-token',
    });

    store.saveAlertingProfiles(['POS Store', ' Alerts for NOC ', 'POS Store']);

    expect(store.load()).toEqual({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'dt0s16.platform-read-only-token',
      alertingProfiles: ['POS Store', 'Alerts for NOC'],
    });
    expect(store.getPublicSettings()).toEqual({
      configured: true,
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      profileFilterConfigured: true,
      selectedAlertingProfiles: ['POS Store', 'Alerts for NOC'],
    });
    expect(readFileSync(join(dir, 'dynatrace-problems.json'), 'utf8')).not.toContain(
      'dt0s16.platform-read-only-token',
    );
  });

  it('refuses plaintext token storage in packaged Relay', () => {
    const store = new DynatraceProblemsConfigStore(dir, {
      isPackaged: true,
      secureStorage: null,
    });

    expect(() =>
      store.save({
        environmentUrl: 'https://abc123.apps.dynatrace.com',
        apiToken: 'dt0s16.platform-read-only-token',
      }),
    ).toThrow(/secure storage is unavailable/i);
  });

  it('clears the configuration without exposing the previous token', () => {
    const store = new DynatraceProblemsConfigStore(dir, {
      isPackaged: true,
      secureStorage,
    });
    store.save({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'dt0s16.platform-read-only-token',
    });

    expect(store.clear()).toBe(true);
    expect(store.load()).toBeNull();
    expect(store.getPublicSettings()).toEqual({
      configured: false,
      environmentUrl: '',
      profileFilterConfigured: false,
      selectedAlertingProfiles: [],
    });
  });
});
