import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KNOWLEDGE_DOCUMENTS_COLLECTION } from '@shared/knowledge';
import {
  KNOWLEDGE_SEARCH_CHUNKS_COLLECTION,
  KNOWLEDGE_SEARCH_INDEX_VERSION,
  normalizeKnowledgeSearchText,
  type KnowledgeSearchRequest,
} from '@shared/knowledgeSearch';
import {
  knowledgeSearchFixtureChunk,
  knowledgeSearchFixtureDocument,
} from '../__fixtures__/knowledgeSearchRelevance';
import { KnowledgeSearchEngine } from '../KnowledgeSearchEngine';
import { KnowledgeSearchService } from '../KnowledgeSearchService';

const readyDocument = knowledgeSearchFixtureDocument({
  id: 'document1',
  title: 'Failover Guide',
  category: 'Operations',
  categoryId: 'operations',
});
const validChunk = knowledgeSearchFixtureChunk(readyDocument, 'Primary failover procedure', {
  id: 'chunk1',
});

function request(query: string, requestId = 'request-1'): KnowledgeSearchRequest {
  return {
    requestId,
    query,
    scope: { kind: 'all' },
    categoryId: null,
    documentType: null,
    limit: 20,
  };
}

function cacheWith(documents: unknown[] = [], chunks: unknown[] = []) {
  return {
    readCollection: vi.fn((collection: string) =>
      collection === KNOWLEDGE_DOCUMENTS_COLLECTION ? documents : chunks,
    ),
    writeCollection: vi.fn(),
    updateRecord: vi.fn(() => true),
  };
}

type RealtimeHandler = (event: { action: string; record: Record<string, unknown> }) => unknown;

function pbWith(documents: unknown[], chunks: unknown[]) {
  let documentHandler: RealtimeHandler | null = null;
  let chunkHandler: RealtimeHandler | null = null;
  const unsubscribeDocuments = vi.fn();
  const unsubscribeChunks = vi.fn();
  const documentCollection = {
    getFullList: vi.fn(async () => documents),
    subscribe: vi.fn(async (_topic: string, handler: RealtimeHandler) => {
      documentHandler = handler;
      return unsubscribeDocuments;
    }),
  };
  const chunkCollection = {
    getFullList: vi.fn(async () => chunks),
    subscribe: vi.fn(async (_topic: string, handler: RealtimeHandler) => {
      chunkHandler = handler;
      return unsubscribeChunks;
    }),
  };
  const realtime = { onDisconnect: null as null | ((subscriptions: string[]) => void) };
  const pb = {
    realtime,
    collection: vi.fn((name: string) =>
      name === KNOWLEDGE_DOCUMENTS_COLLECTION ? documentCollection : chunkCollection,
    ),
  };
  return {
    pb,
    documentCollection,
    chunkCollection,
    unsubscribeDocuments,
    unsubscribeChunks,
    emitDocument(action: string, record: Record<string, unknown>) {
      return documentHandler?.({ action, record });
    },
    emitChunk(action: string, record: Record<string, unknown>) {
      return chunkHandler?.({ action, record });
    },
    disconnect() {
      realtime.onDisconnect?.(['knowledge_documents', 'knowledge_search_chunks']);
    },
  };
}

