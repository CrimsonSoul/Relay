import { createHash } from 'node:crypto';
import type PocketBase from 'pocketbase';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  normalizeKnowledgeDocumentRecord,
  type KnowledgeDocumentRecord,
} from '@shared/knowledge';
import {
  KNOWLEDGE_SEARCH_CHUNKS_COLLECTION,
  KNOWLEDGE_SEARCH_INDEX_VERSION,
  type KnowledgeSearchChunkRecord,
} from '@shared/knowledgeSearch';
import { loggers } from '../logger';
import { KnowledgeExtractorWorker } from './KnowledgeExtractorWorker';
import { buildKnowledgeSearchPassages } from './knowledgeSearchPassages';

const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9]{1,200}$/;
const PDF_SIGNATURE = '%PDF-';
const WRITE_BATCH_SIZE = 100;

type SearchCollectionPort = {
  getFullList(options?: Record<string, unknown>): Promise<unknown[]>;
  getOne(id: string, options?: Record<string, unknown>): Promise<unknown>;
  update(
    id: string,
    patch: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
  delete(id: string, options?: Record<string, unknown>): Promise<unknown>;
};

type SearchBatchPort = {
  collection(name: string): { create(record: Record<string, unknown>): void };
  send(options?: Record<string, unknown>): Promise<Array<{ status: number; body: unknown }>>;
};

export type KnowledgeSearchStoragePort = {
  collection(name: string): SearchCollectionPort;
  createBatch(): SearchBatchPort;
  files?: {
    getToken(options?: Record<string, unknown>): Promise<string>;
    getURL(
      record: Record<string, unknown>,
      filename: string,
      query?: Record<string, unknown>,
    ): string;
  };
};

export type KnowledgeSearchIndexerOptions = {
  pb: PocketBase | KnowledgeSearchStoragePort;
  extractor?: Pick<KnowledgeExtractorWorker, 'extractSearchPages' | 'stop'>;
  readPdf?: (document: KnowledgeDocumentRecord) => Promise<Uint8Array>;
  now?: () => number;
};

type SearchIndexPatch = {
  searchIndexState: KnowledgeDocumentRecord['searchIndexState'];
  searchIndexChecksum?: string | null;
  searchIndexVersion?: number;
  searchIndexedAt?: string | null;
  searchIndexError: KnowledgeDocumentRecord['searchIndexError'] | '';
};

function storageError(): Error {
  return new Error('search-storage-unavailable');
}

function searchIndexError(error: unknown): KnowledgeDocumentRecord['searchIndexError'] {
  if (error instanceof Error && error.message === 'no-searchable-text') {
    return 'no-searchable-text';
  }
  if (error instanceof Error && error.message === 'search-storage-unavailable') {
    return 'storage-unavailable';
  }
  return 'extraction-failed';
}

function checksumOf(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function validPdfBytes(data: Uint8Array, document: KnowledgeDocumentRecord): boolean {
  return (
    data.byteLength === document.byteSize &&
    Buffer.from(data.subarray(0, PDF_SIGNATURE.length)).toString('ascii') === PDF_SIGNATURE &&
    checksumOf(data) === document.checksum
  );
}

function chunkIdentity(record: Pick<KnowledgeSearchChunkRecord, 'pageNumber' | 'passageNumber'>) {
  return `${record.pageNumber}:${record.passageNumber}`;
}

export class KnowledgeSearchIndexer {
  private readonly pb: KnowledgeSearchStoragePort;
  private readonly extractor: Pick<KnowledgeExtractorWorker, 'extractSearchPages' | 'stop'>;
  private readonly readPdf: (document: KnowledgeDocumentRecord) => Promise<Uint8Array>;
  private readonly now: () => number;
  private readonly pending = new Set<string>();
  private readonly cancelledActive = new Set<string>();
  private readonly idleWaiters = new Set<() => void>();
  private running = false;
  private disposed = false;
  private activeDocumentId: string | null = null;
  private pumpPromise: Promise<void> | null = null;

  constructor(options: KnowledgeSearchIndexerOptions) {
    this.pb = options.pb as KnowledgeSearchStoragePort;
    this.extractor = options.extractor ?? new KnowledgeExtractorWorker();
    this.readPdf = options.readPdf ?? ((document) => this.readProtectedPdf(document));
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    if (this.disposed) return;
    try {
      const documents = await this.readActiveDocuments();
      if (this.disposed) return;
      for (const document of documents) {
        if (!this.isCurrent(document)) this.pending.add(document.id);
      }
      this.kickPump();
    } catch (error) {
      loggers.main.warn('Wiki search backfill is unavailable', { error });
    }
  }

  enqueue(documentId: string): void {
    if (this.disposed || !DOCUMENT_ID_PATTERN.test(documentId)) return;
    this.pending.add(documentId);
    this.kickPump();
  }

  retry(documentId: string): void {
    this.enqueue(documentId);
  }

  async remove(documentId: string): Promise<void> {
    if (!DOCUMENT_ID_PATTERN.test(documentId)) return;
    this.pending.delete(documentId);
    if (this.activeDocumentId === documentId) this.cancelledActive.add(documentId);
    try {
      await this.deleteChunks(documentId, () => true, false);
    } catch (error) {
      loggers.main.warn('Wiki search chunk removal is unavailable', { error });
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.pending.clear();
    try {
      await this.extractor.stop();
    } catch (error) {
      loggers.main.warn('Wiki search extractor shutdown failed', { error });
    }
    try {
      await this.pumpPromise;
    } catch {
      // pump() contains per-document failures; this only protects the public boundary.
    }
    this.resolveIdleWaiters();
  }

  whenIdleForTest(): Promise<void> {
    if (!this.running && this.pending.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  private kickPump(): void {
    if (this.running || this.disposed) return;
    const pump = this.pump();
    this.pumpPromise = pump;
    void pump.finally(() => {
      if (this.pumpPromise === pump) this.pumpPromise = null;
    });
  }

  private async pump(): Promise<void> {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (!this.disposed && this.pending.size > 0) {
        const documentId = this.pending.values().next().value as string | undefined;
        if (!documentId) break;
        this.pending.delete(documentId);
        this.activeDocumentId = documentId;
        try {
          await this.processDocument(documentId);
        } catch (error) {
          loggers.main.warn('Wiki search document indexing failed', { documentId, error });
        } finally {
          this.cancelledActive.delete(documentId);
          this.activeDocumentId = null;
        }
      }
    } finally {
      this.running = false;
      this.resolveIdleWaiters();
    }
  }

  private async processDocument(documentId: string): Promise<void> {
    let jobChecksum: string | null = null;
    try {
      const document = await this.readActiveDocument(documentId);
      if (!document || this.isCurrent(document) || this.isCancelled(documentId)) return;
      jobChecksum = document.checksum;

      const pending = await this.patchIfCurrent(documentId, jobChecksum, {
        searchIndexState: 'pending',
        searchIndexError: '',
      });
      if (!pending || this.isCancelled(documentId)) return;

      const bytes = await this.readPdf(document);
      if (!validPdfBytes(bytes, document)) throw new Error('invalid-pdf');
      if (this.isCancelled(documentId)) return;

      const pages = await this.extractor.extractSearchPages(bytes);
      if (this.isCancelled(documentId)) return;
      const passages = buildKnowledgeSearchPassages(pages, document.outline);
      if (passages.length === 0) throw new Error('no-searchable-text');

      await this.deleteChunks(
        documentId,
        (chunk) =>
          chunk.checksum === jobChecksum && chunk.indexVersion === KNOWLEDGE_SEARCH_INDEX_VERSION,
        true,
      );
      if (this.isCancelled(documentId)) return;

      const indexedAt = new Date(this.now()).toISOString();
      await this.createChunks(document, passages, indexedAt);
      if (this.isCancelled(documentId)) {
        this.startCleanup(
          documentId,
          (chunk) =>
            chunk.checksum === jobChecksum && chunk.indexVersion === KNOWLEDGE_SEARCH_INDEX_VERSION,
        );
        return;
      }
      await this.verifyManifest(document, passages);
      if (this.isCancelled(documentId)) return;

      const activated = await this.patchIfCurrent(documentId, jobChecksum, {
        searchIndexState: 'ready',
        searchIndexChecksum: jobChecksum,
        searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
        searchIndexedAt: indexedAt,
        searchIndexError: '',
      });
      if (!activated) {
        this.startCleanup(
          documentId,
          (chunk) =>
            chunk.checksum === jobChecksum && chunk.indexVersion === KNOWLEDGE_SEARCH_INDEX_VERSION,
        );
        return;
      }

      this.startCleanup(
        documentId,
        (chunk) =>
          chunk.checksum !== jobChecksum || chunk.indexVersion !== KNOWLEDGE_SEARCH_INDEX_VERSION,
      );
    } catch (error) {
      if (this.isCancelled(documentId) || jobChecksum === null) return;
      await this.markFailed(documentId, jobChecksum, searchIndexError(error));
    }
  }

  private async readActiveDocuments(): Promise<KnowledgeDocumentRecord[]> {
    const raw = await this.storageCall(() =>
      this.pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).getFullList({
        filter: 'lifecycleState = "active"',
        requestKey: null,
      }),
    );
    return raw
      .map(normalizeKnowledgeDocumentRecord)
      .filter(
        (document): document is KnowledgeDocumentRecord =>
          document !== null && document.lifecycleState === 'active',
      );
  }

  private async readActiveDocument(documentId: string): Promise<KnowledgeDocumentRecord | null> {
    const raw = await this.storageCall(() =>
      this.pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).getOne(documentId, { requestKey: null }),
    );
    const document = normalizeKnowledgeDocumentRecord(raw);
    return document?.lifecycleState === 'active' ? document : null;
  }

  private isCurrent(document: KnowledgeDocumentRecord): boolean {
    return (
      document.searchIndexState === 'ready' &&
      document.searchIndexChecksum === document.checksum &&
      document.searchIndexVersion === KNOWLEDGE_SEARCH_INDEX_VERSION
    );
  }

  private isCancelled(documentId: string): boolean {
    return this.disposed || this.cancelledActive.has(documentId);
  }

  private async patchIfCurrent(
    documentId: string,
    checksum: string,
    patch: SearchIndexPatch,
  ): Promise<boolean> {
    const current = await this.readActiveDocument(documentId);
    if (!current || current.checksum !== checksum || this.disposed) return false;
    await this.storageCall(() =>
      this.pb
        .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
        .update(documentId, patch, { requestKey: null }),
    );
    return true;
  }

  private async markFailed(
    documentId: string,
    checksum: string,
    error: NonNullable<KnowledgeDocumentRecord['searchIndexError']>,
  ): Promise<void> {
    try {
      const current = await this.readActiveDocument(documentId);
      if (!current || current.checksum !== checksum || this.disposed) return;
      await this.storageCall(() =>
        this.pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).update(
          documentId,
          {
            searchIndexState: 'failed',
            searchIndexChecksum: current.searchIndexChecksum,
            searchIndexVersion: current.searchIndexVersion,
            searchIndexedAt: current.searchIndexedAt,
            searchIndexError: error,
          },
          { requestKey: null },
        ),
      );
    } catch (statusError) {
      loggers.main.warn('Wiki search failure status is unavailable', {
        documentId,
        error: statusError,
      });
    }
  }

  private async createChunks(
    document: KnowledgeDocumentRecord,
    passages: ReturnType<typeof buildKnowledgeSearchPassages>,
    indexedAt: string,
  ): Promise<void> {
    for (let offset = 0; offset < passages.length; offset += WRITE_BATCH_SIZE) {
      const batchPassages = passages.slice(offset, offset + WRITE_BATCH_SIZE);
      const batch = this.pb.createBatch();
      const collection = batch.collection(KNOWLEDGE_SEARCH_CHUNKS_COLLECTION);
      for (const passage of batchPassages) {
        collection.create({
          documentId: document.id,
          checksum: document.checksum,
          ...passage,
          indexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
          indexedAt,
        });
      }
      const results = await this.storageCall(() => batch.send({ requestKey: null }));
      if (
        results.length !== batchPassages.length ||
        results.some(({ status }) => status < 200 || status >= 300)
      ) {
        throw storageError();
      }
    }
  }

  private async verifyManifest(
    document: KnowledgeDocumentRecord,
    passages: ReturnType<typeof buildKnowledgeSearchPassages>,
  ): Promise<void> {
    const chunks = await this.readDocumentChunks(document.id);
    const manifest = chunks.filter(
      (chunk) =>
        chunk.checksum === document.checksum &&
        chunk.indexVersion === KNOWLEDGE_SEARCH_INDEX_VERSION,
    );
    const compareIdentity = (left: string, right: string) => left.localeCompare(right);
    const expected = passages.map(chunkIdentity).toSorted(compareIdentity);
    const actual = manifest.map(chunkIdentity).toSorted(compareIdentity);
    if (
      actual.length !== expected.length ||
      actual.some((identity, index) => identity !== expected[index])
    ) {
      throw storageError();
    }
  }

  private async readDocumentChunks(documentId: string): Promise<KnowledgeSearchChunkRecord[]> {
    const raw = await this.storageCall(() =>
      this.pb.collection(KNOWLEDGE_SEARCH_CHUNKS_COLLECTION).getFullList({
        filter: `documentId = "${documentId}"`,
        requestKey: null,
      }),
    );
    return raw.filter((record): record is KnowledgeSearchChunkRecord => {
      if (!record || typeof record !== 'object') return false;
      const chunk = record as Partial<KnowledgeSearchChunkRecord>;
      return (
        typeof chunk.id === 'string' &&
        chunk.documentId === documentId &&
        typeof chunk.checksum === 'string' &&
        Number.isInteger(chunk.pageNumber) &&
        Number.isInteger(chunk.passageNumber) &&
        Number.isInteger(chunk.indexVersion)
      );
    });
  }

  private async deleteChunks(
    documentId: string,
    predicate: (chunk: KnowledgeSearchChunkRecord) => boolean,
    required: boolean,
  ): Promise<void> {
    let chunks: KnowledgeSearchChunkRecord[];
    try {
      chunks = await this.readDocumentChunks(documentId);
    } catch (error) {
      if (required) throw error;
      return;
    }
    const collection = this.pb.collection(KNOWLEDGE_SEARCH_CHUNKS_COLLECTION);
    for (const chunk of chunks) {
      if (!predicate(chunk)) continue;
      try {
        await collection.delete(chunk.id, { requestKey: null });
      } catch (error) {
        if (required) throw storageError();
        loggers.main.warn('Wiki search chunk cleanup failed', { documentId, error });
      }
    }
  }

  private startCleanup(
    documentId: string,
    predicate: (chunk: KnowledgeSearchChunkRecord) => boolean,
  ): void {
    void this.deleteChunks(documentId, predicate, false).catch((error) => {
      loggers.main.warn('Wiki search chunk cleanup is unavailable', { documentId, error });
    });
  }

  private async readProtectedPdf(document: KnowledgeDocumentRecord): Promise<Uint8Array> {
    if (!this.pb.files) throw new Error('protected-pdf-unavailable');
    const raw = await this.storageCall(() =>
      this.pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).getOne(document.id, { requestKey: null }),
    );
    if (!raw || typeof raw !== 'object') throw new Error('protected-pdf-unavailable');
    const token = await this.pb.files.getToken({ requestKey: null });
    const url = this.pb.files.getURL(raw as Record<string, unknown>, document.pdf, { token });
    if (!url) throw new Error('protected-pdf-unavailable');
    const response = await fetch(url);
    if (!response.ok) throw new Error('protected-pdf-unavailable');
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > document.byteSize) {
      throw new Error('invalid-pdf');
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  private async storageCall<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw storageError();
    }
  }

  private resolveIdleWaiters(): void {
    if (this.running || this.pending.size > 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}
