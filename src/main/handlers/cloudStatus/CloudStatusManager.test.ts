import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import type { CloudStatusData, CloudStatusItem } from '@shared/ipc';
import { emptyCloudStatusProviders } from '@shared/cloudStatus';
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
const collection = vi.fn((name: string) =>
  name === 'cloud_status_mist_snapshot'
    ? { create: mistCreate, update: mistUpdate, getFirstListItem: mistGet }
    : { create: legacyCreate, update: legacyUpdate, getFirstListItem: legacyGet },
);
const pb = { collection } as unknown as PocketBase;

function data(items: CloudStatusItem[] = []): CloudStatusData {
  const providers = emptyCloudStatusProviders();
  for (const item of items) providers[item.provider].push(item);
  return { providers, errors: [], lastUpdated: Date.now() };
}

function issue(
  severity: CloudStatusItem['severity'],
  provider: CloudStatusItem['provider'] = 'aws',
): CloudStatusItem {
  return {
    id: 'issue-1',
    provider,
    title: 'Service event',
    description: '',
    pubDate: '2026-07-10T18:00:00.000Z',
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
    legacyGet.mockRejectedValue(new Error('missing'));
    mistGet.mockRejectedValue(new Error('missing'));
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
    expect(legacyUpdate).not.toHaveBeenCalled();
    expect(mistUpdate).not.toHaveBeenCalled();
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
});
