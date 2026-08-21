import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import type { CloudStatusData, CloudStatusItem } from '@shared/ipc';
import {
  appendCloudStatusItem,
  emptyCloudStatusProviders,
  splitCloudStatusData,
} from '@shared/cloudStatus';
import {
  CloudStatusManager,
  DEGRADED_CLOUD_STATUS_INTERVAL_MS,
  HEALTHY_CLOUD_STATUS_INTERVAL_MS,
} from './CloudStatusManager';

const legacyCreate = vi.fn().mockResolvedValue({ id: 'legacy-snapshot' });
const legacyUpdate = vi.fn().mockResolvedValue({ id: 'legacy-snapshot' });
const legacyGet = vi.fn().mockRejectedValue(new Error('missing'));
const mistCreate = vi.fn().mockResolvedValue({ id: 'mist-snapshot' });
const mistUpdate = vi.fn().mockResolvedValue({ id: 'mist-snapshot' });
const mistGet = vi.fn().mockRejectedValue(new Error('missing'));
const extensionCreate = vi.fn().mockResolvedValue({ id: 'extension-snapshot' });
const extensionUpdate = vi.fn().mockResolvedValue({ id: 'extension-snapshot' });
const extensionGet = vi.fn().mockRejectedValue(new Error('missing'));
const collection = vi.fn((name: string) => {
  if (name === 'cloud_status_mist_snapshot') {
    return { create: mistCreate, update: mistUpdate, getFirstListItem: mistGet };
  }
  if (name === 'cloud_status_extension_snapshot') {
    return { create: extensionCreate, update: extensionUpdate, getFirstListItem: extensionGet };
  }
  return { create: legacyCreate, update: legacyUpdate, getFirstListItem: legacyGet };
});
const pb = { collection } as unknown as PocketBase;

function data(items: CloudStatusItem[] = []): CloudStatusData {
  const providers = emptyCloudStatusProviders();
  for (const item of items) appendCloudStatusItem(providers, item);
  return { providers, errors: [], lastUpdated: Date.now() };
}

function issue(
  severity: CloudStatusItem['severity'],
  provider: CloudStatusItem['provider'] = 'aws',
  pubDate = new Date(Date.now()).toISOString(),
): CloudStatusItem {
  return {
    id: 'issue-1',
    provider,
    title: 'Service event',
    description: '',
    pubDate,
    link: '',
    severity,
  };
}

async function flushRefresh(): Promise<void> {
  await vi.runAllTicks();
  await Promise.resolve();
  await Promise.resolve();
}

