import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '@shared/ipc';
import { KNOWLEDGE_DOCUMENTS_COLLECTION, type KnowledgeDocumentRecord } from '@shared/knowledge';
import {
  KNOWLEDGE_SEARCH_CHUNKS_COLLECTION,
  type KnowledgeSearchChunkRecord,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResponse,
} from '@shared/knowledgeSearch';
import {
  knowledgeSearchFixtureChunk,
  knowledgeSearchFixtureDocument,
} from '../__fixtures__/knowledgeSearchRelevance';
import { KnowledgeExtractorWorker } from '../KnowledgeExtractorWorker';
import { KnowledgePdfService } from '../KnowledgePdfService';
import { KnowledgeSearchIndexer, type KnowledgeSearchStoragePort } from '../KnowledgeSearchIndexer';
import { KnowledgeSearchService } from '../KnowledgeSearchService';
import { registerKnowledgeManagementCommands } from '../registerKnowledgeManagementCommands';
import { setupKnowledgeHandlers } from '../../handlers/knowledgeHandlers';

const mocks = vi.hoisted(() => {
  const authWithPassword = vi.fn(async () => ({}));
  const fallbackCollection = vi.fn(() => ({
    authWithPassword,
    getFirstListItem: vi.fn().mockRejectedValue(new Error('missing')),
    delete: vi.fn().mockResolvedValue({}),
    create: vi.fn().mockResolvedValue({}),
  }));
  const pbProcess = {
    isRunning: vi.fn(() => false),
    stop: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    getUrl: vi.fn(() => ['http', '://0.0.0.0:8090'].join('')),
    getLocalUrl: vi.fn(() => ['http', '://127.0.0.1:8090'].join('')),
    onCrash: vi.fn(),
  };
  let activePb: unknown = null;
  let searchService: KnowledgeSearchService | null = null;
  return {
    app: { isPackaged: true },
    authWithPassword,
    fetch: vi.fn().mockResolvedValue({ status: 401 }),
    fallbackCollection,
    pbProcess,
    ensurePocketBaseAuthRateLimit: vi.fn().mockResolvedValue(undefined),
    ensureKnowledgeBatchApi: vi.fn().mockResolvedValue(undefined),
    ensureCollections: vi.fn().mockResolvedValue({ privilegedRuntimeReady: true }),
    ensureKnowledgeSearchCollections: vi.fn().mockResolvedValue(undefined),
    getAppConfig: vi.fn(),
    getActivePb: () => activePb,
    setActivePb: (pb: unknown) => {
      activePb = pb;
    },
    getKnowledgeSearchService: vi.fn(() => searchService),
    setKnowledgeSearchService: vi.fn((service: KnowledgeSearchService | null) => {
      searchService = service;
    }),
    resetSearchService: () => {
      searchService = null;
    },
    getCapturedSearchService: () => searchService,
    ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
    ipcListeners: new Map<string, (...args: unknown[]) => unknown>(),
    warn: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: mocks.app,
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.ipcHandlers.set(channel, handler);
    }),
    on: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.ipcListeners.set(channel, handler);
    }),
  },
  shell: { openExternal: vi.fn() },
}));

