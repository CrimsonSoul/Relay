import { performance } from 'node:perf_hooks';
import type PocketBase from 'pocketbase';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_SEARCH_MAX_CHUNKS_PER_DOCUMENT,
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
const RECONCILIATION_INTERVAL_MS = 15 * 60_000;
const RECONCILIATION_DEADLINE_MS = 5_000;
// A whole-corpus fetch takes longer the larger the corpus is, so the snapshot deadline grows with
// the number of chunks already known rather than timing every library out at the same five seconds.
const SNAPSHOT_DEADLINE_PER_CHUNK_MS = 10;
const SNAPSHOT_DEADLINE_MAX_MS = 120_000;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 60_000;
const RETRY_MAX_EXPONENT = 6;
const UNSUBSCRIBE_DEADLINE_MS = 1_000;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;
const DEFAULT_MAX_CHUNKS_PER_DOCUMENT = KNOWLEDGE_SEARCH_MAX_CHUNKS_PER_DOCUMENT;
const DEFAULT_MAX_TEXT_BYTES_PER_DOCUMENT = KNOWLEDGE_MAX_PDF_BYTES;
const DEFAULT_MAX_BUFFERED_UNIQUE_EVENTS = 10_000;
const DEFAULT_MAX_BUFFERED_EVENT_BYTES = 16 * 1024 * 1024;

type SearchEnginePort = Pick<
  KnowledgeSearchEngine,
  'replaceSnapshot' | 'upsertDocument' | 'removeDocument' | 'upsertChunk' | 'removeChunk' | 'search'
>;

type SearchCachePort = Pick<
  OfflineCache,
  | 'readCollection'
  | 'writeCollection'
  | 'updateRecord'
  | 'hasKnowledgeSearchSnapshotFor'
  | 'clearKnowledgeSearchSnapshotMarker'
  | 'setKnowledgeSearchSnapshotMarker'
>;

type SearchLimits = {
  maxChunks: number;
  maxTextBytes: number;
  maxChunksPerDocument: number;
  maxTextBytesPerDocument: number;
};

type RealtimeBufferLimits = {
  maxUniqueEvents: number;
  maxRetainedBytes: number;
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
  subscribe(
    topic: string,
    callback: (event: RealtimeEvent) => void,
  ): Promise<() => void | Promise<void>>;
};

type SearchPocketBase = {
  collection(name: string): RealtimeCollection;
  realtime?: { onDisconnect?: ((activeSubscriptions: string[]) => void) | null };
};

type ActiveSearch = { cancelled: boolean; rejectCancellation: () => void };
type BufferedRealtimeEvent =
  | { kind: 'document'; action: 'delete'; id: string }
  | { kind: 'document'; action: 'upsert'; id: string; record: KnowledgeDocumentRecord }
  | { kind: 'chunk'; action: 'delete'; id: string }
  | { kind: 'chunk'; action: 'upsert'; id: string; record: KnowledgeSearchChunkRecord };
type BufferedEventEntry = { event: BufferedRealtimeEvent; bytes: number };
type EventBuffer = {
  epoch: number;
  events: Map<string, BufferedEventEntry>;
  retainedBytes: number;
  failureReason: 'event-count-limit' | 'event-byte-limit' | 'invalid-event' | null;
};
type Reconciliation = { epoch: number; promise: Promise<void> };

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

function eligibleChunk(
  chunk: KnowledgeSearchChunkRecord,
  document: KnowledgeDocumentRecord | undefined,
): boolean {
  return (
    document !== undefined &&
    eligibleDocument(document) &&
    chunk.checksum === document.checksum &&
    chunk.indexVersion === document.searchIndexVersion &&
    chunk.pageNumber <= document.pageCount
  );
}

function textBytes(chunk: KnowledgeSearchChunkRecord): number {
  return Buffer.byteLength(chunk.text, 'utf8') + Buffer.byteLength(chunk.normalizedText, 'utf8');
}

type SizedChunk = { chunk: KnowledgeSearchChunkRecord; bytes: number };
type ChunkIntake = { accepted: SizedChunk[]; oversizedDocuments: Set<string> };

