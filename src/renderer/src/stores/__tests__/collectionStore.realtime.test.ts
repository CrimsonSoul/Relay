import type { RecordModel } from 'pocketbase';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type RealtimeEvent = { action: string; record: RecordModel };

const mocked = vi.hoisted(() => ({
  getFullList: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  realtimeListener: null as ((event: RealtimeEvent) => void) | null,
}));

vi.mock('@renderer/services/pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      getFullList: mocked.getFullList,
      subscribe: mocked.subscribe,
    }),
  }),
  handleApiError: vi.fn(),
  isOnline: () => true,
  onConnectionStateChange: () => () => undefined,
  onPocketBaseClientChange: () => () => undefined,
}));

import { CollectionStore } from '../collectionStore';

function makeRecord(id: string, fields: Record<string, unknown> = {}): RecordModel {
  return {
    id,
    collectionId: 'snapshots-id',
    collectionName: 'cloud_status_snapshot',
    created: '2026-07-25 20:00:00.000Z',
    updated: '2026-07-25 20:00:01.000Z',
    ...fields,
  } as RecordModel;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.realtimeListener = null;
  mocked.getFullList.mockResolvedValue([]);
  mocked.subscribe.mockImplementation(
    async (_topic: string, listener: (e: RealtimeEvent) => void) => {
      mocked.realtimeListener = listener;
      return mocked.unsubscribe;
    },
  );
});

describe('CollectionStore realtime events', () => {
  it('rejects a created record that the store filter excludes', async () => {
    const store = new CollectionStore<RecordModel>('cloud_status_snapshot', {
      filter: 'key="current"',
    });
    const unsubscribeListener = store.subscribe(() => undefined);

    try {
      await vi.waitFor(() => expect(mocked.realtimeListener).not.toBeNull());

      mocked.realtimeListener?.({
        action: 'create',
        record: makeRecord('other-key', { key: 'archived' }),
      });
      expect(store.getSnapshot().data).toEqual([]);

      mocked.realtimeListener?.({
        action: 'create',
        record: makeRecord('current-key', { key: 'current' }),
      });
      expect(store.getSnapshot().data).toHaveLength(1);
      expect(store.getSnapshot().data[0]?.id).toBe('current-key');
    } finally {
      unsubscribeListener();
      store.dispose();
    }
  });

  it('rejects every created record when the filter cannot be evaluated', async () => {
    const store = new CollectionStore<RecordModel>('cloud_status_snapshot', {
      filter: 'created > "2026-01-01"',
    });
    const unsubscribeListener = store.subscribe(() => undefined);

    try {
      await vi.waitFor(() => expect(mocked.realtimeListener).not.toBeNull());

      mocked.realtimeListener?.({ action: 'create', record: makeRecord('unknown') });

      expect(store.getSnapshot().data).toEqual([]);
    } finally {
      unsubscribeListener();
      store.dispose();
    }
  });

  it('keeps the snapshot identity when an update targets a record it does not hold', async () => {
    mocked.getFullList.mockResolvedValue([makeRecord('held')]);
    const store = new CollectionStore<RecordModel>('contacts', {});
    const listener = vi.fn();
    const unsubscribeListener = store.subscribe(listener);

    try {
      await vi.waitFor(() => expect(store.getSnapshot().data).toHaveLength(1));
      const before = store.getSnapshot();
      listener.mockClear();

      mocked.realtimeListener?.({ action: 'update', record: makeRecord('not-held') });

      expect(store.getSnapshot()).toBe(before);
      expect(store.getSnapshot().data).toBe(before.data);
      expect(listener).not.toHaveBeenCalled();
    } finally {
      unsubscribeListener();
      store.dispose();
    }
  });

  it('still applies an update to a record it holds', async () => {
    mocked.getFullList.mockResolvedValue([makeRecord('held', { name: 'before' })]);
    const store = new CollectionStore<RecordModel>('contacts', {});
    const unsubscribeListener = store.subscribe(() => undefined);

    try {
      await vi.waitFor(() => expect(store.getSnapshot().data).toHaveLength(1));

      mocked.realtimeListener?.({
        action: 'update',
        record: makeRecord('held', { name: 'after' }),
      });

      expect(store.getSnapshot().data).toHaveLength(1);
      expect(store.getSnapshot().data[0]).toMatchObject({ id: 'held', name: 'after' });
    } finally {
      unsubscribeListener();
      store.dispose();
    }
  });
});
