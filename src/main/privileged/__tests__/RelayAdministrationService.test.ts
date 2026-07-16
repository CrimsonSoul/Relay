import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RELAY_SETTINGS_MUTATION_INVENTORY,
  RelayAdministrationService,
  RelaySettingConflictError,
} from '../RelayAdministrationService';

describe('RelayAdministrationService', () => {
  const dynatrace = {
    getSettings: vi.fn(() => ({
      configured: true,
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      profileFilterConfigured: true,
      selectedAlertingProfiles: ['NOC Core'],
    })),
    saveSettings: vi.fn((input) => ({
      configured: true,
      environmentUrl: input.environmentUrl,
      profileFilterConfigured: true,
      selectedAlertingProfiles: ['NOC Core'],
    })),
    saveAlertingProfiles: vi.fn(async () => 4),
  };

  beforeEach(() => vi.clearAllMocks());

  function service() {
    return new RelayAdministrationService({ dynatrace });
  }

  it('classifies every current settings mutation and keeps path operations local', () => {
    expect(RELAY_SETTINGS_MUTATION_INVENTORY).toEqual([
      ['appearance.accent', 'ordinary-workstation'],
      ['appearance.accent-schedule', 'ordinary-workstation'],
      ['dynatrace.dashboard', 'ordinary-workstation'],
      ['operator.selection', 'ordinary-workstation'],
      ['dynatrace.environment-url', 'remote-nonsecret'],
      ['dynatrace.platform-token', 'remote-secret-replacement'],
      ['dynatrace.alerting-profiles', 'remote-nonsecret'],
      ['relay.connection', 'high-risk-local-only'],
      ['backup.create', 'high-risk-local-only'],
      ['backup.restore-path', 'high-risk-local-only'],
      ['filesystem.folder-picker', 'unsupported-remote'],
      ['filesystem.executable-picker', 'unsupported-remote'],
    ]);
  });

  it('returns redacted setting summaries without a secret value or path', () => {
    const summaries = service().getSettingSummaries();
    expect(summaries).toEqual([
      {
        setting: 'dynatrace.environment-url',
        configured: true,
        summary: 'Configured',
        valueSummary: 'https://abc123.apps.dynatrace.com',
        revision: 0,
      },
      {
        setting: 'dynatrace.platform-token',
        configured: true,
        summary: 'Configured',
        revision: 0,
      },
      {
        setting: 'dynatrace.alerting-profiles',
        configured: true,
        summary: 'Configured',
        valueSummary: ['NOC Core'],
        revision: 0,
      },
    ]);
    expect(JSON.stringify(summaries)).not.toMatch(/apiToken|dt0|path/i);
  });

  it('replaces the environment while preserving the existing token', async () => {
    await service().replace({
      setting: 'dynatrace.environment-url',
      value: { environmentUrl: 'https://next.apps.dynatrace.com' },
      expectedRevision: 0,
    });
    expect(dynatrace.saveSettings).toHaveBeenCalledWith({
      environmentUrl: 'https://next.apps.dynatrace.com',
    });
  });

  it('replaces a token without returning it and supports first-time environment input', async () => {
    const result = await service().replace({
      setting: 'dynatrace.platform-token',
      value: {
        apiToken: 'dt0s16.new-platform-token',
        environmentUrl: 'https://abc123.apps.dynatrace.com',
      },
      expectedRevision: 0,
      reauthRequestId: 'reauth-1',
    });
    expect(dynatrace.saveSettings).toHaveBeenCalledWith({
      environmentUrl: 'https://abc123.apps.dynatrace.com',
      apiToken: 'dt0s16.new-platform-token',
    });
    expect(JSON.stringify(result)).not.toContain('dt0s16.new-platform-token');
  });

  it('saves selected alerting profiles and rejects stale revisions', async () => {
    const current = service();
    await current.replace({
      setting: 'dynatrace.alerting-profiles',
      value: { profiles: ['NOC Core', 'Payments'] },
      expectedRevision: 0,
    });
    expect(dynatrace.saveAlertingProfiles).toHaveBeenCalledWith(['NOC Core', 'Payments']);

    await expect(
      current.replace({
        setting: 'dynatrace.alerting-profiles',
        value: { profiles: ['NOC Core'] },
        expectedRevision: 0,
      }),
    ).rejects.toEqual(new RelaySettingConflictError(1));
  });
});
