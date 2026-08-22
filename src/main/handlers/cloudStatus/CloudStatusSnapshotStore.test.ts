import { beforeEach, describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import { emptyMistCloudStatusProviders } from '@shared/cloudStatus';
import type { MistCloudStatusData } from '@shared/ipc';
import { CloudStatusSnapshotStore, MIST_CLOUD_STATUS_COLLECTION } from './CloudStatusSnapshotStore';

const create = vi.fn().mockResolvedValue({ id: 'mist-snapshot' });
const update = vi.fn().mockResolvedValue({ id: 'mist-snapshot' });
const getFirstListItem = vi.fn().mockRejectedValue(new Error('missing'));
const collection = vi.fn(() => ({ create, update, getFirstListItem }));
const pb = { collection } as unknown as PocketBase;

function mistData(lastUpdated = 100): MistCloudStatusData {
  return { providers: emptyMistCloudStatusProviders(), errors: [], lastUpdated };
}

describe('CloudStatusSnapshotStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    create.mockResolvedValue({ id: 'mist-snapshot' });
    getFirstListItem.mockRejectedValue(new Error('missing'));
  });

  it('writes Mist only to the Mist singleton collection', async () => {
    const store = new CloudStatusSnapshotStore(
      () => pb,
      MIST_CLOUD_STATUS_COLLECTION,
      emptyMistCloudStatusProviders,
    );

    await store.persist(mistData(), false);

    expect(collection).toHaveBeenCalledWith('cloud_status_mist_snapshot');
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'current',
        providers: emptyMistCloudStatusProviders(),
        errors: [],
        lastUpdated: 100,
        contentHash: expect.any(String),
      }),
      { requestKey: null },
    );
  });

  it('hydrates a persisted singleton and suppresses an unchanged healthy write', async () => {
    const persisted = {
      id: 'mist-snapshot',
      key: 'current',
      contentHash: '5c3a98a19d54429c5378c4720db86806a7a1a05690beac1499ef4c249b6f3bcf',
      created: '2026-08-03T10:00:00.000Z',
      updated: '2026-08-03T10:00:00.000Z',
      ...mistData(),
    };
    getFirstListItem.mockResolvedValue(persisted);
    const store = new CloudStatusSnapshotStore(
      () => pb,
      MIST_CLOUD_STATUS_COLLECTION,
      emptyMistCloudStatusProviders,
    );

    const hydrated = await store.hydrate(mistData(0));
    await store.persist(hydrated, false);

    expect(hydrated).toEqual(mistData());
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('updates an unchanged singleton when forced by degraded state', async () => {
    const store = new CloudStatusSnapshotStore(
      () => pb,
      MIST_CLOUD_STATUS_COLLECTION,
      emptyMistCloudStatusProviders,
    );
    const first = mistData();

    await store.persist(first, false);
    await store.persist({ ...first, lastUpdated: 160 }, true);

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      'mist-snapshot',
      expect.objectContaining({ lastUpdated: 160 }),
      { requestKey: null },
    );
  });

  it('returns the supplied fallback when the collection or singleton is missing', async () => {
    const store = new CloudStatusSnapshotStore(
      () => pb,
      MIST_CLOUD_STATUS_COLLECTION,
      emptyMistCloudStatusProviders,
    );
    const fallback = mistData(0);

    await expect(store.hydrate(fallback)).resolves.toEqual(fallback);
  });
});
