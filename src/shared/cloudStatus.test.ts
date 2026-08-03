import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  emptyLegacyCloudStatusProviders,
  emptyMistCloudStatusProviders,
  mergeCloudStatusData,
  splitCloudStatusData,
  unavailableMistCloudStatusData,
} from './cloudStatus';
import type { CloudStatusData, CloudStatusItem, LegacyCloudStatusData } from './ipc';

describe('cloud status partitions', () => {
  it('keeps Mist outside the legacy snapshot partition', () => {
    expect(Object.keys(emptyLegacyCloudStatusProviders())).toEqual([
      'aws',
      'azure',
      'm365',
      'jira',
      'github',
      'cloudflare',
      'google',
      'anthropic',
      'openai',
      'salesforce',
    ]);
    expect(Object.keys(emptyMistCloudStatusProviders())).toEqual([
      'mist_global',
      'mist_emea',
      'mist_apac',
      'mist_federal',
    ]);
    expectTypeOf<CloudStatusItem & { provider: 'mist_global' }>().not.toExtend<
      LegacyCloudStatusData['providers']['aws'][number]
    >();
  });

  it('marks every Mist region unavailable without inventing incidents', () => {
    const unavailable = unavailableMistCloudStatusData(123);

    expect(unavailable.lastUpdated).toBe(123);
    expect(unavailable.errors).toEqual([
      {
        provider: 'mist_global',
        message: 'Juniper Mist status is unavailable from this Relay server.',
      },
      {
        provider: 'mist_emea',
        message: 'Juniper Mist status is unavailable from this Relay server.',
      },
      {
        provider: 'mist_apac',
        message: 'Juniper Mist status is unavailable from this Relay server.',
      },
      {
        provider: 'mist_federal',
        message: 'Juniper Mist status is unavailable from this Relay server.',
      },
    ]);
    expect(Object.values(unavailable.providers).flat()).toEqual([]);
  });

  it('round-trips incidents and errors through legacy and Mist partitions', () => {
    const awsItem = item('aws', 'aws-1');
    const mistItem = item('mist_apac', 'mist-1');
    const combined: CloudStatusData = {
      providers: {
        ...emptyLegacyCloudStatusProviders(),
        ...emptyMistCloudStatusProviders(),
        aws: [awsItem],
        mist_apac: [mistItem],
      },
      errors: [
        { provider: 'azure', message: 'Azure unavailable' },
        { provider: 'mist_emea', message: 'Mist EMEA unavailable' },
      ],
      lastUpdated: 20,
    };

    const split = splitCloudStatusData(combined);
    expect(split.legacy).toEqual({
      providers: { ...emptyLegacyCloudStatusProviders(), aws: [awsItem] },
      errors: [{ provider: 'azure', message: 'Azure unavailable' }],
      lastUpdated: 20,
    });
    expect(split.mist).toEqual({
      providers: { ...emptyMistCloudStatusProviders(), mist_apac: [mistItem] },
      errors: [{ provider: 'mist_emea', message: 'Mist EMEA unavailable' }],
      lastUpdated: 20,
    });
    expect(mergeCloudStatusData(split.legacy, split.mist)).toEqual(combined);
  });

  it('drops an item whose provider identity does not match its snapshot bucket', () => {
    const malformed = {
      providers: {
        ...emptyLegacyCloudStatusProviders(),
        ...emptyMistCloudStatusProviders(),
        aws: [item('mist_global', 'misrouted')],
      },
      errors: [],
      lastUpdated: 20,
    } as unknown as CloudStatusData;

    expect(splitCloudStatusData(malformed).legacy.providers.aws).toEqual([]);
  });

  it('uses the newest partition timestamp when merging', () => {
    const merged = mergeCloudStatusData(
      { providers: emptyLegacyCloudStatusProviders(), errors: [], lastUpdated: 10 },
      { providers: emptyMistCloudStatusProviders(), errors: [], lastUpdated: 20 },
    );

    expect(merged.lastUpdated).toBe(20);
  });
});

function item(provider: CloudStatusItem['provider'], id: string): CloudStatusItem {
  return {
    id,
    provider,
    title: `${provider} incident`,
    description: 'Status incident',
    pubDate: '2026-08-03T10:00:00.000Z',
    link: 'https://example.com/status',
    severity: 'error',
  };
}