function normalizeSnapshotDocuments(
  rawDocuments: readonly unknown[],
): Map<string, KnowledgeDocumentRecord> | null {
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
  return documentMap;
}

/** Normalizes chunks and names the documents whose own share of the corpus is over the limit. */
function normalizeSnapshotChunks(
  rawChunks: readonly unknown[],
  limits: SearchLimits,
): ChunkIntake | null {
  const accepted: SizedChunk[] = [];
  const seenChunkIds = new Set<string>();
  const perDocumentCount = new Map<string, number>();
  const perDocumentBytes = new Map<string, number>();
  const oversizedDocuments = new Set<string>();
  for (const raw of rawChunks) {
    const chunk = normalizeKnowledgeSearchChunkRecord(raw);
    if (!chunk) {
      knowledgeLogger().warn('Skipped invalid Wiki search chunk', {
        chunkId: safeRecordId(raw),
        reason: 'invalid-record',
      });
      continue;
    }
    if (seenChunkIds.has(chunk.id)) return null;
    seenChunkIds.add(chunk.id);
    const bytes = textBytes(chunk);
    const count = (perDocumentCount.get(chunk.documentId) ?? 0) + 1;
    const documentBytes = (perDocumentBytes.get(chunk.documentId) ?? 0) + bytes;
    perDocumentCount.set(chunk.documentId, count);
    perDocumentBytes.set(chunk.documentId, documentBytes);
    // A per-document overrun is attributable, so it costs that document its chunks rather than
    // discarding every other document's index along with it.
    if (count > limits.maxChunksPerDocument || documentBytes > limits.maxTextBytesPerDocument) {
      oversizedDocuments.add(chunk.documentId);
    }
    accepted.push({ chunk, bytes });
  }
  for (const documentId of oversizedDocuments) {
    knowledgeLogger().warn('Skipped oversized Wiki search document', {
      documentId,
      reason: 'document-limit',
    });
  }
  return { accepted, oversizedDocuments };
}

function collectSnapshotChunks(
  intake: ChunkIntake,
  limits: SearchLimits,
): Map<string, KnowledgeSearchChunkRecord> | null {
  const chunkMap = new Map<string, KnowledgeSearchChunkRecord>();
  let totalBytes = 0;
  for (const { chunk, bytes } of intake.accepted) {
    if (intake.oversizedDocuments.has(chunk.documentId)) continue;
    totalBytes += bytes;
    // Corpus-wide overruns cannot be blamed on one document, so they still reject the snapshot.
    if (chunkMap.size + 1 > limits.maxChunks || totalBytes > limits.maxTextBytes) {
      knowledgeLogger().warn('Rejected oversized Wiki search snapshot', {
        reason: 'corpus-limit',
      });
      return null;
    }
    chunkMap.set(chunk.id, chunk);
  }
  return chunkMap;
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
  const documentMap = normalizeSnapshotDocuments(rawDocuments);
  if (!documentMap) return null;
  const intake = normalizeSnapshotChunks(rawChunks, limits);
  if (!intake) return null;
  const chunkMap = collectSnapshotChunks(intake, limits);
  if (!chunkMap) return null;

  const eligibleDocuments = new Map(
    [...documentMap.values()].filter(eligibleDocument).map((document) => [document.id, document]),
  );
  const eligibleChunks = [...chunkMap.values()].filter((chunk) => {
    const document = eligibleDocuments.get(chunk.documentId);
    return eligibleChunk(chunk, document);
  });

  return {
    cachedDocuments: [...documentMap.values()],
    cachedChunks: [...chunkMap.values()],
    documents: [...eligibleDocuments.values()],
    chunks: eligibleChunks,
  };
}

function replaySnapshotEvents(
  snapshot: Snapshot,
  events: Iterable<BufferedEventEntry>,
  limits: SearchLimits,
): Snapshot | null {
  const documents = new Map(snapshot.cachedDocuments.map((document) => [document.id, document]));
  const chunks = new Map(snapshot.cachedChunks.map((chunk) => [chunk.id, chunk]));
  for (const { event } of events) {
    applySnapshotEvent(documents, chunks, event);
  }
  return parseSnapshot([...documents.values()], [...chunks.values()], limits);
}

