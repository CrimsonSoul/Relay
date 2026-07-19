import { performance } from 'node:perf_hooks';
import type PocketBase from 'pocketbase';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_MAX_PAGES,
  KNOWLEDGE_MAX_PDF_BYTES,
  normalizeKnowledgeDocumentRecord,
  type KnowledgeDocumentRecord,
} from '@shared/knowledge';
import {
  KNOWLEDGE_SEARCH_CHUNKS_COLLECTION,
  KNOWLEDGE_SEARCH_INDEX_VERSION,
  KNOWLEDGE_SEARCH_MAX_CHUNKS,
  KNOWLEDGE_SEARCH_MAX_TEXT_BYTES,
  normalizeKnowledgeSearchChunkRecord,
  normalizeKnowledgeSearchRequest,
  normalizeKnowledgeSearchResponse,
  type KnowledgeSearchAvailability,
  type KnowledgeSearchChunkRecord,
  type KnowledgeSearchRequest,
  type KnowledgeSearchResponse,
} from '@shared/knowledgeSearch';
import type { OfflineCache } from '../cache/OfflineCache';
import { loggers } from '../logger';
import { KnowledgeSearchEngine } from './KnowledgeSearchEngine';

const SEARCH_DEADLINE_MS = 1_000;
const RECONCILIATION_INTERVAL_MS = 60_000;
const RECONCILIATION_DEADLINE_MS = 5_000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;
const DEFAULT_MAX_CHUNKS_PER_DOCUMENT = KNOWLEDGE_MAX_PAGES * 16;
const DEFAULT_MAX_TEXT_BYTES_PER_DOCUMENT = KNOWLEDGE_MAX_PDF_BYTES;

type SearchEnginePort = Pick<
  KnowledgeSearchEngine,
  'replaceSnapshot' | 'upsertDocument' | 'removeDocument' | 'upsertChunk' | 'removeChunk' | 'search'
>;

type SearchCachePort = Pick<OfflineCache, 'readCollection' | 'writeCollection' | 'updateRecord'>;

type SearchLimits = {
  maxChunks: number;
  maxTextBytes: number;
  maxChunksPerDocument: number;
  maxTextBytesPerDocument: number;
};

type Snapshot = {
  cachedDocuments: KnowledgeDocumentRecord[];
  cachedChunks: KnowledgeSearchChunkRecord[];
  documents: KnowledgeDocumentRecord[];
  chunks: KnowledgeSearchChunkRecord[];
};

type RealtimeEvent = {
  action: string;
  record: unknown;
};

type RealtimeCollection = {
  getFullList(options?: Record<string, unknown>): Promise<unknown[]>;
  subscribe(topic: string, callback: (event: RealtimeEvent) => void): Promise<() => void>;
};

type SearchPocketBase = {
  collection(name: string): RealtimeCollection;
  realtime?: { onDisconnect?: ((activeSubscriptions: string[]) => void) | null };
};

type ActiveSearch = { rejectCancellation: () => void };

class SearchCancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'SearchCancelledError';
  }
}

class SearchTimeoutError extends Error {
  constructor() {
    super('timeout');
    this.name = 'SearchTimeoutError';
  }
}

function knowledgeLogger(): typeof loggers.main {
  return (loggers as unknown as { knowledge?: typeof loggers.main }).knowledge ?? loggers.main;
}

function safeRecordId(value: unknown): string {
  if (!value || typeof value !== 'object' || !('id' in value)) return 'unknown';
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(id) ? id : 'invalid';
}

function eligibleDocument(document: KnowledgeDocumentRecord): boolean {
  return (
    document.lifecycleState === 'active' &&
    document.searchIndexState === 'ready' &&
    document.searchIndexChecksum === document.checksum &&
    document.searchIndexVersion === KNOWLEDGE_SEARCH_INDEX_VERSION
  );
}

function textBytes(chunk: KnowledgeSearchChunkRecord): number {
  return Buffer.byteLength(chunk.text, 'utf8') + Buffer.byteLength(chunk.normalizedText, 'utf8');
}

