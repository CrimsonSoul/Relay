import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
      customDqlMatcher: null,
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
      customDqlMatcher: null,
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
      customDqlMatcher: null,
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
      customDqlMatcher: null,
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

  it('keeps custom DQL exclusive when a legacy scope contains profiles too', () => {
    const store = new DynatraceProblemsConfigStore(dir, {
      isPackaged: true,
      secureStorage,
    });
    store.save({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'dt0s16.platform-read-only-token',
    });

    store.saveProblemScope({
      alertingProfiles: ['NOC Core'],
      customDqlMatcher: '  matchesValue(entity_tags, "teams:network")  ',
    });

    expect(store.load()).toEqual({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'dt0s16.platform-read-only-token',
      alertingProfiles: null,
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    });
    expect(store.getAdministrativeScope()).toEqual({
      alertingProfiles: [],
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    });
  });

  it('loads a legacy combined configuration as custom-DQL-only scope', () => {
    writeFileSync(
      join(dir, 'dynatrace-problems.json'),
      JSON.stringify({
        environmentUrl: 'https://abc123.apps.dynatrace.com',
        encryptedApiToken: Buffer.from('encrypted:dt0s16.platform-read-only-token').toString(
          'base64',
        ),
        alertingProfiles: ['NOC Core'],
        customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
      }),
    );
    const store = new DynatraceProblemsConfigStore(dir, {
      isPackaged: true,
      secureStorage,
    });

    expect(store.load()).toMatchObject({
      alertingProfiles: null,
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    });
  });

  it('allows both scope mechanisms to be cleared and rejects unsafe matcher content', () => {
    const store = new DynatraceProblemsConfigStore(dir, {
      isPackaged: true,
      secureStorage,
    });
    store.save({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'dt0s16.platform-read-only-token',
    });
    store.saveProblemScope({
      alertingProfiles: ['NOC Core'],
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
    });

    store.saveProblemScope({ alertingProfiles: [], customDqlMatcher: '' });

    expect(store.getAdministrativeScope()).toEqual({
      alertingProfiles: [],
      customDqlMatcher: '',
    });
    expect(store.load()).toMatchObject({ alertingProfiles: null, customDqlMatcher: null });
    expect(() =>
      store.saveProblemScope({
        alertingProfiles: [],
        customDqlMatcher: 'matchesValue(event.name, "*") | limit 1',
      }),
    ).toThrow(/matcher expression/i);
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