vi.mock('node:fs', () => ({
  chmodSync: vi.fn(),
  existsSync: vi.fn((path) => String(path).endsWith('relay_privileged_reauth.pb.js')),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('pocketbase', () => ({
  default: vi.fn(function MockPocketBase() {
    return mocks.getActivePb() ?? { collection: mocks.fallbackCollection };
  }),
}));
vi.mock('../../app/appState', () => ({
  getAppConfig: mocks.getAppConfig,
  getKnowledgeSearchService: mocks.getKnowledgeSearchService,
  getOfflineCache: vi.fn(() => null),
  getPbClient: vi.fn(() => null),
  setKnowledgeSearchService: mocks.setKnowledgeSearchService,
  getPbProcess: vi.fn(() => null),
  setPbProcess: vi.fn(),
  getRetentionManager: vi.fn(() => null),
  setRetentionManager: vi.fn(),
  setBackupManager: vi.fn(),
  setPbClient: vi.fn(),
}));
vi.mock('../../pocketbase/PocketBaseProcess', () => ({
  PocketBaseProcess: vi.fn(function MockPocketBaseProcess() {
    return mocks.pbProcess;
  }),
}));
vi.mock('../../pocketbase/binaryPath', () => ({
  getPocketBaseBinaryName: vi.fn(() => 'pocketbase'),
  getPocketBaseBinaryPath: vi.fn(() => '/Applications/Relay/pocketbase'),
}));
vi.mock('../../pocketbase/BackupManager', () => ({
  BackupManager: vi.fn(function MockBackupManager() {
    return { setPocketBase: vi.fn(), backupIfDue: vi.fn().mockResolvedValue(null) };
  }),
}));
vi.mock('../../pocketbase/RetentionManager', () => ({
  RetentionManager: vi.fn(function MockRetentionManager() {
    return { startSchedule: vi.fn(), stop: vi.fn() };
  }),
}));
vi.mock('../../pocketbase/CollectionBootstrap', () => ({
  ensurePocketBaseAuthRateLimit: mocks.ensurePocketBaseAuthRateLimit,
  ensureKnowledgeBatchApi: mocks.ensureKnowledgeBatchApi,
  ensureCollections: mocks.ensureCollections,
  ensureKnowledgeSearchCollections: mocks.ensureKnowledgeSearchCollections,
}));
vi.mock('../../pocketbase/RelayAppUserAuthCoordinator', () => ({
  authenticateRelayAppUserShared: async (
    client: {
      collection(name: string): {
        authWithPassword(
          email: string,
          secret: string,
          options: { requestKey: null; signal?: AbortSignal },
        ): Promise<unknown>;
      };
    },
    _serverUrl: string,
    secret: string,
    options: { signal?: AbortSignal } = {},
  ) =>
    client.collection('_pb_users_auth_').authWithPassword('relay@relay.app', secret, {
      requestKey: null,
      signal: options.signal,
    }),
  clearRelayAppUserAuthCoordinator: vi.fn(),
  primeRelayAppUserAuth: vi.fn(),
}));
vi.mock('../../utils/broadcastToAllWindows', () => ({ broadcastToAllWindows: vi.fn() }));
vi.mock('../../discovery/RelayDiscovery', () => ({
  startAdvertising: vi.fn(),
  stopAdvertising: vi.fn(),
}));
vi.mock('../../app/relaunch', () => ({ requestAppRelaunch: vi.fn() }));
vi.mock('../../utils/trustedSender', () => ({ assertTrustedIpcSender: vi.fn(() => true) }));
vi.mock('../../rateLimiter', () => ({
  rateLimiters: { fsOperations: { tryConsume: vi.fn(() => ({ allowed: true })) } },
}));
vi.mock('../../logger', () => ({
  loggers: {
    main: { info: vi.fn(), warn: mocks.warn, error: vi.fn() },
    knowledge: { info: vi.fn(), warn: mocks.warn, error: vi.fn() },
    pocketbase: { info: vi.fn(), warn: mocks.warn, error: vi.fn() },
    ipc: { info: vi.fn(), warn: mocks.warn, error: vi.fn() },
    security: { info: vi.fn(), warn: mocks.warn, error: vi.fn() },
  },
}));

vi.stubGlobal('fetch', mocks.fetch);
Object.defineProperty(process, 'resourcesPath', {
  configurable: true,
  value: '/Applications/Relay/resources',
});

type FaultName =
  | 'optional-bootstrap'
  | 'search-auth'
  | 'collection-fetch'
  | 'chunk-validation'
  | 'cache-read'
  | 'cache-write'
  | 'worker-timeout'
  | 'worker-exit'
  | 'chunk-batch'
  | 'status-update'
  | 'subscription-drop'
  | 'ranking-timeout'
  | 'cancellation'
  | 'ipc-handler';

const CACHE_IDENTITY = 'https://relay.example.com';
const BASE_PDF = new TextEncoder().encode('%PDF-primary-failover');
const BASE_CHECKSUM = createHash('sha256').update(BASE_PDF).digest('hex');
const readyDocument = knowledgeSearchFixtureDocument({
  id: 'document1',
  title: 'Failover Guide',
  category: 'Operations',
  categoryId: 'operations',
  checksum: BASE_CHECKSUM,
  byteSize: BASE_PDF.byteLength,
  pdf: 'failover.pdf',
  searchIndexChecksum: BASE_CHECKSUM,
});
const validChunk = knowledgeSearchFixtureChunk(readyDocument, 'Primary failover procedure', {
  id: 'chunk1',
});

function request(requestId: string): KnowledgeSearchRequest {
  return {
    requestId,
    query: 'failover',
    scope: { kind: 'all' },
    categoryId: null,
    documentType: null,
    limit: 20,
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

class SharedSearchCache {
  readonly documents = new Map([[readyDocument.id, clone(readyDocument)]]);
  readonly chunks = new Map([[validChunk.id, clone(validChunk)]]);
  private marker = true;

  constructor(private readonly fault: FaultName) {}

  hasKnowledgeSearchSnapshotFor(identity: string): boolean {
    return this.marker && identity === CACHE_IDENTITY;
  }

  readCollection(name: string): Record<string, unknown>[] {
    if (this.fault === 'cache-read') throw new Error('cache-read-secret');
    const records = name === KNOWLEDGE_DOCUMENTS_COLLECTION ? this.documents : this.chunks;
    return [...records.values()].map((record) => clone(record)) as unknown as Record<
      string,
      unknown
    >[];
  }

  clearKnowledgeSearchSnapshotMarker(): boolean {
    this.marker = false;
    return true;
  }

  writeCollection(name: string, records: Record<string, unknown>[]): boolean {
    if (this.fault === 'cache-write') throw new Error('cache-write-secret');
    const target = name === KNOWLEDGE_DOCUMENTS_COLLECTION ? this.documents : this.chunks;
    target.clear();
    for (const record of records) target.set(String(record.id), clone(record) as never);
    return true;
  }

  setKnowledgeSearchSnapshotMarker(identity: string): boolean {
    this.marker = identity === CACHE_IDENTITY;
    return this.marker;
  }

  updateRecord(name: string, action: string, record: Record<string, unknown>): boolean {
    const target = name === KNOWLEDGE_DOCUMENTS_COLLECTION ? this.documents : this.chunks;
    const id = String(record.id);
    if (action === 'delete') target.delete(id);
    else target.set(id, clone(record) as never);
    return true;
  }
}

type RealtimeEvent = { action: 'create' | 'update' | 'delete'; record: unknown };

class SharedKnowledgeStorage implements KnowledgeSearchStoragePort {
  readonly documents = new Map([[readyDocument.id, clone(readyDocument)]]);
  readonly chunks = new Map([[validChunk.id, clone(validChunk)]]);
  readonly documentUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  readonly batchSends = vi.fn();
  readonly realtime = { onDisconnect: null as ((subscriptions: string[]) => void) | null };
  readonly authStore = { isValid: true };
  readonly health = { check: vi.fn(async () => ({})) };
  readonly files = {
    getToken: vi.fn(async () => 'token'),
    getURL: vi.fn(() => 'https://relay.example.com/api/files/document.pdf'),
  };
  failDocumentFetches = 0;
  duplicateDocumentsOnce = false;
  failBatchSends = 0;
  failReadyStatusUpdates = 0;
  private readonly subscribers = new Map<string, Set<(event: RealtimeEvent) => void>>();
  private nextChunkId = 1;

  collection(name: string): ReturnType<SharedKnowledgeStorage['searchCollection']> {
    if (name === '_pb_users_auth_' || name === '_superusers') {
      return {
        ...this.searchCollection(name),
        authWithPassword: mocks.authWithPassword,
        getFirstListItem: vi.fn().mockRejectedValue(new Error('missing')),
        create: vi.fn(async () => ({})),
      } as never;
    }
    return this.searchCollection(name);
  }

  createBatch() {
    const creates: Array<Record<string, unknown>> = [];
    return {
      collection: (name: string) => {
        if (name !== KNOWLEDGE_SEARCH_CHUNKS_COLLECTION) throw new Error('unexpected-collection');
        return { create: (record: Record<string, unknown>) => creates.push(clone(record)) };
      },
      send: async () => {
        this.batchSends(creates.length);
        if (this.failBatchSends > 0) {
          this.failBatchSends -= 1;
          throw new Error('chunk-batch-secret');
        }
        const results: Array<{ status: number; body: unknown }> = [];
        for (const create of creates) {
          const id = `managedchunk${this.nextChunkId++}`;
          const record = {
            id,
            ...create,
            created: String(create.indexedAt),
            updated: String(create.indexedAt),
          } as KnowledgeSearchChunkRecord;
          this.chunks.set(id, clone(record));
          this.emit(KNOWLEDGE_SEARCH_CHUNKS_COLLECTION, 'create', record);
          results.push({ status: 200, body: {} });
        }
        return results;
      },
    };
  }

  upsertDocument(record: KnowledgeDocumentRecord): void {
    const action = this.documents.has(record.id) ? 'update' : 'create';
    this.documents.set(record.id, clone(record));
    this.emit(KNOWLEDGE_DOCUMENTS_COLLECTION, action, record);
  }

  disconnect(): void {
    this.realtime.onDisconnect?.([
      KNOWLEDGE_DOCUMENTS_COLLECTION,
      KNOWLEDGE_SEARCH_CHUNKS_COLLECTION,
    ]);
  }

  private searchCollection(name: string) {
    const records = name === KNOWLEDGE_DOCUMENTS_COLLECTION ? this.documents : this.chunks;
    return {
      getFullList: async (options?: Record<string, unknown>) => {
        if (name === KNOWLEDGE_DOCUMENTS_COLLECTION && this.failDocumentFetches > 0) {
          this.failDocumentFetches -= 1;
          throw new Error('document-fetch-secret');
        }
        let result = [...records.values()];
        const filter = typeof options?.filter === 'string' ? options.filter : '';
        const documentId = /documentId = "([A-Za-z0-9]+)"/.exec(filter)?.[1];
        if (documentId) {
          result = result.filter(
            (record) =>
              'documentId' in record &&
              (record as KnowledgeSearchChunkRecord).documentId === documentId,
          );
        }
        if (name === KNOWLEDGE_DOCUMENTS_COLLECTION && this.duplicateDocumentsOnce) {
          this.duplicateDocumentsOnce = false;
          return result.length > 0 ? [...result, result[0]].map((record) => clone(record)) : [];
        }
        return result.map((record) => clone(record));
      },
      getOne: async (id: string) => {
        const record = records.get(id);
        if (!record) throw new Error('record-not-found');
        return clone(record);
      },
      update: async (id: string, patch: Record<string, unknown>) => {
        const current = records.get(id);
        if (!current) throw new Error('record-not-found');
        if (
          name === KNOWLEDGE_DOCUMENTS_COLLECTION &&
          patch.searchIndexState === 'ready' &&
          this.failReadyStatusUpdates > 0
        ) {
          this.failReadyStatusUpdates -= 1;
          throw new Error('status-update-secret');
        }
        const normalizedPatch =
          patch.searchIndexError === '' ? { ...patch, searchIndexError: null } : patch;
        const updated = { ...current, ...normalizedPatch };
        records.set(id, updated as never);
        this.documentUpdates.push({ id, patch: clone(patch) });
        this.emit(name, 'update', updated);
        return clone(updated);
      },
      delete: async (id: string) => {
        const current = records.get(id);
        records.delete(id);
        if (current) this.emit(name, 'delete', current);
        return true;
      },
      subscribe: async (_topic: string, callback: (event: RealtimeEvent) => void) => {
        const subscribers = this.subscribers.get(name) ?? new Set();
        subscribers.add(callback);
        this.subscribers.set(name, subscribers);
        return () => subscribers.delete(callback);
      },
    };
  }

  private emit(name: string, action: RealtimeEvent['action'], record: unknown): void {
    for (const subscriber of this.subscribers.get(name) ?? []) {
      subscriber({ action, record: clone(record) });
    }
  }
}

type WorkerMessage = { id: number; kind: 'search'; data: ArrayBuffer };

class ScriptedWorker {
  private readonly listeners = new Map<string, (...args: never[]) => void>();
  readonly terminate = vi.fn(async () => 1);

  constructor(private readonly behavior: 'timeout' | 'exit' | 'success') {}

  on(event: string, listener: (...args: never[]) => void): this {
    this.listeners.set(event, listener);
    return this;
  }

  postMessage(message: WorkerMessage): void {
    if (this.behavior === 'timeout') return;
    if (this.behavior === 'exit') {
      queueMicrotask(() => this.listeners.get('exit')?.(1 as never));
      return;
    }
    queueMicrotask(() =>
      this.listeners.get('message')?.({
        id: message.id,
        kind: message.kind,
        ok: true,
        result: [
          {
            pageNumber: 1,
            items: [
              {
                str: 'Managed failover recovery procedure',
                hasEOL: false,
                transform: [1, 0, 0, 1, 0, 0],
              },
            ],
          },
        ],
      } as never),
    );
  }
}

function searchEngineFor(fault: FaultName) {
  const base = {
    replaceSnapshot: vi.fn(),
    upsertDocument: vi.fn(),
    removeDocument: vi.fn(),
    upsertChunk: vi.fn(),
    removeChunk: vi.fn(),
  };
  if (fault === 'ranking-timeout' || fault === 'cancellation') {
    return { ...base, search: vi.fn(() => new Promise<never>(() => undefined)) };
  }
  if (fault === 'ipc-handler') {
    return {
      ...base,
      search: vi.fn(async () => {
        throw new Error('ipc-engine-secret');
      }),
    };
  }
  return undefined;
}

type CommandHandler = (context: unknown, payload: unknown) => Promise<unknown>;

class ConnectedHarness {
  readonly storage = new SharedKnowledgeStorage();
  readonly cache: SharedSearchCache;
  readonly service: KnowledgeSearchService;
  readonly indexer: KnowledgeSearchIndexer;
  readonly handlers = new Map<string, CommandHandler>();
  readonly pdfBytes = new Map<string, Uint8Array>([[readyDocument.id, BASE_PDF]]);
  readonly management = {
    snapshot: vi.fn(async () => ({ mode: 'managed' })),
    publish: vi.fn(async () => this.mutateDocument('manageddocument', 'publish')),
    replace: vi.fn(async () => this.mutateDocument('manageddocument', 'replace')),
    restore: vi.fn(async () => this.mutateDocument('manageddocument', 'restore')),
    setTitle: vi.fn(),
    setCategory: vi.fn(),
    renameCategory: vi.fn(),
    createCategory: vi.fn(),
    setCategoryName: vi.fn(),
    setCategoryOrder: vi.fn(),
    deleteCategory: vi.fn(),
    setDocumentMetadata: vi.fn(),
    assignDocumentCategories: vi.fn(),
    trash: vi.fn(),
    deletePermanently: vi.fn(),
    readAudit: vi.fn(),
  };
  readonly context = {
    requestId: 'connected-publish',
    account: { id: 'account1', displayName: 'Operator' },
    device: { deviceId: 'device1' },
    role: 'publisher' as const,
  };
  readonly rootPromise = mkdtemp(join(tmpdir(), 'relay-task-13-connected-'));
  private readonly registration: { dispose(): Promise<void> };
  private mutationNumber = 0;

  constructor(
    readonly fault: FaultName,
    options: { firstEnqueueResult?: Promise<void> } = {},
  ) {
    this.cache = new SharedSearchCache(fault);
    const engine = searchEngineFor(fault);
    this.service = new KnowledgeSearchService({
      cache: this.cache as never,
      cacheIdentity: CACHE_IDENTITY,
      ...(engine ? { engine } : {}),
    });

    let workerNumber = 0;
    const workerFault = fault === 'worker-timeout' || fault === 'worker-exit';
    const extractor = workerFault
      ? new KnowledgeExtractorWorker({
          timeoutMs: 5,
          createWorker: () => {
            workerNumber += 1;
            let firstBehavior: 'timeout' | 'exit' = 'exit';
            if (fault === 'worker-timeout') firstBehavior = 'timeout';
            const behavior = workerNumber === 1 ? firstBehavior : 'success';
            return new ScriptedWorker(behavior) as never;
          },
        })
      : {
          extractSearchPages: vi.fn(async () => [
            {
              pageNumber: 1,
              items: [
                {
                  str: 'Managed failover recovery procedure',
                  hasEOL: false,
                  transform: [1, 0, 0, 1, 0, 0],
                },
              ],
            },
          ]),
          stop: vi.fn(async () => undefined),
        };
    this.indexer = new KnowledgeSearchIndexer({
      pb: this.storage,
      extractor,
      readPdf: async (document) => {
        const bytes = this.pdfBytes.get(document.id);
        if (!bytes) throw new Error('protected-pdf-unavailable');
        return bytes.slice();
      },
      now: () => Date.parse('2026-07-19T12:00:00.000Z') + this.mutationNumber,
    });

    if (fault === 'chunk-batch') this.storage.failBatchSends = 1;
    if (fault === 'status-update') this.storage.failReadyStatusUpdates = 1;

    let firstEnqueue = options.firstEnqueueResult !== undefined;
    const searchIndexer = options.firstEnqueueResult
      ? {
          enqueue: (documentId: string) => {
            if (firstEnqueue) {
              firstEnqueue = false;
              return options.firstEnqueueResult;
            }
            return this.indexer.enqueue(documentId);
          },
          recordTriggerFailure: this.indexer.recordTriggerFailure.bind(this.indexer),
          retry: this.indexer.retry.bind(this.indexer),
          remove: this.indexer.remove.bind(this.indexer),
          dispose: this.indexer.dispose.bind(this.indexer),
        }
      : this.indexer;
    this.registration = registerKnowledgeManagementCommands({
      registrar: {
        registerCommand: (name: string, _capability: string, handler: never) => {
          this.handlers.set(name, handler);
        },
      } as never,
      pb: this.storage as never,
      service: this.management as never,
      searchIndexer: searchIndexer as never,
      uploadCoordinator: {
        beginBatch: vi.fn(),
        beginFile: vi.fn(),
        status: vi.fn(),
        finalize: vi.fn(),
        cancelFile: vi.fn(),
        cancelBatch: vi.fn(),
        dispose: vi.fn(),
      },
      extractor: { extract: vi.fn(), stop: vi.fn() },
    });
    mocks.setActivePb(this.storage);
  }

  async start(): Promise<void> {
    if (this.fault === 'optional-bootstrap') {
      vi.useFakeTimers();
      mocks.ensureKnowledgeSearchCollections.mockRejectedValue(
        new Error('optional-storage-secret'),
      );
      const { initializeOptionalKnowledgeSearch, startPocketBase } =
        await import('../../app/pocketbaseBootstrap');
      await expect(
        startPocketBase(
          { mode: 'server', bindHost: '0.0.0.0', port: 8090, secret: 'secret' },
          join(process.cwd(), '.task-13-fixture'),
        ),
      ).resolves.toEqual({ status: 'started', privilegedRuntimeReady: true });
      const optionalBootstrap = initializeOptionalKnowledgeSearch(this.storage as never);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(optionalBootstrap).resolves.toBe(false);
      expect(mocks.ensureKnowledgeSearchCollections).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
      await this.service.start(null);
      return;
    }
    if (this.fault === 'search-auth') {
      mocks.getAppConfig.mockReturnValue({
        load: () => ({ mode: 'client', serverUrl: CACHE_IDENTITY, secret: 'secret' }),
      });
      mocks.authWithPassword.mockRejectedValueOnce(new Error('search-auth-secret'));
      const runtime = await import('../knowledgeSearchRuntime');
      await expect(runtime.restartKnowledgeSearchRuntime()).resolves.toBeUndefined();
      expect(mocks.getCapturedSearchService()).not.toBeNull();
      return;
    }
    if (this.fault === 'collection-fetch') this.storage.failDocumentFetches = 1;
    if (this.fault === 'chunk-validation') this.storage.duplicateDocumentsOnce = true;
    await this.service.start(this.storage as never);
    if (this.fault === 'subscription-drop') {
      this.storage.failDocumentFetches = 1;
      this.storage.disconnect();
      await vi.waitFor(() => expect(this.storage.failDocumentFetches).toBe(0));
    }
  }

  async exerciseCoreCommands(): Promise<{
    firstState: KnowledgeDocumentRecord['searchIndexState'];
    finalDocument: KnowledgeDocumentRecord;
  }> {
    const publish = (await this.handlers.get('knowledge.document.publish')!(this.context, {
      uploadId: 'upload1',
      title: 'Managed Failover',
      category: 'Operations',
    })) as KnowledgeDocumentRecord;
    await this.indexer.whenIdleForTest();
    const firstState = this.storage.documents.get(publish.id)?.searchIndexState ?? 'pending';

    const replace = (await this.handlers.get('knowledge.document.replace')!(
      { ...this.context, requestId: 'connected-replace' },
      {
        uploadId: 'upload2',
        documentId: publish.id,
        expectedRevision: publish.revision,
      },
    )) as KnowledgeDocumentRecord;
    await this.indexer.whenIdleForTest();

    const restored = (await this.handlers.get('knowledge.document.restore')!(
      { ...this.context, requestId: 'connected-restore' },
      { documentId: replace.id, expectedRevision: replace.revision },
    )) as KnowledgeDocumentRecord;
    await this.indexer.whenIdleForTest();
    const finalDocument = this.storage.documents.get(restored.id)!;

    expect(this.management.publish).toHaveBeenCalledTimes(1);
    expect(this.management.replace).toHaveBeenCalledTimes(1);
    expect(this.management.restore).toHaveBeenCalledTimes(1);
    expect(finalDocument).toMatchObject({ lifecycleState: 'active', searchIndexState: 'ready' });
    return { firstState, finalDocument };
  }

  async search(): Promise<KnowledgeSearchResponse> {
    if (this.fault === 'search-auth') {
      return mocks.getCapturedSearchService()!.search(request(this.fault));
    }
    if (this.fault === 'ranking-timeout') {
      vi.useFakeTimers();
      const result = this.service.search(request(this.fault));
      await vi.advanceTimersByTimeAsync(1_000);
      const response = await result;
      vi.useRealTimers();
      return response;
    }
    if (this.fault === 'cancellation') {
      const result = this.service.search(request(this.fault));
      this.service.cancel(this.fault);
      return result;
    }
    if (this.fault === 'ipc-handler') {
      setupKnowledgeHandlers(
        () => null,
        () => null,
        () => null,
        () => null,
        () => this.service,
      );
      const handler = mocks.ipcHandlers.get(IPC_CHANNELS.KNOWLEDGE_SEARCH);
      expect(handler).toBeTypeOf('function');
      return (await handler!({}, request(this.fault))) as KnowledgeSearchResponse;
    }
    return this.service.search(request(this.fault));
  }

  async assertOpenUsesSharedIdentity(document: KnowledgeDocumentRecord): Promise<void> {
    const root = await this.rootPromise;
    const pdfService = new KnowledgePdfService({
      configDataDir: root,
      getConfig: () => ({ mode: 'client', serverUrl: CACHE_IDENTITY, secret: 'secret' }),
      getPbClient: () => this.storage as never,
    });
    await expect(
      pdfService.getPdf({ documentId: document.id, checksum: document.checksum }),
    ).resolves.toMatchObject({ ok: true, source: 'cache' });
  }

  async dispose(): Promise<void> {
    const runtime = await import('../knowledgeSearchRuntime');
    if (this.fault === 'search-auth') await runtime.stopKnowledgeSearchRuntime();
    await this.registration.dispose();
    await this.indexer.dispose();
    await this.service.dispose();
    await rm(await this.rootPromise, { recursive: true, force: true });
  }

  private async mutateDocument(
    id: string,
    operation: 'publish' | 'replace' | 'restore',
  ): Promise<KnowledgeDocumentRecord> {
    this.mutationNumber += 1;
    const bytes = new TextEncoder().encode(`%PDF-${operation}-${this.mutationNumber}`);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const previous = this.storage.documents.get(id);
    const record = knowledgeSearchFixtureDocument({
      id,
      title: 'Managed Failover',
      category: 'Operations',
      categoryId: 'operations',
      checksum,
      byteSize: bytes.byteLength,
      pdf: `${id}.pdf`,
      revision: (previous?.revision ?? 0) + 1,
      lifecycleState: 'active',
      searchIndexState: 'pending',
      searchIndexChecksum: previous?.searchIndexChecksum ?? null,
      searchIndexVersion: previous?.searchIndexVersion ?? 0,
      searchIndexedAt: previous?.searchIndexedAt ?? null,
      searchIndexError: null,
    });
    this.pdfBytes.set(id, bytes);
    this.storage.upsertDocument(record);
    const root = await this.rootPromise;
    const cacheDir = join(root, 'knowledge-cache');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(join(cacheDir, `${checksum}.pdf`), bytes);
    return clone(record);
  }
}

const faultCases: ReadonlyArray<{ name: FaultName; expectedOk: boolean }> = [
  { name: 'optional-bootstrap', expectedOk: true },
  { name: 'search-auth', expectedOk: false },
  { name: 'collection-fetch', expectedOk: true },
  { name: 'chunk-validation', expectedOk: true },
  { name: 'cache-read', expectedOk: true },
  { name: 'cache-write', expectedOk: true },
  { name: 'worker-timeout', expectedOk: true },
  { name: 'worker-exit', expectedOk: true },
  { name: 'chunk-batch', expectedOk: true },
  { name: 'status-update', expectedOk: true },
  { name: 'subscription-drop', expectedOk: true },
  { name: 'ranking-timeout', expectedOk: false },
  { name: 'cancellation', expectedOk: false },
  { name: 'ipc-handler', expectedOk: false },
];

afterEach(() => {
  vi.useRealTimers();
  mocks.ensurePocketBaseAuthRateLimit.mockReset().mockResolvedValue(undefined);
  mocks.ensureKnowledgeBatchApi.mockReset().mockResolvedValue(undefined);
  mocks.ensureKnowledgeSearchCollections.mockReset().mockResolvedValue(undefined);
  mocks.ensureCollections.mockReset().mockResolvedValue({ privilegedRuntimeReady: true });
  mocks.authWithPassword.mockReset().mockResolvedValue({});
  mocks.fetch.mockReset().mockResolvedValue({ status: 401 });
  mocks.fallbackCollection.mockClear();
  mocks.getAppConfig.mockReset();
  mocks.resetSearchService();
  mocks.setActivePb(null);
  mocks.ipcHandlers.clear();
  mocks.ipcListeners.clear();
});

describe('Wiki search main-process failure isolation release gate', () => {
  it.each(faultCases)(
    'contains $name inside one startup, search, indexer, management, and open graph',
    async ({ name, expectedOk }) => {
      const harness = new ConnectedHarness(name);
      try {
        await harness.start();
        const { firstState, finalDocument } = await harness.exerciseCoreCommands();
        const response = await harness.search();

        expect(response.ok).toBe(expectedOk);
        if (!expectedOk) expect(response).toMatchObject({ ok: false });
        else expect(response).toMatchObject({ ok: true, results: expect.any(Array) });
        if (name === 'worker-timeout' || name === 'worker-exit' || name === 'chunk-batch') {
          expect(firstState).toBe('failed');
        }
        if (name === 'status-update') expect(firstState).toBe('failed');
        await harness.assertOpenUsesSharedIdentity(finalDocument);
      } finally {
        await harness.dispose();
      }
    },
  );

  it('keeps replacement B ready when publication A rejects its trigger later', async () => {
    let rejectPublicationTrigger!: (reason: Error) => void;
    const publicationTrigger = new Promise<void>((_resolve, reject) => {
      rejectPublicationTrigger = reject;
    });
    const harness = new ConnectedHarness('cache-read', {
      firstEnqueueResult: publicationTrigger,
    });
    try {
      await harness.start();
      const published = (await harness.handlers.get('knowledge.document.publish')!(
        harness.context,
        { uploadId: 'upload1', title: 'Mutation A', category: 'Operations' },
      )) as KnowledgeDocumentRecord;
      expect(harness.storage.documents.get(published.id)).toMatchObject({
        checksum: published.checksum,
        searchIndexState: 'pending',
      });

      const replacement = (await harness.handlers.get('knowledge.document.replace')!(
        { ...harness.context, requestId: 'connected-replacement-b' },
        {
          uploadId: 'upload2',
          documentId: published.id,
          expectedRevision: published.revision,
        },
      )) as KnowledgeDocumentRecord;
      await harness.indexer.whenIdleForTest();
      expect(harness.storage.documents.get(replacement.id)).toMatchObject({
        checksum: replacement.checksum,
        revision: replacement.revision,
        searchIndexState: 'ready',
        searchIndexChecksum: replacement.checksum,
      });

      rejectPublicationTrigger(new Error('delayed-publication-trigger-secret'));
      await vi.waitFor(() =>
        expect(mocks.warn).toHaveBeenCalledWith('Wiki search indexing trigger failed', {
          documentId: published.id,
          reason: 'trigger-rejected',
        }),
      );

      expect(harness.storage.documents.get(replacement.id)).toMatchObject({
        checksum: replacement.checksum,
        revision: replacement.revision,
        searchIndexState: 'ready',
        searchIndexChecksum: replacement.checksum,
      });
    } finally {
      await harness.dispose();
    }
  });
});