function parseSnapshot(
  rawDocuments: readonly unknown[],
  rawChunks: readonly unknown[],
  limits: SearchLimits,
): Snapshot | null {
  if (rawChunks.length > limits.maxChunks) {
    knowledgeLogger().warn('Rejected oversized Wiki search snapshot', {
      reason: 'record-limit',
    });
    return null;
  }
  const documentMap = new Map<string, KnowledgeDocumentRecord>();
  for (const raw of rawDocuments) {
    const document = normalizeKnowledgeDocumentRecord(raw);
    if (!document) {
      knowledgeLogger().warn('Skipped invalid Wiki search document', {
        documentId: safeRecordId(raw),
        reason: 'invalid-record',
      });
      continue;
    }
    if (documentMap.has(document.id)) return null;
    documentMap.set(document.id, document);
  }

  const chunkMap = new Map<string, KnowledgeSearchChunkRecord>();
  const perDocumentCount = new Map<string, number>();
  const perDocumentBytes = new Map<string, number>();
  let totalBytes = 0;
  for (const raw of rawChunks) {
    const chunk = normalizeKnowledgeSearchChunkRecord(raw);
    if (!chunk) {
      knowledgeLogger().warn('Skipped invalid Wiki search chunk', {
        chunkId: safeRecordId(raw),
        reason: 'invalid-record',
      });
      continue;
    }
    if (chunkMap.has(chunk.id)) return null;
    const bytes = textBytes(chunk);
    const count = (perDocumentCount.get(chunk.documentId) ?? 0) + 1;
    const documentBytes = (perDocumentBytes.get(chunk.documentId) ?? 0) + bytes;
    totalBytes += bytes;
    if (
      chunkMap.size + 1 > limits.maxChunks ||
      totalBytes > limits.maxTextBytes ||
      count > limits.maxChunksPerDocument ||
      documentBytes > limits.maxTextBytesPerDocument
    ) {
      knowledgeLogger().warn('Rejected oversized Wiki search snapshot', {
        reason: 'corpus-limit',
      });
      return null;
    }
    chunkMap.set(chunk.id, chunk);
    perDocumentCount.set(chunk.documentId, count);
    perDocumentBytes.set(chunk.documentId, documentBytes);
  }

  const eligibleDocuments = new Map(
    [...documentMap.values()].filter(eligibleDocument).map((document) => [document.id, document]),
  );
  const eligibleChunks = [...chunkMap.values()].filter((chunk) => {
    const document = eligibleDocuments.get(chunk.documentId);
    return (
      document !== undefined &&
      chunk.checksum === document.checksum &&
      chunk.indexVersion === document.searchIndexVersion
    );
  });

  return {
    cachedDocuments: [...documentMap.values()],
    cachedChunks: [...chunkMap.values()],
    documents: [...eligibleDocuments.values()],
    chunks: eligibleChunks,
  };
}

