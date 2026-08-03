import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import type { CloudStatusData, CloudStatusItem } from '@shared/ipc';
import { emptyCloudStatusProviders } from '@shared/cloudStatus';
import {
  CloudStatusManager,
  DEGRADED_CLOUD_STATUS_INTERVAL_MS,
  HEALTHY_CLOUD_STATUS_INTERVAL_MS,
} from './CloudStatusManager';

const create = vi.fn().mockResolvedValue({ id: 'snapshot-1' });
const update = vi.fn().mockResolvedValue({ id: 'snapshot-1' });
const getFirstListItem = vi.fn().mockRejectedValue(new Error('missing'));
const collection = vi.fn(() => ({ create, update, getFirstListItem }));
const pb = { collection } as unknown as PocketBase;

function data(items: CloudStatusItem[] = []): CloudStatusData {
  const providers = emptyCloudStatusProviders();
  providers.aws = items;
  return { providers, errors: [], lastUpdated: Date.now() };
}

function issue(severity: CloudStatusItem['severity']): CloudStatusItem {
  return {
    id: 'issue-1',
    provider: 'aws',
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
    create.mockResolvedValue({ id: 'snapshot-1' });
    getFirstListItem.mockRejectedValue(new Error('missing'));
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
    await Promise.resolve();
    await Promise.resolve();
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

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('publishes unchanged degraded polls so clients can confirm consecutive snapshots', async () => {
    const first = data([issue('warning')]);
    const fetchStatus = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ ...first, lastUpdated: first.lastUpdated + 60_000 });
    const manager = new CloudStatusManager(() => pb, fetchStatus);

    await manager.refresh();
    await manager.refresh();

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
