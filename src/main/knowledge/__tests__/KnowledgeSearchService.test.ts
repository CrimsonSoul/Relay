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
const SERVER_URL = 'https://relay.example.com';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

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

function cacheWith(
  documents: unknown[] = [],
  chunks: unknown[] = [],
  usableServerIdentity: string | null = SERVER_URL,
) {
  return {
    readCollection: vi.fn((collection: string) =>
      collection === KNOWLEDGE_DOCUMENTS_COLLECTION ? documents : chunks,
    ),
    writeCollection: vi.fn(),
    updateRecord: vi.fn(() => true),
    hasUsableCacheFor: vi.fn((serverIdentity: string) => serverIdentity === usableServerIdentity),
    setUsableCacheMarker: vi.fn(),
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
      cacheIdentity: SERVER_URL,
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

  it.each([
    ['missing marker', null],
    ['different server marker', 'https://other-relay.example.com'],
    ['stale marker left behind by a failed clear', 'https://old-relay.example.com'],
  ])('never hydrates cached records for a %s', async (_label, markerIdentity) => {
    const cache = cacheWith([readyDocument], [validChunk], markerIdentity);
    const service = new KnowledgeSearchService({
      cache: cache as never,
      cacheIdentity: SERVER_URL,
      engine: new KnowledgeSearchEngine(),
    });

    await service.start(null);

    expect(cache.hasUsableCacheFor).toHaveBeenCalledWith(SERVER_URL);
    expect(cache.readCollection).not.toHaveBeenCalled();
    await expect(service.search(request('failover'))).resolves.toMatchObject({
      ok: false,
      error: 'unavailable',
    });
  });

  it('does not reuse server A cache after restart under server B', async () => {
    const cache = cacheWith([readyDocument], [validChunk], 'https://server-a.example.com');
    const first = new KnowledgeSearchService({
      cache: cache as never,
      cacheIdentity: 'https://server-a.example.com',
    });
    const second = new KnowledgeSearchService({
      cache: cache as never,
      cacheIdentity: 'https://server-b.example.com',
    });

    await first.start(null);
    await expect(first.search(request('failover', 'server-a'))).resolves.toMatchObject({
      ok: true,
    });
    await first.dispose();
    cache.readCollection.mockClear();
    await second.start(null);

    expect(cache.readCollection).not.toHaveBeenCalled();
    await expect(second.search(request('failover', 'server-b'))).resolves.toMatchObject({
      ok: false,
      error: 'unavailable',
    });
  });

  it('skips malformed cache rows without allowing them into the engine', async () => {
    const service = new KnowledgeSearchService({
      cache: cacheWith(
        [{ id: '../bad' }, readyDocument],
        [{ id: '../bad', text: 'secret malformed passage' }, validChunk],
      ) as never,
      cacheIdentity: SERVER_URL,
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
      cacheIdentity: SERVER_URL,
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
      cacheIdentity: SERVER_URL,
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
      cacheIdentity: SERVER_URL,
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
    const service = new KnowledgeSearchService({
      cache: cache as never,
      cacheIdentity: SERVER_URL,
    });

    await expect(service.start(network.pb as never)).resolves.toBeUndefined();

    expect(network.documentCollection.getFullList).toHaveBeenCalledWith({ requestKey: null });
    expect(network.chunkCollection.getFullList).toHaveBeenCalledWith({ requestKey: null });
    expect(cache.writeCollection).toHaveBeenCalledWith(KNOWLEDGE_DOCUMENTS_COLLECTION, [
      readyDocument,
    ]);
    expect(cache.writeCollection).toHaveBeenCalledWith(KNOWLEDGE_SEARCH_CHUNKS_COLLECTION, [
      validChunk,
    ]);
    expect(cache.setUsableCacheMarker).not.toHaveBeenCalled();
    await expect(service.search(request('failover'))).resolves.toMatchObject({
      ok: true,
      availability: 'ready',
    });
  });

  it('does not overwrite server A cache or promote its marker while connected to server B', async () => {
    const cache = cacheWith([readyDocument], [validChunk], 'https://server-a.example.com');
    const serverBDocument = { ...readyDocument, title: 'Server B document' };
    const network = pbWith([serverBDocument], [validChunk]);
    const serverBService = new KnowledgeSearchService({
      cache: cache as never,
      cacheIdentity: 'https://server-b.example.com',
    });

    await serverBService.start(network.pb as never);

    expect(cache.hasUsableCacheFor).toHaveBeenCalledWith('https://server-b.example.com');
    expect(cache.setUsableCacheMarker).not.toHaveBeenCalled();
    expect(cache.writeCollection).not.toHaveBeenCalled();
    await serverBService.dispose();

    const serverAEngine = {
      replaceSnapshot: vi.fn(),
      search: vi.fn(),
    };
    const serverAService = new KnowledgeSearchService({
      cache: cache as never,
      cacheIdentity: 'https://server-a.example.com',
      engine: serverAEngine as never,
    });
    await serverAService.start(null);
    expect(serverAEngine.replaceSnapshot).toHaveBeenCalledWith([readyDocument], [validChunk]);
    await serverAService.dispose();
  });

  it('rejects NFKC-expanded over-limit queries before engine work or circuit accounting', async () => {
    const engine = {
      replaceSnapshot: vi.fn(),
      search: vi.fn(async (searchRequest: KnowledgeSearchRequest) => ({
        ok: true as const,
        requestId: searchRequest.requestId,
        availability: 'ready' as const,
        normalizedQuery: normalizeKnowledgeSearchText(searchRequest.query),
        results: [],
      })),
    };
    const service = new KnowledgeSearchService({
      cache: cacheWith([readyDocument], [validChunk]) as never,
      cacheIdentity: SERVER_URL,
      engine: engine as never,
    });
    await service.start(null);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(
        service.search(request('\uFDFA'.repeat(8), `expanded-${attempt}`)),
      ).resolves.toEqual({
        ok: false,
        requestId: `expanded-${attempt}`,
        error: 'invalid-query',
      });
    }
    expect(engine.search).not.toHaveBeenCalled();
    await expect(
      service.search(request('failover', 'valid-after-expansion')),
    ).resolves.toMatchObject({
      ok: true,
    });
    expect(engine.search).toHaveBeenCalledOnce();
  });

  it('contains cache, fetch, and subscription failures while preserving a cached snapshot', async () => {
    const cache = cacheWith([readyDocument], [validChunk]);
    cache.writeCollection.mockImplementation(() => {
      throw new Error('cache unavailable');
    });
    const network = pbWith([readyDocument], [validChunk]);
    network.chunkCollection.subscribe.mockRejectedValueOnce(new Error('subscribe unavailable'));
    const service = new KnowledgeSearchService({
      cache: cache as never,
      cacheIdentity: SERVER_URL,
    });

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
      cacheIdentity: SERVER_URL,
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

  it('subscribes before fetching and replays mutations that arrive during the initial snapshot', async () => {
    const network = pbWith([readyDocument], [validChunk]);
    network.documentCollection.getFullList.mockImplementationOnce(async () => {
      network.emitDocument('delete', readyDocument);
      return [readyDocument];
    });
    const service = new KnowledgeSearchService({ engine: new KnowledgeSearchEngine() });

    await service.start(network.pb as never);

    expect(network.documentCollection.subscribe.mock.invocationCallOrder[0]).toBeLessThan(
      network.documentCollection.getFullList.mock.invocationCallOrder[0] as number,
    );
    await expect(service.search(request('failover'))).resolves.toMatchObject({
      ok: true,
      results: [],
    });
  });

  it('buffers delete, trash, and metadata updates racing a reconciliation snapshot', async () => {
    const cases = [
      { action: 'delete', record: readyDocument, expectedTitle: null },
      {
        action: 'update',
        record: {
          ...readyDocument,
          lifecycleState: 'trashed',
          trashedByAccountId: 'account1',
          trashedByName: 'Operator',
          trashedAt: '2026-07-19T18:00:00.000Z',
        },
        expectedTitle: null,
      },
      {
        action: 'update',
        record: { ...readyDocument, title: 'Updated during reconcile' },
        expectedTitle: 'Updated during reconcile',
      },
    ] as const;

    for (const testCase of cases) {
      const network = pbWith([readyDocument], [validChunk]);
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
      const service = new KnowledgeSearchService({ engine: engine as never });
      await service.start(network.pb as never);
      const documents = deferred<unknown[]>();
      const chunks = deferred<unknown[]>();
      network.documentCollection.getFullList.mockImplementationOnce(() => documents.promise);
      network.chunkCollection.getFullList.mockImplementationOnce(() => chunks.promise);

      network.disconnect();
      await vi.waitFor(() =>
        expect(network.documentCollection.getFullList).toHaveBeenCalledTimes(2),
      );
      network.emitDocument(testCase.action, testCase.record as never);
      documents.resolve([readyDocument]);
      chunks.resolve([validChunk]);
      await vi.waitFor(() => expect(engine.replaceSnapshot).toHaveBeenCalledTimes(2));

      const [publishedDocuments, publishedChunks] = engine.replaceSnapshot.mock.calls.at(-1)!;
      if (testCase.expectedTitle === null) {
        expect(publishedDocuments).toEqual([]);
        expect(publishedChunks).toEqual([]);
      } else {
        expect(publishedDocuments).toEqual([
          expect.objectContaining({ title: testCase.expectedTitle }),
        ]);
      }
      await service.dispose();
    }
  });

  it('does not let an older reconnect generation overwrite the current connection', async () => {
    const oldDocument = { ...readyDocument, title: 'Old server title' };
    const newDocument = { ...readyDocument, title: 'Current server title' };
    const oldNetwork = pbWith([], []);
    const newNetwork = pbWith([newDocument], [validChunk]);
    const oldDocuments = deferred<unknown[]>();
    const oldChunks = deferred<unknown[]>();
    oldNetwork.documentCollection.getFullList.mockImplementationOnce(() => oldDocuments.promise);
    oldNetwork.chunkCollection.getFullList.mockImplementationOnce(() => oldChunks.promise);
    const engine = {
      replaceSnapshot: vi.fn(),
      upsertDocument: vi.fn(),
      removeDocument: vi.fn(),
      upsertChunk: vi.fn(),
      removeChunk: vi.fn(),
      search: vi.fn(),
    };
    const service = new KnowledgeSearchService({ engine: engine as never });

    const oldConnect = service.connect(oldNetwork.pb as never);
    await vi.waitFor(() =>
      expect(oldNetwork.documentCollection.getFullList).toHaveBeenCalledOnce(),
    );
    const currentConnect = service.connect(newNetwork.pb as never);
    await currentConnect;
    oldDocuments.resolve([oldDocument]);
    oldChunks.resolve([validChunk]);
    await oldConnect;

    expect(engine.replaceSnapshot.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ title: 'Current server title' }),
    ]);
    await service.dispose();
  });

  it('never republishes or caches a reconciliation that finishes after dispose', async () => {
    const cache = cacheWith([], [], null);
    const network = pbWith([readyDocument], [validChunk]);
    const engine = {
      replaceSnapshot: vi.fn(),
      upsertDocument: vi.fn(),
      removeDocument: vi.fn(),
      upsertChunk: vi.fn(),
      removeChunk: vi.fn(),
      search: vi.fn(),
    };
    const service = new KnowledgeSearchService({
      cache: cache as never,
      cacheIdentity: SERVER_URL,
      engine: engine as never,
    });
    await service.start(network.pb as never);
    cache.writeCollection.mockClear();
    const documents = deferred<unknown[]>();
    const chunks = deferred<unknown[]>();
    network.documentCollection.getFullList.mockImplementationOnce(() => documents.promise);
    network.chunkCollection.getFullList.mockImplementationOnce(() => chunks.promise);
    network.disconnect();
    await vi.waitFor(() => expect(network.documentCollection.getFullList).toHaveBeenCalledTimes(2));

    await service.dispose();
    const publicationsAtDispose = engine.replaceSnapshot.mock.calls.length;
    documents.resolve([readyDocument]);
    chunks.resolve([validChunk]);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(engine.replaceSnapshot).toHaveBeenCalledTimes(publicationsAtDispose);
    expect(engine.replaceSnapshot).toHaveBeenLastCalledWith([], []);
    expect(cache.writeCollection).not.toHaveBeenCalled();
    await expect(service.search(request('failover', 'after-dispose'))).resolves.toMatchObject({
      ok: false,
      error: 'unavailable',
    });
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

  it('excludes snapshot chunks whose page exceeds the document page count', async () => {
    const pageTwoChunk = knowledgeSearchFixtureChunk(readyDocument, 'Out of range passage', {
      id: 'chunk-page-two',
      pageNumber: 2,
    });
    const engine = {
      replaceSnapshot: vi.fn(),
      upsertDocument: vi.fn(),
      removeDocument: vi.fn(),
      upsertChunk: vi.fn(),
      removeChunk: vi.fn(),
      search: vi.fn(),
    };
    const service = new KnowledgeSearchService({ engine: engine as never });

    await service.start(pbWith([readyDocument], [pageTwoChunk]).pb as never);

    expect(engine.replaceSnapshot).toHaveBeenCalledWith([readyDocument], []);
    await service.dispose();
  });

  it('enforces page-count eligibility for realtime chunks before and after documents arrive', async () => {
    const pageTwoChunk = knowledgeSearchFixtureChunk(readyDocument, 'Page two passage', {
      id: 'chunk-page-two',
      pageNumber: 2,
    });
    const engine = {
      replaceSnapshot: vi.fn(),
      upsertDocument: vi.fn(),
      removeDocument: vi.fn(),
      upsertChunk: vi.fn(),
      removeChunk: vi.fn(),
      search: vi.fn(),
    };
    const network = pbWith([], []);
    const service = new KnowledgeSearchService({ engine: engine as never });
    await service.start(network.pb as never);

    network.emitChunk('create', pageTwoChunk);
    expect(engine.upsertChunk).not.toHaveBeenCalled();
    network.emitDocument('create', readyDocument);
    expect(engine.upsertChunk).not.toHaveBeenCalled();
    network.emitDocument('update', { ...readyDocument, pageCount: 2 });
    expect(engine.upsertChunk).toHaveBeenCalledWith(pageTwoChunk);
    network.emitDocument('update', readyDocument);
    expect(engine.removeChunk).toHaveBeenCalledWith(pageTwoChunk.id);
    await service.dispose();
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
      cacheIdentity: SERVER_URL,
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
      cacheIdentity: SERVER_URL,
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

  it('keeps cancellation ownership isolated when a request id is replaced', async () => {
    const searches = [deferred<never>(), deferred<never>()];
    const contexts: Array<{ isCancelled: () => boolean }> = [];
    const service = new KnowledgeSearchService({
      cache: cacheWith([readyDocument], [validChunk]) as never,
      cacheIdentity: SERVER_URL,
      engine: {
        replaceSnapshot: vi.fn(),
        search: vi.fn((_searchRequest, context) => {
          contexts.push(context);
          return searches[contexts.length - 1]!.promise;
        }),
      } as never,
    });
    await service.start(null);

    const first = service.search(request('failover', 'same-request'));
    const replacement = service.search(request('recovery', 'same-request'));
    await expect(first).resolves.toMatchObject({ ok: false, error: 'cancelled' });
    expect(contexts[0]!.isCancelled()).toBe(true);
    expect(contexts[1]!.isCancelled()).toBe(false);

    service.cancel('same-request');
    expect(contexts[1]!.isCancelled()).toBe(true);
    await expect(replacement).resolves.toMatchObject({ ok: false, error: 'cancelled' });
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
      cacheIdentity: SERVER_URL,
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

  it('bounds hung unsubscribers during shutdown', async () => {
    vi.useFakeTimers();
    const network = pbWith([readyDocument], [validChunk]);
    network.unsubscribeDocuments.mockImplementation(() => new Promise(() => undefined));
    network.unsubscribeChunks.mockImplementation(() => new Promise(() => undefined));
    const service = new KnowledgeSearchService({ engine: new KnowledgeSearchEngine() });
    await service.start(network.pb as never);

    const shutdown = service.dispose();
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(shutdown).resolves.toBeUndefined();
  });

  it('cleans up a subscription that resolves after the service is disposed', async () => {
    vi.useFakeTimers();
    const lateSubscription = deferred<() => Promise<void>>();
    const lateUnsubscribe = vi.fn(async () => undefined);
    const network = pbWith([readyDocument], [validChunk]);
    network.documentCollection.subscribe.mockImplementationOnce(() => lateSubscription.promise);
    const service = new KnowledgeSearchService({ engine: new KnowledgeSearchEngine() });

    const startup = service.start(network.pb as never);
    await vi.waitFor(() => expect(network.documentCollection.subscribe).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(startup).resolves.toBeUndefined();
    const shutdown = service.dispose();
    lateSubscription.resolve(lateUnsubscribe);
    await vi.runAllTimersAsync();

    await expect(shutdown).resolves.toBeUndefined();
    await vi.waitFor(() => expect(lateUnsubscribe).toHaveBeenCalledOnce());
    expect(network.chunkCollection.subscribe).not.toHaveBeenCalled();
    expect(network.pb.realtime.onDisconnect).toBeNull();
  });
});