describe('CloudStatusManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    legacyCreate.mockResolvedValue({ id: 'legacy-snapshot' });
    mistCreate.mockResolvedValue({ id: 'mist-snapshot' });
    extensionCreate.mockResolvedValue({ id: 'extension-snapshot' });
    legacyGet.mockRejectedValue(new Error('missing'));
    mistGet.mockRejectedValue(new Error('missing'));
    extensionGet.mockRejectedValue(new Error('missing'));
  });

  afterEach(() => vi.useRealTimers());

  it('polls every five minutes while providers are healthy', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(data());
    const manager = new CloudStatusManager(() => pb, fetchStatus);

    manager.start();
    await flushRefresh();
    expect(fetchStatus).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HEALTHY_CLOUD_STATUS_INTERVAL_MS - 1);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    manager.stop();
  });

  it('uses one-minute cadence while any provider is degraded', async () => {
    const fetchStatus = vi.fn().mockResolvedValue(data([issue('warning')]));
    const manager = new CloudStatusManager(() => pb, fetchStatus);

    manager.start();
    await flushRefresh();
    await vi.advanceTimersByTimeAsync(DEGRADED_CLOUD_STATUS_INTERVAL_MS);

    expect(fetchStatus).toHaveBeenCalledTimes(2);
    manager.stop();
  });

  it('keeps the healthy cadence when a retained issue is older than seven days', async () => {
    const stalePublishedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 - 1).toISOString();
    const fetchStatus = vi
      .fn()
      .mockResolvedValue(data([issue('warning', 'aws', stalePublishedAt)]));
    const manager = new CloudStatusManager(() => pb, fetchStatus);

    manager.start();
    await flushRefresh();
    await vi.advanceTimersByTimeAsync(DEGRADED_CLOUD_STATUS_INTERVAL_MS);

    expect(fetchStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(
      HEALTHY_CLOUD_STATUS_INTERVAL_MS - DEGRADED_CLOUD_STATUS_INTERVAL_MS,
    );
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    manager.stop();
  });

  it('coalesces overlapping manual refreshes into one provider fan-out', async () => {
    let resolveFetch: ((result: CloudStatusData) => void) | undefined;
    const fetchStatus = vi.fn(
      () =>
        new Promise<CloudStatusData>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const manager = new CloudStatusManager(() => pb, fetchStatus);

    const first = manager.refresh({ force: true });
    const second = manager.refresh({ force: true });
    await flushRefresh();
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    resolveFetch?.(data());

    await expect(first).resolves.toEqual(await second);
  });

  it('does not write an unchanged snapshot on every healthy poll', async () => {
    const first = data();
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ...first, lastUpdated: first.lastUpdated + 300_000 });
    const manager = new CloudStatusManager(() => pb, fetchStatus);

    await manager.refresh();
    await manager.refresh();

    expect(legacyCreate).toHaveBeenCalledTimes(1);
    expect(mistCreate).toHaveBeenCalledTimes(1);
    expect(extensionCreate).toHaveBeenCalledTimes(1);
    expect(legacyUpdate).not.toHaveBeenCalled();
    expect(mistUpdate).not.toHaveBeenCalled();
    expect(extensionUpdate).not.toHaveBeenCalled();
  });

  it('publishes unchanged degraded Mist polls without rewriting the healthy legacy partition', async () => {
    const first = data([issue('warning', 'mist_emea')]);
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ...first, lastUpdated: first.lastUpdated + 60_000 });
    const manager = new CloudStatusManager(() => pb, fetchStatus);

    await manager.refresh();
    await manager.refresh();

    expect(legacyCreate).toHaveBeenCalledTimes(1);
    expect(mistCreate).toHaveBeenCalledTimes(1);
    expect(legacyUpdate).not.toHaveBeenCalled();
    expect(mistUpdate).toHaveBeenCalledTimes(1);
  });

  it('publishes exact legacy and Mist singleton payloads on one refresh', async () => {
    const manager = new CloudStatusManager(
      () => pb,
      vi.fn().mockResolvedValue(data([issue('error'), issue('error', 'mist_global')])),
    );

    await manager.refresh();

    const legacyPayload = legacyCreate.mock.calls[0]?.[0] as { providers: object };
    const mistPayload = mistCreate.mock.calls[0]?.[0] as { providers: object };
    expect(Object.keys(legacyPayload.providers)).toEqual([
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
    expect(Object.keys(mistPayload.providers)).toEqual([
      'mist_global',
      'mist_emea',
      'mist_apac',
      'mist_federal',
    ]);
  });

  it('publishes Dynatrace only in the extension singleton', async () => {
    const manager = new CloudStatusManager(
      () => pb,
      vi.fn().mockResolvedValue(data([issue('error', 'dynatrace')])),
    );

    await manager.refresh();

    const legacyPayload = legacyCreate.mock.calls[0]?.[0] as { providers: object };
    const mistPayload = mistCreate.mock.calls[0]?.[0] as { providers: object };
    const extensionPayload = extensionCreate.mock.calls[0]?.[0] as { providers: object };
    expect(legacyPayload.providers).not.toHaveProperty('dynatrace');
    expect(mistPayload.providers).not.toHaveProperty('dynatrace');
    expect(extensionPayload.providers).toEqual({
      dynatrace: [expect.objectContaining({ provider: 'dynatrace' })],
      proofpoint: [],
      crowdstrike: [],
      dropbox: [],
    });
  });

  it('merges all persisted partitions before the first provider fetch', async () => {
    const persisted = data([
      issue('error'),
      issue('warning', 'mist_emea'),
      issue('warning', 'dynatrace'),
    ]);
    const { legacy, mist, extension } = splitCloudStatusData(persisted);
    legacyGet.mockResolvedValue({
      id: 'legacy-snapshot',
      key: 'current',
      contentHash: 'legacy-content',
      ...legacy,
    });
    mistGet.mockResolvedValue({
      id: 'mist-snapshot',
      key: 'current',
      contentHash: 'mist-content',
      ...mist,
    });
    extensionGet.mockResolvedValue({
      id: 'extension-snapshot',
      key: 'current',
      contentHash: 'extension-content',
      ...extension,
    });
    const fetchStatus = vi.fn(async (previous?: CloudStatusData | null) => previous ?? data());
    const manager = new CloudStatusManager(() => pb, fetchStatus);

    await manager.refresh();

    expect(fetchStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({
          aws: [expect.objectContaining({ provider: 'aws' })],
          mist_emea: [expect.objectContaining({ provider: 'mist_emea' })],
          dynatrace: [expect.objectContaining({ provider: 'dynatrace' })],
        }),
      }),
    );
    expect(manager.getSnapshot().providers.mist_emea).toHaveLength(1);
    expect(manager.getSnapshot().providers.dynatrace).toHaveLength(1);
  });
});
