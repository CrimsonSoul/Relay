import type { RecordModel } from 'pocketbase';
import { describe, expect, it, vi } from 'vitest';

type ConnectionState = 'online' | 'offline';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const mocked = vi.hoisted(() => ({
  connection: 'online' as ConnectionState,
  connectionListener: null as ((state: ConnectionState) => void) | null,
  clientListener: null as ((generation: number) => void) | null,
  getFullList: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock('@renderer/services/pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      getFullList: mocked.getFullList,
      subscribe: mocked.subscribe,
    }),
  }),
  handleApiError: vi.fn(),
  isOnline: () => mocked.connection === 'online',
  onConnectionStateChange: (listener: (state: ConnectionState) => void) => {
    mocked.connectionListener = listener;
    return () => {
      mocked.connectionListener = null;
    };
  },
  onPocketBaseClientChange: (listener: (generation: number) => void) => {
    mocked.clientListener = listener;
    return () => {
      mocked.clientListener = null;
    };
  },
}));

import { CollectionStore } from '../collectionStore';
import { isWebMutationGateReady, registerWebCollectionGate } from '../webOnlineGate';

describe('CollectionStore connection lifecycle', () => {
  it('does not let a pre-disconnect fetch reopen Web writes', async () => {
    const oldFetch = deferred<RecordModel[]>();
    mocked.connection = 'online';
    mocked.getFullList.mockReturnValue(oldFetch.promise);
    mocked.subscribe.mockResolvedValue(mocked.unsubscribe);

    const previousApi = globalThis.api;
    Object.assign(globalThis, { api: { runtime: { kind: 'web' } } });
    const unrelatedGate = registerWebCollectionGate();
    unrelatedGate.markReady();
    const store = new CollectionStore<RecordModel>('contacts', {});
    const unsubscribeListener = store.subscribe(() => undefined);

    try {
      await vi.waitFor(() => expect(mocked.getFullList).toHaveBeenCalledTimes(1));
      expect(isWebMutationGateReady()).toBe(false);

      mocked.connection = 'offline';
      mocked.connectionListener?.('offline');
      mocked.clientListener?.(2);

      oldFetch.resolve([
        {
          id: 'contact-1',
          collectionId: 'contacts-id',
          collectionName: 'contacts',
          created: '2026-07-25 20:00:00.000Z',
          updated: '2026-07-25 20:00:01.000Z',
          name: 'Pre-transition snapshot',
        },
      ]);
      await oldFetch.promise;
      await Promise.resolve();

      expect(store.getSnapshot().data).toEqual([]);
      expect(isWebMutationGateReady()).toBe(false);
    } finally {
      unsubscribeListener();
      store.dispose();
      unrelatedGate.unregister();
      Object.assign(globalThis, { api: previousApi });
    }
  });
});