describe('KnowledgeSearchService', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('hydrates a valid cached index when PocketBase is unavailable', async () => {
    const service = new KnowledgeSearchService({
      cache: cacheWith([readyDocument], [validChunk]) as never,
      engine: new KnowledgeSearchEngine(),
      now: () => 10_000,
    });

    await expect(service.start(null)).resolves.toBeUndefined();
    await expect(service.search(request('failvoer'))).resolves.toMatchObject({
      ok: true,
      availability: 'cached',
      results: [expect.objectContaining({ documentId: readyDocument.id })],
    });
  });

  it('skips malformed cache rows without allowing them into the engine', async () => {
    const service = new KnowledgeSearchService({
      cache: cacheWith(
        [{ id: '../bad' }, readyDocument],
        [{ id: '../bad', text: 'secret malformed passage' }, validChunk],
      ) as never,
      engine: new KnowledgeSearchEngine(),
    });

    await service.start(null);
    const response = await service.search(request('failover'));
    expect(response).toMatchObject({ ok: true, availability: 'cached' });
    expect(response.ok && response.results).toHaveLength(1);
  });

  it('keeps the service unavailable rather than loading stale checksum chunks', async () => {
    const service = new KnowledgeSearchService({
      cache: cacheWith([readyDocument], [{ ...validChunk, checksum: 'b'.repeat(64) }]) as never,
      engine: new KnowledgeSearchEngine(),
    });

    await service.start(null);
    await expect(service.search(request('failover'))).resolves.toMatchObject({
      ok: false,
      error: 'unavailable',
    });
  });

  it('discards unknown chunk versions and documents whose ready checksum is stale', async () => {
    const staleDocument = { ...readyDocument, searchIndexChecksum: 'b'.repeat(64) };
    const service = new KnowledgeSearchService({
      cache: cacheWith(
        [staleDocument],
        [{ ...validChunk, indexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION + 1 }],
      ) as never,
      engine: new KnowledgeSearchEngine(),
    });

    await service.start(null);
    await expect(service.search(request('failover'))).resolves.toMatchObject({
      ok: false,
      error: 'unavailable',
    });
  });

  it('rejects an oversized corpus before replacing the published engine snapshot', async () => {
    const engine = { replaceSnapshot: vi.fn(), search: vi.fn() };
    const service = new KnowledgeSearchService({
      cache: cacheWith([readyDocument], [validChunk]) as never,
      engine: engine as never,
      limits: {
        maxChunks: 0,
        maxTextBytes: 1,
        maxChunksPerDocument: 0,
        maxTextBytesPerDocument: 1,
      },
    });

    await service.start(null);
    expect(engine.replaceSnapshot).not.toHaveBeenCalled();
    await expect(service.search(request('failover'))).resolves.toMatchObject({
      ok: false,
      error: 'unavailable',
    });
  });

  it('fetches document and chunk snapshots independently, validates them, and caches only accepted rows', async () => {
    const cache = cacheWith();
    const network = pbWith([{ id: '../bad' }, readyDocument], [{ id: '../bad' }, validChunk]);
    const service = new KnowledgeSearchService({ cache: cache as never });

    await expect(service.start(network.pb as never)).resolves.toBeUndefined();

    expect(network.documentCollection.getFullList).toHaveBeenCalledWith({ requestKey: null });
    expect(network.chunkCollection.getFullList).toHaveBeenCalledWith({ requestKey: null });
    expect(cache.writeCollection).toHaveBeenCalledWith(KNOWLEDGE_DOCUMENTS_COLLECTION, [
      readyDocument,
    ]);
    expect(cache.writeCollection).toHaveBeenCalledWith(KNOWLEDGE_SEARCH_CHUNKS_COLLECTION, [
      validChunk,
    ]);
    await expect(service.search(request('failover'))).resolves.toMatchObject({
      ok: true,
      availability: 'ready',
    });
  });

  it('contains cache, fetch, and subscription failures while preserving a cached snapshot', async () => {
    const cache = cacheWith([readyDocument], [validChunk]);
    cache.writeCollection.mockImplementation(() => {
      throw new Error('cache unavailable');
    });
    const network = pbWith([readyDocument], [validChunk]);
    network.chunkCollection.subscribe.mockRejectedValueOnce(new Error('subscribe unavailable'));
    const service = new KnowledgeSearchService({ cache: cache as never });

    await expect(service.start(network.pb as never)).resolves.toBeUndefined();
    expect(network.unsubscribeDocuments).toHaveBeenCalledOnce();
    await expect(service.search(request('failover'))).resolves.toMatchObject({
      ok: true,
      availability: 'cached',
    });

    network.documentCollection.getFullList.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(service.connect(network.pb as never)).resolves.toBeUndefined();
  });

  it('bounds a subscription that never settles without blocking cache-backed startup', async () => {
    vi.useFakeTimers();
    const network = pbWith([readyDocument], [validChunk]);
    network.documentCollection.subscribe.mockImplementationOnce(() => new Promise(() => undefined));
    const service = new KnowledgeSearchService({
      cache: cacheWith([readyDocument], [validChunk]) as never,
    });

    const startup = service.start(network.pb as never);
    await vi.waitFor(() => expect(network.documentCollection.subscribe).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(startup).resolves.toBeUndefined();
    vi.useRealTimers();
    await expect(service.search(request('failover'))).resolves.toMatchObject({
      ok: true,
      availability: 'cached',
    });
  });

  it('re-ranks document metadata updates without replacing passage text', async () => {
    const engine = {
      replaceSnapshot: vi.fn(),
      upsertDocument: vi.fn(),
      removeDocument: vi.fn(),
      upsertChunk: vi.fn(),
      removeChunk: vi.fn(),
      search: vi.fn(async (searchRequest: KnowledgeSearchRequest) => ({
        ok: true as const,
        requestId: searchRequest.requestId,
        availability: 'ready' as const,
        normalizedQuery: normalizeKnowledgeSearchText(searchRequest.query),
        results: [],
      })),
    };
    const network = pbWith([readyDocument], [validChunk]);
    const service = new KnowledgeSearchService({ engine: engine as never });
    await service.start(network.pb as never);
    engine.upsertChunk.mockClear();

    network.emitDocument('update', {
      ...readyDocument,
      title: 'Oracle Recovery Guide',
      displayTitle: 'Oracle Recovery Guide',
      category: 'Recovery',
    });

    expect(engine.upsertDocument).toHaveBeenCalledWith(
      expect.objectContaining({ id: readyDocument.id, title: 'Oracle Recovery Guide' }),
    );
    expect(engine.upsertChunk).not.toHaveBeenCalled();
  });

  it('applies chunk create/update/delete events incrementally', async () => {
    const engine = {
      replaceSnapshot: vi.fn(),
      upsertDocument: vi.fn(),
      removeDocument: vi.fn(),
      upsertChunk: vi.fn(),
      removeChunk: vi.fn(),
      search: vi.fn(),
    };
    const network = pbWith([readyDocument], [validChunk]);
    const service = new KnowledgeSearchService({ engine: engine as never });
    await service.start(network.pb as never);

    const second = knowledgeSearchFixtureChunk(readyDocument, 'Secondary failover path', {
      id: 'chunk2',
      passageNumber: 2,
      normalizedStart: 100,
    });
    network.emitChunk('create', second);
    network.emitChunk('update', { ...second, heading: 'Recovery' });
    network.emitChunk('delete', second);

    expect(engine.upsertChunk).toHaveBeenNthCalledWith(1, second);
    expect(engine.upsertChunk).toHaveBeenNthCalledWith(2, { ...second, heading: 'Recovery' });
    expect(engine.removeChunk).toHaveBeenCalledWith(second.id);
  });

  it('rejects realtime chunks that would exceed corpus or per-document caps', async () => {
    const engine = {
      replaceSnapshot: vi.fn(),
      upsertDocument: vi.fn(),
      removeDocument: vi.fn(),
      upsertChunk: vi.fn(),
      removeChunk: vi.fn(),
      search: vi.fn(),
    };
    const network = pbWith([readyDocument], [validChunk]);
    const service = new KnowledgeSearchService({
      engine: engine as never,
      limits: {
        maxChunks: 1,
        maxTextBytes: 10_000,
        maxChunksPerDocument: 1,
        maxTextBytesPerDocument: 10_000,
      },
    });
    await service.start(network.pb as never);
    engine.upsertChunk.mockClear();

    network.emitChunk(
      'create',
      knowledgeSearchFixtureChunk(readyDocument, 'Secondary failover path', {
        id: 'chunk2',
        passageNumber: 2,
        normalizedStart: 100,
      }),
    );

    expect(engine.upsertChunk).not.toHaveBeenCalled();
  });

  it('removes trashed and deleted documents from eligible results', async () => {
    const network = pbWith([readyDocument], [validChunk]);
    const service = new KnowledgeSearchService({ engine: new KnowledgeSearchEngine() });
    await service.start(network.pb as never);

    network.emitDocument('update', {
      ...readyDocument,
      lifecycleState: 'trashed',
      trashedByAccountId: 'account1',
      trashedByName: 'Operator',
      trashedAt: '2026-07-19T18:00:00.000Z',
    });
    await expect(service.search(request('failover'))).resolves.toMatchObject({
      ok: true,
      results: [],
    });
    network.emitDocument('delete', readyDocument);
    await expect(service.search(request('failover'))).resolves.toMatchObject({
      ok: true,
      results: [],
    });
  });

  it('performs a bounded full reconciliation after realtime delivery is lost', async () => {
    const network = pbWith([readyDocument], [validChunk]);
    const service = new KnowledgeSearchService({ engine: new KnowledgeSearchEngine() });
    await service.start(network.pb as never);
    network.documentCollection.getFullList.mockResolvedValueOnce([]);
    network.chunkCollection.getFullList.mockResolvedValueOnce([]);

    network.disconnect();
    await vi.waitFor(() => expect(network.documentCollection.getFullList).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => {
      await expect(service.search(request('failover'))).resolves.toMatchObject({
        ok: true,
        availability: 'ready',
        results: [],
      });
    });
  });

  it('returns a stable timeout after the one-second main-process deadline', async () => {
    vi.useFakeTimers();
    const engine = {
      replaceSnapshot: vi.fn(),
      search: vi.fn(() => new Promise(() => undefined)),
    };
    const service = new KnowledgeSearchService({
      cache: cacheWith([readyDocument], [validChunk]) as never,
      engine: engine as never,
    });
    await service.start(null);

    const pending = service.search(request('failover'));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toEqual({
      ok: false,
      requestId: 'request-1',
      error: 'timeout',
    });
    expect(engine.search).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deadline: expect.any(Number), isCancelled: expect.any(Function) }),
    );
  });

  it('returns a stable cancelled result even when the engine has not settled', async () => {
    const service = new KnowledgeSearchService({
      cache: cacheWith([readyDocument], [validChunk]) as never,
      engine: {
        replaceSnapshot: vi.fn(),
        search: vi.fn(() => new Promise(() => undefined)),
      } as never,
    });
    await service.start(null);

    const pending = service.search(request('failover'));
    service.cancel('request-1');
    await expect(pending).resolves.toEqual({
      ok: false,
      requestId: 'request-1',
      error: 'cancelled',
    });
  });

  it('opens after three failures and retries after the thirty-second circuit cooldown', async () => {
    let now = 10_000;
    const engine = {
      replaceSnapshot: vi.fn(),
      search: vi
        .fn()
        .mockRejectedValueOnce(new Error('ranking failed'))
        .mockRejectedValueOnce(new Error('ranking failed'))
        .mockRejectedValueOnce(new Error('ranking failed'))
        .mockImplementation(async (searchRequest: KnowledgeSearchRequest) => ({
          ok: true,
          requestId: searchRequest.requestId,
          availability: 'ready',
          normalizedQuery: normalizeKnowledgeSearchText(searchRequest.query),
          results: [],
        })),
    };
    const service = new KnowledgeSearchService({
      cache: cacheWith([readyDocument], [validChunk]) as never,
      engine: engine as never,
      now: () => now,
    });
    await service.start(null);

    await service.search(request('failover', 'failure-1'));
    await service.search(request('failover', 'failure-2'));
    await service.search(request('failover', 'failure-3'));
    await expect(service.search(request('failover', 'open'))).resolves.toMatchObject({
      ok: false,
      error: 'unavailable',
    });
    expect(engine.search).toHaveBeenCalledTimes(3);

    now += 30_000;
    await expect(service.search(request('failover', 'cooled'))).resolves.toMatchObject({
      ok: true,
    });
    expect(engine.search).toHaveBeenCalledTimes(4);
  });

  it('unsubscribes, cancels work, clears timers, and empties derived state on dispose', async () => {
    vi.useFakeTimers();
    const engine = new KnowledgeSearchEngine();
    const replace = vi.spyOn(engine, 'replaceSnapshot');
    const network = pbWith([readyDocument], [validChunk]);
    const service = new KnowledgeSearchService({ engine });
    await service.start(network.pb as never);

    await expect(service.dispose()).resolves.toBeUndefined();
    expect(network.unsubscribeDocuments).toHaveBeenCalledOnce();
    expect(network.unsubscribeChunks).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenLastCalledWith([], []);
    await expect(service.search(request('failover'))).resolves.toMatchObject({
      ok: false,
      error: 'unavailable',
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
