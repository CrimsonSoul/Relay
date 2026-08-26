import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  emptyExtensionCloudStatusProviders,
  emptyLegacyCloudStatusProviders,
  emptyMistCloudStatusProviders,
  mergeCloudStatusData,
  splitCloudStatusData,
  unavailableMistCloudStatusData,
} from './cloudStatus';
import type {
  CloudStatusData,
  CloudStatusItem,
  CloudStatusProvider,
  LegacyCloudStatusData,
} from './ipc';

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
    expect(Object.keys(emptyExtensionCloudStatusProviders())).toEqual([
      'dynatrace',
      'proofpoint',
      'crowdstrike',
      'dropbox',
      'equinix',
    ]);
    expectTypeOf<CloudStatusItem & { provider: 'mist_global' }>().not.toExtend<
      LegacyCloudStatusData['providers']['aws'][number]
    >();
    expectTypeOf<CloudStatusItem<'azure'>>().not.toExtend<
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

  it('round-trips incidents and errors through every snapshot partition', () => {
    const awsItem = item('aws', 'aws-1');
    const mistItem = item('mist_apac', 'mist-1');
    const combined: CloudStatusData = {
      providers: {
        ...emptyExtensionCloudStatusProviders(),
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
    expect(mergeCloudStatusData(split.legacy, split.mist, split.extension)).toEqual(combined);
  });

  it('keeps extension providers in a third partition without changing legacy or Mist records', () => {
    const dynatraceItem: CloudStatusItem<'dynatrace'> = {
      ...item('dynatrace', 'dynatrace-1'),
      affectedScopes: ['AWS · Americas'],
    };
    const combined: CloudStatusData = {
      providers: {
        ...emptyExtensionCloudStatusProviders(),
        ...emptyLegacyCloudStatusProviders(),
        ...emptyMistCloudStatusProviders(),
        dynatrace: [dynatraceItem],
        equinix: [item('equinix', 'equinix-1')],
      },
      errors: [
        { provider: 'dynatrace', message: 'Dynatrace unavailable' },
        { provider: 'equinix', message: 'Equinix unavailable' },
      ],
      lastUpdated: 30,
    };

    const split = splitCloudStatusData(combined);

    expect(Object.keys(split.legacy.providers)).toHaveLength(10);
    expect(Object.keys(split.mist.providers)).toHaveLength(4);
    expect(split.extension).toEqual({
      providers: {
        dynatrace: [dynatraceItem],
        proofpoint: [],
        crowdstrike: [],
        dropbox: [],
        equinix: [item('equinix', 'equinix-1')],
      },
      errors: [
        { provider: 'dynatrace', message: 'Dynatrace unavailable' },
        { provider: 'equinix', message: 'Equinix unavailable' },
      ],
      lastUpdated: 30,
    });
    expect(mergeCloudStatusData(split.legacy, split.mist, split.extension)).toEqual(combined);
  });

  it('drops an item whose provider identity does not match its snapshot bucket', () => {
    const malformed = {
      providers: {
        ...emptyExtensionCloudStatusProviders(),
        ...emptyLegacyCloudStatusProviders(),
        ...emptyMistCloudStatusProviders(),
        aws: [item('mist_global', 'misrouted')],
      },
      errors: [],
      lastUpdated: 20,
    } as unknown as CloudStatusData;

    expect(splitCloudStatusData(malformed).legacy.providers.aws).toEqual([]);
  });

  it('marks a newly added extension provider unknown when hydrating an older snapshot', () => {
    const legacy = { providers: emptyLegacyCloudStatusProviders(), errors: [], lastUpdated: 10 };
    const mist = { providers: emptyMistCloudStatusProviders(), errors: [], lastUpdated: 10 };
    const oldExtension = {
      providers: { dynatrace: [] },
      errors: [],
      lastUpdated: 10,
    } as unknown as Parameters<typeof mergeCloudStatusData>[2];

    const merged = mergeCloudStatusData(legacy, mist, oldExtension);

    expect(merged.providers.dynatrace).toEqual([]);
    expect(merged.providers.proofpoint).toEqual([]);
    expect(merged.providers.crowdstrike).toEqual([]);
    expect(merged.providers.dropbox).toEqual([]);
    expect(merged.providers.equinix).toEqual([]);
    expect(merged.errors).toContainEqual({
      provider: 'proofpoint',
      message: 'Proofpoint status is unavailable from this Relay server.',
    });
    expect(merged.errors).toContainEqual({
      provider: 'crowdstrike',
      message: 'CrowdStrike status is unavailable from this Relay server.',
    });
    expect(merged.errors).toContainEqual({
      provider: 'dropbox',
      message: 'Dropbox status is unavailable from this Relay server.',
    });
    expect(merged.errors).toContainEqual({
      provider: 'equinix',
      message: 'Equinix status is unavailable from this Relay server.',
    });
  });

  it('uses the newest partition timestamp when merging', () => {
    const merged = mergeCloudStatusData(
      { providers: emptyLegacyCloudStatusProviders(), errors: [], lastUpdated: 10 },
      { providers: emptyMistCloudStatusProviders(), errors: [], lastUpdated: 20 },
    );

    expect(merged.lastUpdated).toBe(20);
  });
});

function item<P extends CloudStatusProvider>(provider: P, id: string): CloudStatusItem<P> {
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