function rejectedAfter(
  milliseconds: number,
  error: Error,
): {
  promise: Promise<never>;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(error), milliseconds);
    timer.unref?.();
  });
  return {
    promise,
    cancel: () => {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

export type KnowledgeSearchServiceOptions = {
  cache?: SearchCachePort | null;
  engine?: SearchEnginePort;
  now?: () => number;
  monotonicNow?: () => number;
  limits?: Partial<SearchLimits>;
};

export class KnowledgeSearchService {
  private readonly cache: SearchCachePort | null;
  private readonly engine: SearchEnginePort;
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private readonly limits: SearchLimits;
  private readonly documents = new Map<string, KnowledgeDocumentRecord>();
  private readonly chunks = new Map<string, KnowledgeSearchChunkRecord>();
  private readonly cancelled = new Set<string>();
  private readonly activeSearches = new Map<string, ActiveSearch>();
  private readonly chunkCountByDocument = new Map<string, number>();
  private readonly chunkBytesByDocument = new Map<string, number>();
  private totalChunkBytes = 0;
  private availability: KnowledgeSearchAvailability | null = null;
  private pb: SearchPocketBase | null = null;
  private unsubscribers: Array<() => void> = [];
  private previousOnDisconnect: ((subscriptions: string[]) => void) | null = null;
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private reconciliation: Promise<void> | null = null;
  private failureCount = 0;
  private circuitOpenUntil = 0;
  private disposed = false;

  constructor(options: KnowledgeSearchServiceOptions = {}) {
    this.cache = options.cache ?? null;
    this.engine = options.engine ?? new KnowledgeSearchEngine();
    this.now = options.now ?? Date.now;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.limits = {
      maxChunks: options.limits?.maxChunks ?? KNOWLEDGE_SEARCH_MAX_CHUNKS,
      maxTextBytes: options.limits?.maxTextBytes ?? KNOWLEDGE_SEARCH_MAX_TEXT_BYTES,
      maxChunksPerDocument: options.limits?.maxChunksPerDocument ?? DEFAULT_MAX_CHUNKS_PER_DOCUMENT,
      maxTextBytesPerDocument:
        options.limits?.maxTextBytesPerDocument ?? DEFAULT_MAX_TEXT_BYTES_PER_DOCUMENT,
    };
  }

  async start(pb: PocketBase | null): Promise<void> {
    if (this.disposed) return;
    this.hydrateFromCache();
    if (pb) await this.connect(pb);
  }

  async connect(pb: PocketBase): Promise<void> {
    if (this.disposed) return;
    await this.stopSubscriptions();
    this.pb = pb as unknown as SearchPocketBase;
    let subscriptionDeadline: ReturnType<typeof rejectedAfter> | null = null;
    try {
      await this.replaceFromPocketBase(this.pb);
      subscriptionDeadline = rejectedAfter(
        RECONCILIATION_DEADLINE_MS,
        new Error('subscription-timeout'),
      );
      await Promise.race([this.subscribe(this.pb), subscriptionDeadline.promise]);
      this.scheduleReconciliation();
      this.availability = 'ready';
      this.resetFailures();
    } catch {
      await this.stopSubscriptions();
      if (this.cache) this.hydrateFromCache();
      this.recordFailure('connect-failed');
    } finally {
      subscriptionDeadline?.cancel();
    }
  }

  async search(input: KnowledgeSearchRequest): Promise<KnowledgeSearchResponse> {
    const request = normalizeKnowledgeSearchRequest(input);
    const requestId =
      input && typeof input === 'object' && typeof input.requestId === 'string'
        ? input.requestId
        : 'invalid';
    if (!request) return { ok: false, requestId, error: 'invalid-query' };
    if (this.disposed || !this.availability || this.circuitOpen()) {
      return { ok: false, requestId: request.requestId, error: 'unavailable' };
    }

    if (this.activeSearches.has(request.requestId)) this.cancel(request.requestId);
    const timeout = rejectedAfter(SEARCH_DEADLINE_MS, new SearchTimeoutError());
    let rejectCancellation: ((error: Error) => void) | null = null;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    this.activeSearches.set(request.requestId, {
      rejectCancellation: () => rejectCancellation?.(new SearchCancelledError()),
    });

    try {
      const result = await Promise.race([
        this.engine.search(request, {
          deadline: this.monotonicNow() + SEARCH_DEADLINE_MS,
          isCancelled: () => this.cancelled.has(request.requestId),
        }),
        timeout.promise,
        cancellation,
      ]);
      const response = normalizeKnowledgeSearchResponse({
        ...result,
        availability: this.availability,
      });
      if (!response || !response.ok || response.requestId !== request.requestId) {
        this.recordFailure('invalid-engine-response');
        return { ok: false, requestId: request.requestId, error: 'unavailable' };
      }
      this.resetFailures();
      return response;
    } catch (error) {
      if (
        error instanceof SearchCancelledError ||
        (error as Error)?.name === 'SearchCancelledError'
      ) {
        return { ok: false, requestId: request.requestId, error: 'cancelled' };
      }
      if (error instanceof SearchTimeoutError || (error as Error)?.name === 'SearchTimeoutError') {
        this.recordFailure('search-timeout');
        return { ok: false, requestId: request.requestId, error: 'timeout' };
      }
      this.recordFailure('search-failed');
      return { ok: false, requestId: request.requestId, error: 'unavailable' };
    } finally {
      timeout.cancel();
      this.cancelled.delete(request.requestId);
      this.activeSearches.delete(request.requestId);
    }
  }

  cancel(requestId: string): void {
    const active = this.activeSearches.get(requestId);
    if (!active) return;
    this.cancelled.add(requestId);
    active.rejectCancellation();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.availability = null;
    for (const [requestId, active] of this.activeSearches) {
      this.cancelled.add(requestId);
      active.rejectCancellation();
    }
    await this.stopSubscriptions();
    this.documents.clear();
    this.chunks.clear();
    this.chunkCountByDocument.clear();
    this.chunkBytesByDocument.clear();
    this.totalChunkBytes = 0;
    this.engine.replaceSnapshot([], []);
  }

  private hydrateFromCache(): void {
    if (!this.cache) return;
    try {
      const snapshot = parseSnapshot(
        this.cache.readCollection(KNOWLEDGE_DOCUMENTS_COLLECTION),
        this.cache.readCollection(KNOWLEDGE_SEARCH_CHUNKS_COLLECTION),
        this.limits,
      );
      if (!snapshot || snapshot.chunks.length === 0) return;
      this.publishSnapshot(snapshot);
      this.availability = 'cached';
    } catch {
      knowledgeLogger().warn('Wiki search cache hydration failed', { reason: 'cache-read-failed' });
    }
  }

  private async replaceFromPocketBase(pb: SearchPocketBase): Promise<void> {
    const fetch = Promise.all([
      pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).getFullList({ requestKey: null }),
      pb.collection(KNOWLEDGE_SEARCH_CHUNKS_COLLECTION).getFullList({ requestKey: null }),
    ]);
    const deadline = rejectedAfter(RECONCILIATION_DEADLINE_MS, new Error('refresh-timeout'));
    try {
      const [rawDocuments, rawChunks] = await Promise.race([fetch, deadline.promise]);
      const snapshot = parseSnapshot(rawDocuments, rawChunks, this.limits);
      if (!snapshot) throw new Error('invalid-snapshot');
      this.publishSnapshot(snapshot);
      this.writeSnapshotToCache(snapshot);
    } finally {
      deadline.cancel();
    }
  }

  private publishSnapshot(snapshot: Snapshot): void {
    this.documents.clear();
    for (const document of snapshot.cachedDocuments) this.documents.set(document.id, document);
    this.chunks.clear();
    this.chunkCountByDocument.clear();
    this.chunkBytesByDocument.clear();
    this.totalChunkBytes = 0;
    for (const chunk of snapshot.cachedChunks) this.storeChunk(chunk);
    this.engine.replaceSnapshot(snapshot.documents, snapshot.chunks);
  }

  private writeSnapshotToCache(snapshot: Snapshot): void {
    if (!this.cache) return;
    try {
      this.cache.writeCollection(
        KNOWLEDGE_DOCUMENTS_COLLECTION,
        snapshot.cachedDocuments as unknown as Record<string, unknown>[],
      );
      this.cache.writeCollection(
        KNOWLEDGE_SEARCH_CHUNKS_COLLECTION,
        snapshot.cachedChunks as unknown as Record<string, unknown>[],
      );
    } catch {
      knowledgeLogger().warn('Wiki search cache persistence failed', {
        reason: 'cache-write-failed',
      });
    }
  }

  private async subscribe(pb: SearchPocketBase): Promise<void> {
    const documentUnsubscribe = await pb
      .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
      .subscribe('*', (event) => this.handleDocumentEvent(event));
    if (this.disposed || this.pb !== pb) {
      await documentUnsubscribe();
      return;
    }
    this.unsubscribers.push(documentUnsubscribe);
    const chunkUnsubscribe = await pb
      .collection(KNOWLEDGE_SEARCH_CHUNKS_COLLECTION)
      .subscribe('*', (event) => this.handleChunkEvent(event));
    if (this.disposed || this.pb !== pb) {
      await chunkUnsubscribe();
      return;
    }
    this.unsubscribers.push(chunkUnsubscribe);

    if (pb.realtime) {
      this.previousOnDisconnect = pb.realtime.onDisconnect ?? null;
      pb.realtime.onDisconnect = (subscriptions) => {
        this.previousOnDisconnect?.(subscriptions);
        if (subscriptions.length > 0) void this.reconcile();
      };
    }
  }

  private handleDocumentEvent(event: RealtimeEvent): void {
    const recordId = safeRecordId(event.record);
    if (event.action === 'delete') {
      if (recordId === 'unknown' || recordId === 'invalid') return;
      this.documents.delete(recordId);
      this.engine.removeDocument(recordId);
      this.cacheUpdate(KNOWLEDGE_DOCUMENTS_COLLECTION, 'delete', { id: recordId });
      return;
    }
    const document = normalizeKnowledgeDocumentRecord(event.record);
    if (!document) {
      knowledgeLogger().warn('Skipped invalid Wiki search document event', {
        documentId: recordId,
        reason: 'invalid-record',
      });
      void this.reconcile();
      return;
    }
    const previous = this.documents.get(document.id);
    this.documents.set(document.id, document);
    this.cacheUpdate(
      KNOWLEDGE_DOCUMENTS_COLLECTION,
      previous ? 'update' : 'create',
      document as unknown as Record<string, unknown>,
    );
    if (!eligibleDocument(document)) {
      this.engine.removeDocument(document.id);
      return;
    }
    this.engine.upsertDocument(document);
    if (!previous || !eligibleDocument(previous) || previous.checksum !== document.checksum) {
      for (const chunk of this.chunks.values()) {
        if (
          chunk.documentId === document.id &&
          chunk.checksum === document.checksum &&
          chunk.indexVersion === document.searchIndexVersion
        ) {
          this.engine.upsertChunk(chunk);
        }
      }
    }
  }

  private handleChunkEvent(event: RealtimeEvent): void {
    const recordId = safeRecordId(event.record);
    if (event.action === 'delete') {
      if (recordId === 'unknown' || recordId === 'invalid') return;
      this.deleteStoredChunk(recordId);
      this.engine.removeChunk(recordId);
      this.cacheUpdate(KNOWLEDGE_SEARCH_CHUNKS_COLLECTION, 'delete', { id: recordId });
      return;
    }
    const chunk = normalizeKnowledgeSearchChunkRecord(event.record);
    if (!chunk) {
      knowledgeLogger().warn('Skipped invalid Wiki search chunk event', {
        chunkId: recordId,
        reason: 'invalid-record',
      });
      void this.reconcile();
      return;
    }
    const previous = this.chunks.get(chunk.id);
    if (!this.canStoreChunk(chunk, previous)) {
      knowledgeLogger().warn('Rejected oversized Wiki search realtime chunk', {
        chunkId: chunk.id,
        reason: 'corpus-limit',
      });
      void this.reconcile();
      return;
    }
    this.storeChunk(chunk);
    this.cacheUpdate(
      KNOWLEDGE_SEARCH_CHUNKS_COLLECTION,
      previous ? 'update' : 'create',
      chunk as unknown as Record<string, unknown>,
    );
    const document = this.documents.get(chunk.documentId);
    if (
      document &&
      eligibleDocument(document) &&
      chunk.checksum === document.checksum &&
      chunk.indexVersion === document.searchIndexVersion
    ) {
      this.engine.upsertChunk(chunk);
    } else {
      this.engine.removeChunk(chunk.id);
    }
  }

  private canStoreChunk(
    chunk: KnowledgeSearchChunkRecord,
    previous: KnowledgeSearchChunkRecord | undefined,
  ): boolean {
    const nextCount = this.chunks.size + (previous ? 0 : 1);
    const nextTotalBytes =
      this.totalChunkBytes - (previous ? textBytes(previous) : 0) + textBytes(chunk);
    if (nextCount > this.limits.maxChunks || nextTotalBytes > this.limits.maxTextBytes)
      return false;

    const previousInSameDocument = previous?.documentId === chunk.documentId ? previous : undefined;
    const documentCount =
      (this.chunkCountByDocument.get(chunk.documentId) ?? 0) + (previousInSameDocument ? 0 : 1);
    const documentBytes =
      (this.chunkBytesByDocument.get(chunk.documentId) ?? 0) -
      (previousInSameDocument ? textBytes(previousInSameDocument) : 0) +
      textBytes(chunk);
    return (
      documentCount <= this.limits.maxChunksPerDocument &&
      documentBytes <= this.limits.maxTextBytesPerDocument
    );
  }

  private storeChunk(chunk: KnowledgeSearchChunkRecord): void {
    const previous = this.chunks.get(chunk.id);
    if (previous) this.removeChunkAccounting(previous);
    this.chunks.set(chunk.id, chunk);
    const bytes = textBytes(chunk);
    this.totalChunkBytes += bytes;
    this.chunkCountByDocument.set(
      chunk.documentId,
      (this.chunkCountByDocument.get(chunk.documentId) ?? 0) + 1,
    );
    this.chunkBytesByDocument.set(
      chunk.documentId,
      (this.chunkBytesByDocument.get(chunk.documentId) ?? 0) + bytes,
    );
  }

  private deleteStoredChunk(chunkId: string): void {
    const previous = this.chunks.get(chunkId);
    if (!previous) return;
    this.chunks.delete(chunkId);
    this.removeChunkAccounting(previous);
  }

  private removeChunkAccounting(chunk: KnowledgeSearchChunkRecord): void {
    const bytes = textBytes(chunk);
    this.totalChunkBytes = Math.max(0, this.totalChunkBytes - bytes);
    const count = (this.chunkCountByDocument.get(chunk.documentId) ?? 1) - 1;
    const documentBytes = (this.chunkBytesByDocument.get(chunk.documentId) ?? bytes) - bytes;
    if (count <= 0) this.chunkCountByDocument.delete(chunk.documentId);
    else this.chunkCountByDocument.set(chunk.documentId, count);
    if (documentBytes <= 0) this.chunkBytesByDocument.delete(chunk.documentId);
    else this.chunkBytesByDocument.set(chunk.documentId, documentBytes);
  }

  private cacheUpdate(
    collection: string,
    action: 'create' | 'update' | 'delete',
    record: Record<string, unknown>,
  ): void {
    if (!this.cache) return;
    try {
      this.cache.updateRecord(collection, action, record);
    } catch {
      knowledgeLogger().warn('Wiki search cache update failed', { reason: 'cache-update-failed' });
    }
  }

  private scheduleReconciliation(): void {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = setInterval(() => void this.reconcile(), RECONCILIATION_INTERVAL_MS);
    this.reconciliationTimer.unref?.();
  }

  private reconcile(): Promise<void> {
    if (this.disposed || !this.pb) return Promise.resolve();
    this.reconciliation ??= this.replaceFromPocketBase(this.pb)
      .then(() => {
        this.availability = 'ready';
        this.resetFailures();
      })
      .catch(() => this.recordFailure('reconciliation-failed'))
      .finally(() => {
        this.reconciliation = null;
      });
    return this.reconciliation;
  }

  private async stopSubscriptions(): Promise<void> {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = null;
    const pb = this.pb;
    if (pb?.realtime && pb.realtime.onDisconnect) {
      pb.realtime.onDisconnect = this.previousOnDisconnect;
    }
    this.previousOnDisconnect = null;
    const unsubscribers = this.unsubscribers.splice(0);
    await Promise.all(
      unsubscribers.map(async (unsubscribe) => {
        try {
          await unsubscribe();
        } catch {
          knowledgeLogger().warn('Wiki search unsubscribe failed', {
            reason: 'unsubscribe-failed',
          });
        }
      }),
    );
    this.pb = null;
  }

  private circuitOpen(): boolean {
    if (this.circuitOpenUntil === 0) return false;
    if (this.now() < this.circuitOpenUntil) return true;
    this.resetFailures();
    return false;
  }

  private recordFailure(reason: string): void {
    this.failureCount += 1;
    if (this.failureCount >= CIRCUIT_FAILURE_THRESHOLD) {
      this.circuitOpenUntil = this.now() + CIRCUIT_COOLDOWN_MS;
    }
    knowledgeLogger().warn('Enhanced Wiki search operation failed', { reason });
  }

  private resetFailures(): void {
    this.failureCount = 0;
    this.circuitOpenUntil = 0;
  }
}