function applySnapshotEvent(
  documents: Map<string, KnowledgeDocumentRecord>,
  chunks: Map<string, KnowledgeSearchChunkRecord>,
  buffered: BufferedRealtimeEvent,
): void {
  if (buffered.action === 'delete') {
    if (buffered.kind === 'document') documents.delete(buffered.id);
    else chunks.delete(buffered.id);
    return;
  }
  if (buffered.kind === 'document') {
    documents.set(buffered.id, buffered.record);
    return;
  }
  chunks.set(buffered.id, buffered.record);
}

function normalizeRealtimeEvent(
  kind: BufferedRealtimeEvent['kind'],
  event: RealtimeEvent,
): BufferedRealtimeEvent | null {
  if (event.action === 'delete') {
    const id = safeRecordId(event.record);
    if (id === 'unknown' || id === 'invalid') return null;
    return { kind, action: 'delete', id };
  }
  if (event.action !== 'create' && event.action !== 'update') return null;
  if (kind === 'document') {
    const record = normalizeKnowledgeDocumentRecord(event.record);
    return record ? { kind, action: 'upsert', id: record.id, record } : null;
  }
  const record = normalizeKnowledgeSearchChunkRecord(event.record);
  return record ? { kind, action: 'upsert', id: record.id, record } : null;
}

function bufferedEventBytes(event: BufferedRealtimeEvent): number {
  const identityBytes = Buffer.byteLength(event.id, 'utf8') + 16;
  if (event.action === 'delete') return identityBytes;
  return identityBytes + Buffer.byteLength(JSON.stringify(event.record), 'utf8');
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
  cacheIdentity?: string | null;
  engine?: SearchEnginePort;
  now?: () => number;
  monotonicNow?: () => number;
  limits?: Partial<SearchLimits>;
  bufferLimits?: Partial<RealtimeBufferLimits>;
};

export class KnowledgeSearchService {
  private readonly cache: SearchCachePort | null;
  private readonly cacheIdentity: string | null;
  private readonly engine: SearchEnginePort;
  private readonly now: () => number;
  private readonly monotonicNow: () => number;
  private readonly limits: SearchLimits;
  private readonly bufferLimits: RealtimeBufferLimits;
  private readonly documents = new Map<string, KnowledgeDocumentRecord>();
  private readonly chunks = new Map<string, KnowledgeSearchChunkRecord>();
  private readonly activeSearches = new Map<string, ActiveSearch>();
  private readonly chunkCountByDocument = new Map<string, number>();
  private readonly chunkBytesByDocument = new Map<string, number>();
  private totalChunkBytes = 0;
  private availability: KnowledgeSearchAvailability | null = null;
  private pb: SearchPocketBase | null = null;
  private readonly unsubscribers: Array<() => void | Promise<void>> = [];
  private disconnectOwner: {
    pb: SearchPocketBase;
    handler: (subscriptions: string[]) => void;
    previous: ((subscriptions: string[]) => void) | null;
  } | null = null;
  private reconciliationTimer: ReturnType<typeof setInterval> | null = null;
  private reconciliation: Reconciliation | null = null;
  private eventBuffer: EventBuffer | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectAttempts = 0;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileAttempts = 0;
  private connectionEpoch = 0;
  private failureCount = 0;
  private circuitOpenUntil = 0;
  private disposed = false;

  constructor(options: KnowledgeSearchServiceOptions = {}) {
    this.cache = options.cache ?? null;
    this.cacheIdentity = options.cacheIdentity ?? null;
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
    this.bufferLimits = {
      maxUniqueEvents: options.bufferLimits?.maxUniqueEvents ?? DEFAULT_MAX_BUFFERED_UNIQUE_EVENTS,
      maxRetainedBytes: options.bufferLimits?.maxRetainedBytes ?? DEFAULT_MAX_BUFFERED_EVENT_BYTES,
    };
  }

