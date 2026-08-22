import { describe, expect, it } from 'vitest';
import { emptyCloudStatusProviders } from '@shared/cloudStatus';
import type { CloudStatusData, CloudStatusItem, CloudStatusProvider } from '@shared/ipc';
import {
  DISPLAY_CLOUD_STATUS_PROVIDER_ORDER,
  aggregateCloudStatusForDisplay,
} from '../cloudStatusDisplay';

function item<P extends CloudStatusProvider>(
  provider: P,
  id: string,
  overrides: Partial<CloudStatusItem<P>> = {},
): CloudStatusItem<P> {
  return {
    id,
    provider,
    title: `${provider} incident`,
    description: `${provider} update`,
    pubDate: '2026-08-08T19:00:00.000Z',
    link: 'https://example.com/status',
    severity: 'warning',
    ...overrides,
  };
}

function data(overrides: Partial<CloudStatusData> = {}): CloudStatusData {
  return {
    providers: emptyCloudStatusProviders(),
    errors: [],
    lastUpdated: 100,
    ...overrides,
  };
}

describe('cloud status display aggregation', () => {
  it('deduplicates a Mist incident and unions affected regions in stable order', () => {
    const providers = emptyCloudStatusProviders();
    providers.mist_emea = [
      item('mist_emea', 'mist-1', {
        description: 'Initial regional impact.',
        severity: 'error',
        pubDate: '2026-08-08T18:00:00.000Z',
      }),
    ];
    providers.mist_apac = [
      item('mist_apac', 'mist-1', {
        description: 'Latest published update.',
        severity: 'warning',
        pubDate: '2026-08-08T19:00:00.000Z',
      }),
    ];

    const display = aggregateCloudStatusForDisplay(data({ providers }));

    expect(display.providers.mist).toEqual([
      {
        id: 'mist-1',
        provider: 'mist',
        title: 'mist_apac incident',
        description: 'Latest published update.',
        pubDate: '2026-08-08T19:00:00.000Z',
        link: 'https://example.com/status',
        severity: 'error',
        affectedScopes: ['EMEA', 'APAC'],
      },
    ]);
    expect(DISPLAY_CLOUD_STATUS_PROVIDER_ORDER).toEqual([
      'aws',
      'azure',
      'm365',
      'dropbox',
      'proofpoint',
      'crowdstrike',
      'jira',
      'github',
      'cloudflare',
      'mist',
      'dynatrace',
      'google',
      'anthropic',
      'openai',
      'salesforce',
    ]);
  });

  it('copies ordinary providers and folds regional errors into display-provider errors', () => {
    const providers = emptyCloudStatusProviders();
    providers.aws = [item('aws', 'aws-1')];
    providers.dropbox = [item('dropbox', 'dropbox-1')];
    providers.proofpoint = [
      item('proofpoint', 'proofpoint-1', { affectedScopes: ['Email Protection'] }),
    ];
    providers.crowdstrike = [item('crowdstrike', 'crowdstrike-1')];
    providers.dynatrace = [
      item('dynatrace', 'dynatrace-1', { affectedScopes: ['AWS · Americas'] }),
    ];

    const display = aggregateCloudStatusForDisplay(
      data({
        providers,
        errors: [
          { provider: 'azure', message: 'Azure unavailable' },
          { provider: 'mist_emea', message: 'Mist EMEA unavailable' },
          { provider: 'mist_apac', message: 'Mist APAC unavailable' },
          { provider: 'dynatrace', message: 'Dynatrace unavailable' },
        ],
      }),
    );

    expect(display.providers.aws).toEqual([
      expect.objectContaining({ id: 'aws-1', provider: 'aws', affectedScopes: [] }),
    ]);
    expect(display.providers.dropbox).toEqual([
      expect.objectContaining({ id: 'dropbox-1', provider: 'dropbox', affectedScopes: [] }),
    ]);
    expect(display.providers.proofpoint).toEqual([
      expect.objectContaining({
        id: 'proofpoint-1',
        provider: 'proofpoint',
        affectedScopes: ['Email Protection'],
      }),
    ]);
    expect(display.providers.crowdstrike).toEqual([
      expect.objectContaining({
        id: 'crowdstrike-1',
        provider: 'crowdstrike',
        affectedScopes: [],
      }),
    ]);
    expect(display.providers.dynatrace).toEqual([
      expect.objectContaining({
        id: 'dynatrace-1',
        provider: 'dynatrace',
        affectedScopes: ['AWS · Americas'],
      }),
    ]);
    expect(display.errors).toEqual([
      { provider: 'azure', message: 'Azure unavailable' },
      { provider: 'mist', message: 'Mist EMEA unavailable' },
      { provider: 'dynatrace', message: 'Dynatrace unavailable' },
    ]);
  });
});
