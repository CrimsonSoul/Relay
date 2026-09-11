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

  it('encrypts OAuth credentials, preserves scope during replacements, and keeps public settings secret-free', () => {
    const store = new DynatraceProblemsConfigStore(dir, { isPackaged: true, secureStorage });
    const oauth = {
      clientId: 'dt0s02.client',
      clientSecret: 'private-oauth-secret',
      accountUuid: '12345678-1234-1234-1234-123456789012',
    };
    store.save({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'old-platform-token',
    });
    store.saveProblemScope({
      alertingProfiles: ['NOC'],
      customDqlMatcher: '',
      workflowId: 'workflow-test',
    });
    const prepared = store.prepare({ environmentUrl: 'https://abc123.live.dynatrace.com', oauth });
    expect(prepared).toMatchObject({
      oauth,
      apiToken: '',
      alertingProfiles: ['NOC'],
      workflowId: 'workflow-test',
    });
    expect(store.load()?.apiToken).toBe('old-platform-token');
    store.save({ environmentUrl: prepared.environmentUrl, oauth });
    const raw = readFileSync(join(dir, 'dynatrace-problems.json'), 'utf8');
    expect(raw).not.toContain(oauth.clientSecret);
    expect(raw).not.toContain(oauth.clientId);
    expect(JSON.parse(raw)).not.toHaveProperty('encryptedApiToken');
    expect(JSON.parse(raw)).toHaveProperty('encryptedOAuthCredentials');
    store.save({ environmentUrl: 'https://next.apps.dynatrace.com' });
    expect(store.load()).toMatchObject({
      oauth,
      alertingProfiles: ['NOC'],
      workflowId: 'workflow-test',
    });
    expect(JSON.stringify(store.getPublicSettings())).not.toMatch(
      /oauth|secret|clientId|accountUuid/i,
    );
    store.save({
      environmentUrl: 'https://next.apps.dynatrace.com',
      apiToken: 'replacement-platform-token',
    });
    expect(store.load()).not.toHaveProperty('oauth');
    expect(
      JSON.parse(readFileSync(join(dir, 'dynatrace-problems.json'), 'utf8')),
    ).not.toHaveProperty('encryptedOAuthCredentials');
  });

  it('refuses malformed or unencryptable OAuth replacements without overwriting the existing file', () => {
    const store = new DynatraceProblemsConfigStore(dir, { isPackaged: true, secureStorage });
    const environmentUrl = 'https://abc123.apps.dynatrace.com';
    const oauth = {
      clientId: 'dt0s02.client',
      clientSecret: 'private-oauth-secret',
      accountUuid: '12345678-1234-1234-1234-123456789012',
    };
    store.save({ environmentUrl, apiToken: 'existing-token' });
    const prior = readFileSync(join(dir, 'dynatrace-problems.json'), 'utf8');
    expect(() =>
      store.save({ environmentUrl, oauth: { ...oauth, accountUuid: 'invalid' } }),
    ).toThrow(/valid OAuth/);
    expect(() => store.save({ environmentUrl, oauth, apiToken: 'other-token' })).toThrow(/one/);
    const unavailable = new DynatraceProblemsConfigStore(dir, {
      isPackaged: true,
      secureStorage: null,
    });
    expect(() => unavailable.save({ environmentUrl, oauth })).toThrow(/Secure storage/);
    expect(readFileSync(join(dir, 'dynatrace-problems.json'), 'utf8')).toBe(prior);
  });

  it('remembers selected profiles across DQL saves and a fresh configuration load', () => {
    const options = { isPackaged: true, secureStorage };
    const store = new DynatraceProblemsConfigStore(dir, options);
    store.save({ environmentUrl: 'https://test.apps.dynatrace.com', apiToken: 'legacy-token' });
    store.saveProblemScope({ alertingProfiles: ['NOC', 'Network'], customDqlMatcher: '' });
    store.saveProblemScope({
      alertingProfiles: [],
      customDqlMatcher: 'true',
      workflowId: 'workflow-test',
      rememberedAlertingProfiles: ['NOC', 'Network'],
    });
    const reopened = new DynatraceProblemsConfigStore(dir, options);
    expect(reopened.load()).toMatchObject({
      alertingProfiles: null,
      rememberedAlertingProfiles: ['NOC', 'Network'],
      customDqlMatcher: 'true',
    });
    expect(reopened.getAdministrativeScope()).toMatchObject({
      rememberedAlertingProfiles: ['NOC', 'Network'],
    });
    reopened.saveProblemScope({ alertingProfiles: ['NOC', 'Network'], customDqlMatcher: '' });
    expect(new DynatraceProblemsConfigStore(dir, options).load()).toMatchObject({
      alertingProfiles: ['NOC', 'Network'],
      rememberedAlertingProfiles: ['NOC', 'Network'],
      customDqlMatcher: null,
    });
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
    const stored = JSON.parse(raw) as Record<string, unknown>;
    expect(stored).not.toHaveProperty('apiToken');
    expect(stored.encryptedApiToken).toBe(
      secureStorage.encryptString('dt0s16.platform-read-only-token').toString('base64'),
    );
    if (process.platform !== 'win32') {
      expect(statSync(join(dir, 'dynatrace-problems.json')).mode & 0o777).toBe(0o600);
    }
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
      rememberedAlertingProfiles: ['POS Store', 'Alerts for NOC'],
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
      rememberedAlertingProfiles: ['NOC Core'],
    });
    expect(store.getAdministrativeScope()).toEqual({
      alertingProfiles: [],
      customDqlMatcher: 'matchesValue(entity_tags, "teams:network")',
      rememberedAlertingProfiles: ['NOC Core'],
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

  it('persists the live workflow source only in protected settings and validates or clears its ID', () => {
    const store = new DynatraceProblemsConfigStore(dir, { isPackaged: true, secureStorage });
    store.save({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'dt0s16.platform-read-only-token',
    });
    store.saveProblemScope({
      alertingProfiles: [],
      customDqlMatcher: 'true',
      workflowId: 'workflow-1',
    });
    expect(store.getAdministrativeScope()).toMatchObject({
      workflowId: 'workflow-1',
      customDqlMatcher: 'true',
    });
    expect(store.getPublicSettings()).not.toHaveProperty('workflowId');
    expect(() =>
      store.saveProblemScope({
        alertingProfiles: [],
        customDqlMatcher: 'true',
        workflowId: 'https://another.example',
      }),
    ).toThrow(/workflow ID/);
    expect(store.load()?.workflowId).toBe('workflow-1');
    store.saveProblemScope({ alertingProfiles: ['NOC'], customDqlMatcher: '', workflowId: '' });
    expect(store.load()?.workflowId).toBeUndefined();
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
      rememberedAlertingProfiles: ['NOC Core'],
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
