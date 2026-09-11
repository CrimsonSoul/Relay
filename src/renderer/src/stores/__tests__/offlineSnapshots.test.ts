import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { CollectionStore } from '../collectionStore';
const transport = vi.hoisted(() => ({
  online: true,
  generation: 0,
  list: vi.fn(),
  connection: (_state: string) => {},
  client: () => {},
  realtime: (_event: { action: string; record: { id: string } }) => {},
}));
vi.mock('../../services/pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      getFullList: transport.list,
      subscribe: async (_topic: string, listener: typeof transport.realtime) => {
        transport.realtime = listener;
        return vi.fn();
      },
    }),
  }),
  isOnline: () => transport.online,
  handleApiError: vi.fn(),
  onConnectionStateChange: (listener: typeof transport.connection) => {
    transport.connection = listener;
    return () => {};
  },
  getPocketBaseClientGeneration: () => transport.generation,
  onPocketBaseClientChange: (listener: () => void) => {
    transport.client = listener;
    return () => {};
  },
}));
const saved = { ok: true, persisted: true };
const failed = { ok: false, persisted: false, error: 'Disk unavailable' };
let store: CollectionStore<{ id: string; notes?: string }>;
let api: {
  cacheRead: ReturnType<typeof vi.fn>;
  cacheSnapshotStatus: ReturnType<typeof vi.fn>;
  cacheSnapshotBegin: ReturnType<typeof vi.fn>;
  cacheSnapshotAppend: ReturnType<typeof vi.fn>;
  cacheSnapshotCommit: ReturnType<typeof vi.fn>;
  cacheWrite: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  transport.online = true;
  transport.generation = 0;
  transport.list.mockReset().mockResolvedValue([{ id: 'new' }]);
  api = {
    cacheRead: vi.fn(async () => [{ id: 'old' }]),
    cacheSnapshotStatus: vi.fn(async () => ({ complete: true })),
    cacheSnapshotBegin: vi.fn(async () => ({ ok: true, generation: 'one' })),
    cacheSnapshotAppend: vi.fn(async () => saved),
    cacheSnapshotCommit: vi.fn(async () => saved),
    cacheWrite: vi.fn(async () => saved),
  };
  vi.stubGlobal('api', api);
  store = new CollectionStore('contacts', {});
});
afterEach(() => {
  store.dispose();
  vi.unstubAllGlobals();
});
it('keeps online rows visible while saving, then claims readiness only after durable acknowledgement', async () => {
  let finish!: (value: typeof saved) => void;
  api.cacheSnapshotCommit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  store.subscribe(() => {});
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('saving'));
  await waitFor(() => expect(store.getSnapshot().loading).toBe(false));
  expect(store.getSnapshot().data).toEqual([{ id: 'new' }]);
  finish(saved);
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('ready'));
});
it('bounds 12000-row snapshot messages below 2 MiB and avoids per-record IPC', async () => {
  transport.list.mockResolvedValue(
    Array.from({ length: 12000 }, (_, i) => ({ id: `row-${i}`, notes: 'x'.repeat(1000) })),
  );
  store.subscribe(() => {});
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('ready'));
  expect(store.getSnapshot().data).toHaveLength(12000);
  expect(api.cacheWrite).not.toHaveBeenCalled();
  const chunks = api.cacheSnapshotAppend.mock.calls.map((call) => call[2]);
  expect(chunks.flat()).toHaveLength(12000);
  expect(
    chunks.every(
      (rows) =>
        rows.length <= 512 &&
        new TextEncoder().encode(JSON.stringify(rows)).byteLength <= 2 * 1024 * 1024,
    ),
  ).toBe(true);
});
it('shows save failure, retries unchanged content and retains complete memory across disconnect', async () => {
  api.cacheSnapshotCommit.mockResolvedValueOnce(failed);
  store.subscribe(() => {});
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('incomplete'));
  transport.online = false;
  transport.connection('offline');
  await waitFor(() => expect(store.getSnapshot().loading).toBe(false));
  expect(store.getSnapshot().data).toEqual([{ id: 'new' }]);
  expect(store.getSnapshot().isAuthoritative).toBe(false);
  await store.retryOfflineSave();
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('ready'));
  expect(api.cacheSnapshotCommit).toHaveBeenCalledTimes(2);
});
it('does not accept an obsolete save acknowledgement or leak rows after a server switch', async () => {
  let finish!: (value: typeof saved) => void;
  api.cacheSnapshotCommit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  store.subscribe(() => {});
  await waitFor(() => expect(api.cacheSnapshotCommit).toHaveBeenCalled());
  api.cacheRead.mockResolvedValue([]);
  api.cacheSnapshotStatus.mockResolvedValue({ complete: false });
  transport.online = false;
  transport.client();
  finish(saved);
  await waitFor(() => expect(store.getSnapshot().loading).toBe(false));
  expect(store.getSnapshot().data).toEqual([]);
  expect(store.getSnapshot().offlineReadiness).toBe('incomplete');
});
it('downgrades offline readiness after a rejected realtime write', async () => {
  store.subscribe(() => {});
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('ready'));
  api.cacheWrite.mockResolvedValueOnce(failed);
  transport.realtime({ action: 'delete', record: { id: 'new' } });
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('incomplete'));
  expect(store.getSnapshot().data).toEqual([]);
});

it('does not promote a prior fetch acknowledgement over a failed newer snapshot', async () => {
  let finish!: (value: typeof saved) => void;
  api.cacheSnapshotCommit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  store.subscribe(() => {});
  await waitFor(() => expect(api.cacheSnapshotCommit).toHaveBeenCalledOnce());
  transport.list.mockResolvedValue([{ id: 'latest' }]);
  api.cacheSnapshotCommit.mockResolvedValueOnce(failed);
  await store.refetch();
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('incomplete'));
  finish(saved);
  await Promise.resolve();
  expect(store.getSnapshot().data).toEqual([{ id: 'latest' }]);
  expect(store.getSnapshot().offlineReadiness).toBe('incomplete');
});
it('clears retained memory when a disposed store revives against another server', async () => {
  const unsubscribe = store.subscribe(() => {});
  await waitFor(() => expect(store.getSnapshot().offlineReadiness).toBe('ready'));
  unsubscribe();
  store.dispose();
  transport.generation += 1;
  transport.online = false;
  api.cacheRead.mockResolvedValue([]);
  api.cacheSnapshotStatus.mockResolvedValue({ complete: false });
  store.subscribe(() => {});
  await waitFor(() => expect(store.getSnapshot().loading).toBe(false));
  expect(store.getSnapshot().data).toEqual([]);
  expect(store.getSnapshot().totalItems).toBe(0);
  expect(store.getSnapshot().offlineReadiness).toBe('incomplete');
});

it('ends saving when a newer refresh cancels the transfer and then fails', async () => {
  let finish!: (value: typeof saved) => void;
  api.cacheSnapshotCommit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  store.subscribe(() => {});
  await waitFor(() => expect(api.cacheSnapshotCommit).toHaveBeenCalledOnce());
  transport.list.mockRejectedValueOnce(new Error('Refresh failed'));
  await store.refetch();
  expect(store.getSnapshot().offlineReadiness).toBe('incomplete');
  expect(store.getSnapshot().data).toEqual([{ id: 'new' }]);
  finish(saved);
  await Promise.resolve();
  expect(store.getSnapshot().offlineReadiness).toBe('incomplete');
});