  async start(pb: PocketBase | null): Promise<void> {
    if (this.disposed) return;
    this.hydrateFromCache();
    if (pb) await this.connect(pb);
  }

  async connect(pb: PocketBase): Promise<void> {
    if (this.disposed) return;
    this.cancelConnectRetry();
    const epoch = ++this.connectionEpoch;
    await this.stopSubscriptions();
    const nextPb = pb as unknown as SearchPocketBase;
    if (!this.isCurrent(epoch)) return;
    this.pb = nextPb;
    this.eventBuffer = this.createEventBuffer(epoch);
    let subscriptionDeadline: ReturnType<typeof rejectedAfter> | null = null;
    try {
      subscriptionDeadline = rejectedAfter(
        RECONCILIATION_DEADLINE_MS,
        new Error('subscription-timeout'),
      );
      await Promise.race([this.subscribe(nextPb, epoch), subscriptionDeadline.promise]);
      subscriptionDeadline.cancel();
      subscriptionDeadline = null;
      await this.synchronizeSnapshot(nextPb, epoch);
      if (!this.isCurrentConnection(epoch, nextPb)) return;
      this.scheduleReconciliation();
      this.availability = 'ready';
      this.connectAttempts = 0;
      this.reconcileAttempts = 0;
      this.resetFailures();
    } catch {
      if (this.isCurrentConnection(epoch, nextPb)) {
        this.flushBufferedEvents(epoch);
        await this.stopSubscriptions();
        if (!this.availability) this.hydrateFromCache();
        if (this.isCurrent(epoch)) {
          this.recordFailure('connect-failed');
          // Without a retry the torn-down connection would leave every search unavailable for the
          // rest of the session, since nothing else re-establishes the subscriptions.
          this.scheduleConnectRetry(pb, epoch);
        }
      }
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

    const previous = this.activeSearches.get(request.requestId);
    if (previous) {
      previous.cancelled = true;
      previous.rejectCancellation();
    }
    const timeout = rejectedAfter(SEARCH_DEADLINE_MS, new SearchTimeoutError());
    let rejectCancellation: ((error: Error) => void) | null = null;
    const cancellation = new Promise<never>((_resolve, reject) => {
      rejectCancellation = reject;
    });
    const operation: ActiveSearch = {
      cancelled: false,
      rejectCancellation: () => rejectCancellation?.(new SearchCancelledError()),
    };
    this.activeSearches.set(request.requestId, operation);

    try {
      const result = await Promise.race([
        this.engine.search(request, {
          deadline: this.monotonicNow() + SEARCH_DEADLINE_MS,
          isCancelled: () => operation.cancelled,
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
      if (this.activeSearches.get(request.requestId) === operation) {
        this.activeSearches.delete(request.requestId);
      }
    }
  }

  cancel(requestId: string): void {
    const active = this.activeSearches.get(requestId);
    if (!active) return;
    active.cancelled = true;
    active.rejectCancellation();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.connectionEpoch += 1;
    this.cancelConnectRetry();
    this.cancelReconcileRetry();
    this.availability = null;
    this.eventBuffer = null;
    for (const active of this.activeSearches.values()) {
      active.cancelled = true;
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
    if (!this.cache || !this.cacheIdentity) return;
    try {
      if (!this.cache.hasKnowledgeSearchSnapshotFor(this.cacheIdentity)) return;
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

  private snapshotDeadlineMs(): number {
    return Math.min(
      SNAPSHOT_DEADLINE_MAX_MS,
      RECONCILIATION_DEADLINE_MS + this.chunks.size * SNAPSHOT_DEADLINE_PER_CHUNK_MS,
    );
  }

  private async synchronizeSnapshot(pb: SearchPocketBase, epoch: number): Promise<void> {
    const fetch = Promise.all([
      pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).getFullList({ requestKey: null }),
      pb.collection(KNOWLEDGE_SEARCH_CHUNKS_COLLECTION).getFullList({ requestKey: null }),
    ]);
    const deadline = rejectedAfter(this.snapshotDeadlineMs(), new Error('refresh-timeout'));
    try {
      const [rawDocuments, rawChunks] = await Promise.race([fetch, deadline.promise]);
      if (!this.isCurrentConnection(epoch, pb)) return;
      const initialSnapshot = parseSnapshot(rawDocuments, rawChunks, this.limits);
      const buffer = this.eventBuffer;
      if (!initialSnapshot || buffer?.epoch !== epoch || buffer.failureReason !== null) {
        throw new Error('invalid-snapshot');
      }
      const snapshot = replaySnapshotEvents(initialSnapshot, buffer.events.values(), this.limits);
      if (!snapshot) throw new Error('invalid-realtime-replay');
      if (!this.isCurrentConnection(epoch, pb)) return;
      this.eventBuffer = null;
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
    if (!this.cache || !this.cacheIdentity) return;
    try {
      if (!this.cache.clearKnowledgeSearchSnapshotMarker()) return;
      const documentsWritten = this.cache.writeCollection(
        KNOWLEDGE_DOCUMENTS_COLLECTION,
        snapshot.cachedDocuments as unknown as Record<string, unknown>[],
      );
      const chunksWritten = this.cache.writeCollection(
        KNOWLEDGE_SEARCH_CHUNKS_COLLECTION,
        snapshot.cachedChunks as unknown as Record<string, unknown>[],
      );
      if (!documentsWritten || !chunksWritten) {
        knowledgeLogger().warn('Wiki search cache persistence failed', {
          reason: 'cache-write-incomplete',
        });
        return;
      }
      this.cache.setKnowledgeSearchSnapshotMarker(this.cacheIdentity);
    } catch {
      knowledgeLogger().warn('Wiki search cache persistence failed', {
        reason: 'cache-write-failed',
      });
    }
  }

  private async subscribe(pb: SearchPocketBase, epoch: number): Promise<void> {
    const documentUnsubscribe = await pb
      .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
      .subscribe('*', (event) => this.routeRealtimeEvent('document', event, epoch, pb));
    if (!this.isCurrentConnection(epoch, pb)) {
      void this.invokeUnsubscriber(documentUnsubscribe);
      return;
    }
    this.unsubscribers.push(documentUnsubscribe);
    const chunkUnsubscribe = await pb
      .collection(KNOWLEDGE_SEARCH_CHUNKS_COLLECTION)
      .subscribe('*', (event) => this.routeRealtimeEvent('chunk', event, epoch, pb));
    if (!this.isCurrentConnection(epoch, pb)) {
      void this.invokeUnsubscriber(chunkUnsubscribe);
      return;
    }
    this.unsubscribers.push(chunkUnsubscribe);

    if (pb.realtime) {
      const previous = pb.realtime.onDisconnect ?? null;
      const handler = (subscriptions: string[]) => {
        previous?.(subscriptions);
        if (subscriptions.length > 0 && this.isCurrentConnection(epoch, pb)) {
          void this.reconcile();
        }
      };
      this.disconnectOwner = { pb, handler, previous };
      pb.realtime.onDisconnect = handler;
    }
  }

  private routeRealtimeEvent(
    kind: BufferedRealtimeEvent['kind'],
    event: RealtimeEvent,
    epoch: number,
    pb: SearchPocketBase,
  ): void {
    if (!this.isCurrentConnection(epoch, pb)) return;
    const normalized = normalizeRealtimeEvent(kind, event);
    if (!normalized) {
      this.rejectRealtimeEvent(epoch, kind, event);
      return;
    }
    if (this.eventBuffer?.epoch === epoch) {
      this.retainBufferedEvent(this.eventBuffer, normalized);
      return;
    }
    this.applyRealtimeEvent(normalized);
  }

  private flushBufferedEvents(epoch: number): void {
    const buffer = this.eventBuffer;
    if (buffer?.epoch !== epoch) return;
    this.eventBuffer = null;
    if (buffer.failureReason) return;
    for (const { event } of buffer.events.values()) {
      if (!this.isCurrent(epoch)) return;
      this.applyRealtimeEvent(event);
    }
  }

  private createEventBuffer(epoch: number): EventBuffer {
    return {
      epoch,
      events: new Map(),
      retainedBytes: 0,
      failureReason: null,
    };
  }

  private rejectRealtimeEvent(
    epoch: number,
    kind: BufferedRealtimeEvent['kind'],
    event: RealtimeEvent,
  ): void {
    if (this.eventBuffer?.epoch === epoch) {
      this.failEventBuffer(this.eventBuffer, 'invalid-event');
      return;
    }
    knowledgeLogger().warn('Skipped invalid Wiki search realtime event', {
      kind,
      recordId: safeRecordId(event.record),
      reason: 'invalid-event',
    });
    void this.reconcile();
  }

  private retainBufferedEvent(buffer: EventBuffer, event: BufferedRealtimeEvent): void {
    if (buffer.failureReason) return;
    const key = `${event.kind}:${event.id}`;
    const previous = buffer.events.get(key);
    const bytes = bufferedEventBytes(event);
    const nextCount = buffer.events.size + (previous ? 0 : 1);
    const nextBytes = buffer.retainedBytes - (previous?.bytes ?? 0) + bytes;
    if (nextCount > this.bufferLimits.maxUniqueEvents) {
      this.failEventBuffer(buffer, 'event-count-limit');
      return;
    }
    if (nextBytes > this.bufferLimits.maxRetainedBytes) {
      this.failEventBuffer(buffer, 'event-byte-limit');
      return;
    }
    buffer.events.delete(key);
    buffer.events.set(key, { event, bytes });
    buffer.retainedBytes = nextBytes;
  }

  private failEventBuffer(
    buffer: EventBuffer,
    reason: NonNullable<EventBuffer['failureReason']>,
  ): void {
    if (buffer.failureReason) return;
    buffer.events.clear();
    buffer.retainedBytes = 0;
    buffer.failureReason = reason;
    knowledgeLogger().warn('Rejected Wiki search realtime buffer', { reason });
    // Dropping buffered events leaves the index stale, not wrong. Blanking availability would take
    // every search offline until the 15-minute timer, so repair it on a backoff instead.
    this.scheduleReconcileRetry();
  }

  private applyRealtimeEvent(event: BufferedRealtimeEvent): void {
    if (event.kind === 'document') this.handleDocumentEvent(event);
    else this.handleChunkEvent(event);
  }

  private handleDocumentEvent(event: Extract<BufferedRealtimeEvent, { kind: 'document' }>): void {
    if (event.action === 'delete') {
      this.documents.delete(event.id);
      this.engine.removeDocument(event.id);
      this.cacheUpdate(KNOWLEDGE_DOCUMENTS_COLLECTION, 'delete', { id: event.id });
      return;
    }
    const document = event.record;
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
    this.refreshDocumentChunks(document, previous);
  }

  private refreshDocumentChunks(
    document: KnowledgeDocumentRecord,
    previous: KnowledgeDocumentRecord | undefined,
  ): void {
    const eligibilityChanged =
      !previous ||
      !eligibleDocument(previous) ||
      previous.checksum !== document.checksum ||
      previous.searchIndexVersion !== document.searchIndexVersion ||
      previous.pageCount !== document.pageCount;
    if (!eligibilityChanged) return;
    for (const chunk of this.chunks.values()) {
      if (chunk.documentId !== document.id) continue;
      if (eligibleChunk(chunk, document)) this.engine.upsertChunk(chunk);
      else this.engine.removeChunk(chunk.id);
    }
  }

  private handleChunkEvent(event: Extract<BufferedRealtimeEvent, { kind: 'chunk' }>): void {
    if (event.action === 'delete') {
      this.deleteStoredChunk(event.id);
      this.engine.removeChunk(event.id);
      this.cacheUpdate(KNOWLEDGE_SEARCH_CHUNKS_COLLECTION, 'delete', { id: event.id });
      return;
    }
    const chunk = event.record;
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
    if (eligibleChunk(chunk, document)) {
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
    if (!this.cache || !this.cacheIdentity) return;
    try {
      if (!this.cache.hasKnowledgeSearchSnapshotFor(this.cacheIdentity)) return;
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

  private backoffDelay(attempts: number): number {
    return Math.min(
      RETRY_MAX_DELAY_MS,
      RETRY_BASE_DELAY_MS * 2 ** Math.min(attempts, RETRY_MAX_EXPONENT),
    );
  }

  private scheduleConnectRetry(pb: PocketBase, epoch: number): void {
    if (this.disposed || this.connectTimer || !this.isCurrent(epoch)) return;
    const delay = this.backoffDelay(this.connectAttempts);
    this.connectAttempts += 1;
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.isCurrent(epoch)) void this.connect(pb);
    }, delay);
    this.connectTimer.unref?.();
  }

  private cancelConnectRetry(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private scheduleReconcileRetry(): void {
    if (this.disposed || this.reconcileTimer || !this.pb) return;
    const delay = this.backoffDelay(this.reconcileAttempts);
    this.reconcileAttempts += 1;
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = null;
      void this.reconcile();
    }, delay);
    this.reconcileTimer.unref?.();
  }

  private cancelReconcileRetry(): void {
    if (this.reconcileTimer) clearTimeout(this.reconcileTimer);
    this.reconcileTimer = null;
  }

  private reconcile(): Promise<void> {
    if (this.disposed || !this.pb) return Promise.resolve();
    const pb = this.pb;
    const epoch = this.connectionEpoch;
    if (this.reconciliation?.epoch === epoch) return this.reconciliation.promise;
    this.eventBuffer = this.createEventBuffer(epoch);
    const promise = this.synchronizeSnapshot(pb, epoch)
      .then(() => {
        if (!this.isCurrentConnection(epoch, pb)) return;
        this.availability = 'ready';
        this.reconcileAttempts = 0;
        this.resetFailures();
      })
      .catch(() => {
        if (!this.isCurrentConnection(epoch, pb)) return;
        this.flushBufferedEvents(epoch);
        this.recordFailure('reconciliation-failed');
      })
      .finally(() => {
        if (this.reconciliation?.epoch === epoch) this.reconciliation = null;
      });
    this.reconciliation = { epoch, promise };
    return promise;
  }

  private async stopSubscriptions(): Promise<void> {
    if (this.reconciliationTimer) clearInterval(this.reconciliationTimer);
    this.reconciliationTimer = null;
    this.cancelReconcileRetry();
    const pb = this.pb;
    const disconnectOwner = this.disconnectOwner;
    if (
      disconnectOwner !== null &&
      disconnectOwner.pb.realtime?.onDisconnect === disconnectOwner.handler
    ) {
      disconnectOwner.pb.realtime.onDisconnect = disconnectOwner.previous;
    }
    this.disconnectOwner = null;
    if (this.eventBuffer?.epoch === this.connectionEpoch) this.eventBuffer = null;
    const unsubscribers = this.unsubscribers.splice(0);
    if (this.pb === pb) this.pb = null;
    await Promise.all(unsubscribers.map((unsubscribe) => this.invokeUnsubscriber(unsubscribe)));
  }

  private async invokeUnsubscriber(unsubscribe: () => void | Promise<void>): Promise<void> {
    const deadline = rejectedAfter(UNSUBSCRIBE_DEADLINE_MS, new Error('unsubscribe-timeout'));
    try {
      await Promise.race([Promise.resolve().then(unsubscribe), deadline.promise]);
    } catch {
      knowledgeLogger().warn('Wiki search unsubscribe failed', {
        reason: 'unsubscribe-failed',
      });
    } finally {
      deadline.cancel();
    }
  }

  private isCurrent(epoch: number): boolean {
    return !this.disposed && this.connectionEpoch === epoch;
  }

  private isCurrentConnection(epoch: number, pb: SearchPocketBase): boolean {
    return this.isCurrent(epoch) && this.pb === pb;
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
