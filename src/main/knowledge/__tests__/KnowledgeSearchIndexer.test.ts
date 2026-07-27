import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_SEARCH_MAX_CHUNKS_PER_DOCUMENT,
  type KnowledgeDocumentRecord,
} from '@shared/knowledge';
import {
  KNOWLEDGE_SEARCH_INDEX_VERSION,
  type KnowledgeSearchChunkRecord,
} from '@shared/knowledgeSearch';
import { KnowledgeSearchIndexer, type KnowledgeSearchStoragePort } from '../KnowledgeSearchIndexer';
import type { KnowledgeSearchExtractedPage } from '../knowledgeSearchExtraction';

const NOW = Date.parse('2026-07-19T12:00:00.000Z');
const PDF_PREFIX = '%PDF-';

function pdf(id: string): Uint8Array {
  return new TextEncoder().encode(`${PDF_PREFIX}${id}`);
}

function checksum(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function document(
  id = 'document1',
  overrides: Partial<KnowledgeDocumentRecord> = {},
): KnowledgeDocumentRecord {
  const bytes = pdf(id);
  return {
    id,
    sourceKey: `source-${id}`,
    category: 'Operations',
    categoryId: null,
    documentType: 'sop',
    title: `Guide ${id}`,
    displayTitle: `Guide ${id}`,
    fileName: `${id}.pdf`,
    pdf: `${id}.pdf`,
    cover: null,
    checksum: checksum(bytes),
    byteSize: bytes.byteLength,
    pageCount: 1,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: '2026-07-19T10:00:00.000Z',
    indexedAt: '2026-07-19T10:00:00.000Z',
    lifecycleState: 'active',
    revision: 7,
    publishedByAccountId: 'account1',
    publishedByName: 'Publisher',
    publishedAt: '2026-07-19T10:00:00.000Z',
    trashedByAccountId: null,
    trashedByName: null,
    trashedAt: null,
    searchIndexState: 'pending',
    searchIndexChecksum: null,
    searchIndexVersion: 0,
    searchIndexedAt: null,
    searchIndexError: null,
    created: '2026-07-19T10:00:00.000Z',
    updated: '2026-07-19T10:00:00.000Z',
    ...overrides,
  };
}

type ChunkCreate = Omit<KnowledgeSearchChunkRecord, 'id' | 'created' | 'updated'>;

type StorageGate = { entered: () => void; wait: Promise<void> };

function controlledGate(): {
  entered: Promise<void>;
  release: () => void;
  hook: StorageGate;
} {
  let markEntered!: () => void;
  let release!: () => void;
  return {
    entered: new Promise<void>((resolve) => {
      markEntered = resolve;
    }),
    release: () => release(),
    hook: {
      entered: () => markEntered(),
      wait: new Promise<void>((resolve) => {
        release = resolve;
      }),
    },
  };
}

class FakeSearchStorage implements KnowledgeSearchStoragePort {
  readonly documents = new Map<string, KnowledgeDocumentRecord>();
  readonly chunks = new Map<string, KnowledgeSearchChunkRecord>();
  readonly documentUpdates: Array<Record<string, unknown>> = [];
  readonly chunkCreates: ChunkCreate[] = [];
  readonly chunkDeletes: KnowledgeSearchChunkRecord[] = [];
  readonly batchSizes: number[] = [];
  documentListError: Error | null = null;
  chunkListError: Error | null = null;
  deleteError: Error | null = null;
  documentUpdateError: Error | null = null;
  partialBatchWrites: number | null = null;
  failBatchNumber: number | null = null;
  chunkListGate: ({ call: number } & StorageGate) | null = null;
  batchSendGate: ({ batch: number } & StorageGate) | null = null;
  chunkDeleteGate: StorageGate | null = null;
  private nextChunkId = 1;
  private chunkListCalls = 0;

  constructor(documents: readonly KnowledgeDocumentRecord[]) {
    for (const record of documents) this.documents.set(record.id, structuredClone(record));
  }

  collection(name: string) {
    if (name === 'knowledge_documents') {
      return {
        getFullList: async () => {
          if (this.documentListError) throw this.documentListError;
          return [...this.documents.values()].map((record) => structuredClone(record));
        },
        getOne: async (id: string) => {
          const record = this.documents.get(id);
          if (!record) throw new Error('record-not-found');
          return structuredClone(record);
        },
        update: async (id: string, patch: Record<string, unknown>) => {
          if (this.documentUpdateError) throw this.documentUpdateError;
          const record = this.documents.get(id);
          if (!record) throw new Error('record-not-found');
          this.documentUpdates.push({ id, ...structuredClone(patch) });
          const storedPatch = {
            ...patch,
            ...(patch.searchIndexError === '' ? { searchIndexError: null } : {}),
          };
          const updated = { ...record, ...storedPatch } as KnowledgeDocumentRecord;
          this.documents.set(id, updated);
          return structuredClone(updated);
        },
        delete: async () => true,
      };
    }

    if (name === 'knowledge_search_chunks') {
      return {
        getFullList: async () => {
          if (this.chunkListError) throw this.chunkListError;
          this.chunkListCalls += 1;
          if (this.chunkListGate?.call === this.chunkListCalls) {
            this.chunkListGate.entered();
            await this.chunkListGate.wait;
          }
          return [...this.chunks.values()].map((record) => structuredClone(record));
        },
        getOne: async (id: string) => {
          const record = this.chunks.get(id);
          if (!record) throw new Error('record-not-found');
          return structuredClone(record);
        },
        update: async () => ({}),
        delete: async (id: string) => {
          if (this.deleteError) throw this.deleteError;
          const record = this.chunks.get(id);
          if (record && this.chunkDeleteGate) {
            this.chunkDeleteGate.entered();
            await this.chunkDeleteGate.wait;
          }
          if (record) this.chunkDeletes.push(structuredClone(record));
          this.chunks.delete(id);
          return true;
        },
      };
    }

    throw new Error(`Unexpected collection: ${name}`);
  }

  createBatch() {
    const creates: ChunkCreate[] = [];
    return {
      collection: (name: string) => {
        if (name !== 'knowledge_search_chunks') throw new Error(`Unexpected batch: ${name}`);
        return { create: (record: Record<string, unknown>) => creates.push(record as ChunkCreate) };
      },
      send: async () => {
        this.batchSizes.push(creates.length);
        const batchNumber = this.batchSizes.length;
        if (this.batchSendGate?.batch === batchNumber) {
          this.batchSendGate.entered();
          await this.batchSendGate.wait;
        }
        if (this.failBatchNumber === batchNumber) throw new Error('batch-write-failed');
        const writeCount = this.partialBatchWrites ?? creates.length;
        for (const create of creates.slice(0, writeCount)) {
          this.chunkCreates.push(structuredClone(create));
          const id = `chunk${this.nextChunkId++}`;
          this.chunks.set(id, {
            id,
            ...structuredClone(create),
            created: create.indexedAt,
            updated: create.indexedAt,
          });
        }
        return creates.map(() => ({ status: 200, body: {} }));
      },
    };
  }
}

type HarnessOptions = {
  documents?: KnowledgeDocumentRecord[];
  pagesByDocument?: Map<string, KnowledgeSearchExtractedPage[]>;
  extractionFailures?: Set<string>;
  bytesByDocument?: Map<string, Uint8Array>;
  onExtract?: (documentId: string) => void | Promise<void>;
  extractionGate?: Promise<void>;
};

function extractedPage(
  pageNumber = 1,
  text = 'Reset the service safely.',
): KnowledgeSearchExtractedPage {
  return {
    pageNumber,
    items: [{ str: text, hasEOL: false, transform: [1, 0, 0, 1, 0, 0], height: 12 }],
  };
}

function createHarness(options: HarnessOptions = {}) {
  const documents = options.documents ?? [document()];
  const storage = new FakeSearchStorage(documents);
  const processedDocumentIds: string[] = [];
  let activeDocumentId = '';
  let activeExtractions = 0;
  let maximumConcurrentExtractions = 0;
  let stopped = false;
  const extractor = {
    extractSearchPages: vi.fn(async () => {
      const documentId = activeDocumentId;
      processedDocumentIds.push(documentId);
      activeExtractions += 1;
      maximumConcurrentExtractions = Math.max(maximumConcurrentExtractions, activeExtractions);
      try {
        await options.onExtract?.(documentId);
        await options.extractionGate;
        if (stopped) throw new Error('extractor-stopped');
        if (options.extractionFailures?.has(documentId)) throw new Error('extraction-timeout');
        return options.pagesByDocument?.get(documentId) ?? [extractedPage()];
      } finally {
        activeExtractions -= 1;
      }
    }),
    stop: vi.fn(async () => {
      stopped = true;
    }),
  };
  const readPdf = vi.fn(async (record: KnowledgeDocumentRecord) => {
    activeDocumentId = record.id;
    return options.bytesByDocument?.get(record.id)?.slice() ?? pdf(record.id);
  });
  const indexer = new KnowledgeSearchIndexer({
    pb: storage,
    extractor,
    readPdf,
    now: () => NOW,
  });
  return {
    indexer,
    storage,
    extractor,
    readPdf,
    processedDocumentIds,
    maximumConcurrentExtractions: () => maximumConcurrentExtractions,
  };
}

async function settleHousekeeping(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('KnowledgeSearchIndexer', () => {
  it('records trigger rejection as failed and recovers through the existing retry queue', async () => {
    const current = document('triggerfailure');
    const { indexer, storage } = createHarness({ documents: [current] });

    await indexer.recordTriggerFailure({
      documentId: current.id,
      expectedChecksum: current.checksum,
      expectedRevision: current.revision,
    });

    expect(storage.documents.get(current.id)).toMatchObject({
      searchIndexState: 'failed',
      searchIndexChecksum: null,
      searchIndexError: 'storage-unavailable',
      revision: current.revision,
    });
    expect(storage.documentUpdates.at(-1)).not.toHaveProperty('revision');

    indexer.retry(current.id);
    await indexer.whenIdleForTest();

    expect(storage.documents.get(current.id)).toMatchObject({
      searchIndexState: 'ready',
      searchIndexChecksum: current.checksum,
      searchIndexError: null,
    });
  });

  it.each([
    ['checksum', { expectedChecksum: 'f'.repeat(64), expectedRevision: 7 }],
    ['revision', { expectedChecksum: checksum(pdf('staleidentity')), expectedRevision: 6 }],
  ])('ignores a trigger rejection with stale %s identity', async (_field, staleIdentity) => {
    const current = document('staleidentity');
    const { indexer, storage } = createHarness({ documents: [current] });

    await indexer.recordTriggerFailure({ documentId: current.id, ...staleIdentity });

    expect(storage.documents.get(current.id)).toMatchObject({
      searchIndexState: 'pending',
      searchIndexError: null,
      revision: current.revision,
    });
    expect(storage.documentUpdates).toEqual([]);
  });

  it('keeps a restored matching checksum ready when its trigger is rejected', async () => {
    const current = document('restoredready', {
      revision: 8,
      searchIndexState: 'ready',
      searchIndexChecksum: checksum(pdf('restoredready')),
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      searchIndexedAt: '2026-07-18T10:00:00.000Z',
    });
    const { indexer, storage } = createHarness({ documents: [current] });

    await indexer.recordTriggerFailure({
      documentId: current.id,
      expectedChecksum: current.checksum,
      expectedRevision: current.revision,
    });

    expect(storage.documents.get(current.id)).toMatchObject({
      searchIndexState: 'ready',
      searchIndexChecksum: current.checksum,
      revision: current.revision,
    });
    expect(storage.documentUpdates).toEqual([]);
  });

  it('contains a trigger failure status update rejection', async () => {
    const current = document('statusrejection');
    const { indexer, storage } = createHarness({ documents: [current] });
    storage.documentUpdateError = new Error('secret-bearing-status-rejection');

    await expect(
      indexer.recordTriggerFailure({
        documentId: current.id,
        expectedChecksum: current.checksum,
        expectedRevision: current.revision,
      }),
    ).resolves.toBeUndefined();

    expect(storage.documents.get(current.id)).toMatchObject({
      searchIndexState: 'pending',
      searchIndexError: null,
    });
  });

  it('activates only a complete checksum-matched passage set without changing revision', async () => {
    const current = document();
    const { indexer, storage } = createHarness({ documents: [current] });

    await indexer.start();
    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();

    expect(storage.chunkCreates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ documentId: current.id, checksum: current.checksum }),
      ]),
    );
    expect(storage.documentUpdates.at(-1)).toMatchObject({
      searchIndexState: 'ready',
      searchIndexChecksum: current.checksum,
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      searchIndexedAt: '2026-07-19T12:00:00.000Z',
      searchIndexError: '',
    });
    expect(storage.documentUpdates.every((patch) => !('revision' in patch))).toBe(true);
  });

  it('preserves the previous ready checksum when replacement extraction times out', async () => {
    const current = document('document1', {
      searchIndexState: 'ready',
      searchIndexChecksum: 'a'.repeat(64),
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      searchIndexedAt: '2026-07-18T10:00:00.000Z',
    });
    const { indexer, storage } = createHarness({
      documents: [current],
      extractionFailures: new Set([current.id]),
    });
    storage.chunks.set('old-chunk', {
      id: 'old-chunk',
      documentId: current.id,
      checksum: 'a'.repeat(64),
      pageNumber: 1,
      passageNumber: 1,
      headingId: null,
      heading: null,
      text: 'Old ready content',
      normalizedText: 'old ready content',
      normalizedStart: 0,
      normalizedEnd: 17,
      indexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      indexedAt: '2026-07-18T10:00:00.000Z',
      created: '2026-07-18T10:00:00.000Z',
      updated: '2026-07-18T10:00:00.000Z',
    });

    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();

    expect(storage.documentUpdates.at(-1)).toMatchObject({
      searchIndexState: 'failed',
      searchIndexChecksum: 'a'.repeat(64),
      searchIndexError: 'extraction-failed',
    });
    expect(storage.chunkDeletes).not.toContainEqual(
      expect.objectContaining({ checksum: 'a'.repeat(64) }),
    );
  });

  it('contains one corrupt document and continues with concurrency one', async () => {
    const bad = document('baddocument');
    const good = document('gooddocument');
    const { indexer, processedDocumentIds, maximumConcurrentExtractions, storage } = createHarness({
      documents: [bad, good],
      extractionFailures: new Set([bad.id]),
    });

    indexer.enqueue(bad.id);
    indexer.enqueue(good.id);
    await indexer.whenIdleForTest();

    expect(processedDocumentIds).toEqual([bad.id, good.id]);
    expect(maximumConcurrentExtractions()).toBe(1);
    expect(storage.documents.get(good.id)).toMatchObject({ searchIndexState: 'ready' });
  });

  it('coalesces duplicate enqueues while a document is active', async () => {
    let releaseExtraction!: () => void;
    const extractionGate = new Promise<void>((resolve) => {
      releaseExtraction = resolve;
    });
    const current = document();
    const { indexer, extractor } = createHarness({ documents: [current], extractionGate });

    indexer.enqueue(current.id);
    await vi.waitFor(() => expect(extractor.extractSearchPages).toHaveBeenCalledTimes(1));
    indexer.enqueue(current.id);
    indexer.enqueue(current.id);
    releaseExtraction();
    await indexer.whenIdleForTest();

    expect(extractor.extractSearchPages).toHaveBeenCalledTimes(1);
  });

  it('backfills pending, failed, checksum-mismatched, and old-version active records only', async () => {
    const pending = document('pending');
    const failed = document('failed', {
      searchIndexState: 'failed',
      searchIndexError: 'extraction-failed',
    });
    const mismatch = document('mismatch', {
      searchIndexState: 'ready',
      searchIndexChecksum: 'b'.repeat(64),
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      searchIndexedAt: '2026-07-18T10:00:00.000Z',
    });
    const oldVersion = document('oldversion', {
      searchIndexState: 'ready',
      searchIndexChecksum: checksum(pdf('oldversion')),
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION + 1,
      searchIndexedAt: '2026-07-18T10:00:00.000Z',
    });
    const current = document('current', {
      searchIndexState: 'ready',
      searchIndexChecksum: checksum(pdf('current')),
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      searchIndexedAt: '2026-07-18T10:00:00.000Z',
    });
    const trashed = document('trashed', {
      lifecycleState: 'trashed',
      trashedByAccountId: 'account1',
      trashedByName: 'Publisher',
      trashedAt: '2026-07-19T11:00:00.000Z',
    });
    const { indexer, processedDocumentIds } = createHarness({
      documents: [pending, failed, mismatch, oldVersion, current, trashed],
    });

    await indexer.start();
    await indexer.whenIdleForTest();

    expect(processedDocumentIds).toEqual(['pending', 'failed', 'mismatch', 'oldversion']);
  });

  it('backfills a legacy PocketBase record with blank optional search metadata', async () => {
    const legacy = {
      ...document('legacyblankmetadata'),
      searchIndexState: '',
      searchIndexChecksum: '',
      searchIndexVersion: 0,
      searchIndexedAt: '',
      searchIndexError: '',
    } as unknown as KnowledgeDocumentRecord;
    const { indexer, storage, processedDocumentIds } = createHarness({ documents: [legacy] });

    await indexer.start();
    await indexer.whenIdleForTest();

    expect(processedDocumentIds).toEqual([legacy.id]);
    expect(storage.documents.get(legacy.id)).toMatchObject({
      searchIndexState: 'ready',
      searchIndexChecksum: legacy.checksum,
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      searchIndexError: null,
    });
  });

  it('reindexes a stale ready document whose PocketBase timestamp uses a space separator', async () => {
    const stale = document('pocketbasetimestamp', {
      searchIndexState: 'ready',
      searchIndexChecksum: 'b'.repeat(64),
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      searchIndexedAt: '2026-07-19 10:00:00.000Z',
    });
    const { indexer, storage, processedDocumentIds } = createHarness({ documents: [stale] });

    await indexer.start();
    await indexer.whenIdleForTest();

    expect(processedDocumentIds).toEqual([stale.id]);
    expect(storage.documents.get(stale.id)).toMatchObject({
      searchIndexState: 'ready',
      searchIndexChecksum: stale.checksum,
    });
  });

  it('makes startup failure best-effort and accepts later queue work', async () => {
    const current = document();
    const { indexer, storage } = createHarness({ documents: [current] });
    storage.documentListError = new Error('storage-offline');

    await expect(indexer.start()).resolves.toBeUndefined();
    storage.documentListError = null;
    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();

    expect(storage.documents.get(current.id)).toMatchObject({ searchIndexState: 'ready' });
  });

  it('retries a failed document through the same safe queue', async () => {
    const current = document('retrydocument', {
      searchIndexState: 'failed',
      searchIndexError: 'extraction-failed',
    });
    const { indexer, storage } = createHarness({ documents: [current] });

    expect(() => indexer.retry(current.id)).not.toThrow();
    await indexer.whenIdleForTest();

    expect(storage.documents.get(current.id)).toMatchObject({
      searchIndexState: 'ready',
      searchIndexChecksum: current.checksum,
    });
  });

  it('fails image-only PDFs safely without deleting valid PDF metadata', async () => {
    const current = document('imageonly');
    const pages = new Map([[current.id, [{ pageNumber: 1, items: [] }]]]);
    const { indexer, storage } = createHarness({ documents: [current], pagesByDocument: pages });

    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();

    expect(storage.documentUpdates.at(-1)).toMatchObject({
      searchIndexState: 'failed',
      searchIndexChecksum: null,
      searchIndexError: 'no-searchable-text',
    });
    expect(storage.documents.get(current.id)).toMatchObject({
      checksum: current.checksum,
      byteSize: current.byteSize,
      pdf: current.pdf,
    });
    expect(storage.chunkCreates).toEqual([]);
  });

  it.each([
    ['wrong byte size', pdf('short')],
    ['missing PDF signature', new TextEncoder().encode('plain text')],
    ['checksum mismatch', new TextEncoder().encode('%PDF-tampered')],
  ])('validates PDF bytes before extraction: %s', async (_label, invalidBytes) => {
    const current = document();
    const { indexer, extractor, storage } = createHarness({
      documents: [current],
      bytesByDocument: new Map([[current.id, invalidBytes]]),
    });

    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();

    expect(extractor.extractSearchPages).not.toHaveBeenCalled();
    expect(storage.documents.get(current.id)).toMatchObject({
      searchIndexState: 'failed',
      searchIndexError: 'extraction-failed',
    });
  });

  it('never publishes or fails a job after the document checksum changes', async () => {
    const current = document();
    const replacementBytes = pdf('replacementbytes');
    const { indexer, storage } = createHarness({
      documents: [current],
      onExtract: () => {
        const latest = storage.documents.get(current.id)!;
        storage.documents.set(current.id, {
          ...latest,
          checksum: checksum(replacementBytes),
          byteSize: replacementBytes.byteLength,
          revision: latest.revision + 1,
        });
      },
    });

    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();

    expect(storage.documentUpdates).toHaveLength(1);
    expect(storage.documentUpdates[0]).toMatchObject({ searchIndexState: 'pending' });
    expect(storage.documentUpdates).not.toContainEqual(
      expect.objectContaining({ searchIndexState: 'ready' }),
    );
    expect(storage.documentUpdates).not.toContainEqual(
      expect.objectContaining({ searchIndexState: 'failed' }),
    );
  });

  it('coalesces replacement enqueues behind a stale active checksum job', async () => {
    let releaseExtraction!: () => void;
    const extractionGate = new Promise<void>((resolve) => {
      releaseExtraction = resolve;
    });
    const current = document();
    const replacementBytes = pdf('replacementcontent');
    const bytesByDocument = new Map([[current.id, pdf(current.id)]]);
    const { indexer, extractor, storage, processedDocumentIds } = createHarness({
      documents: [current],
      bytesByDocument,
      extractionGate,
    });

    indexer.enqueue(current.id);
    await vi.waitFor(() => expect(extractor.extractSearchPages).toHaveBeenCalledTimes(1));
    const pending = storage.documents.get(current.id)!;
    storage.documents.set(current.id, {
      ...pending,
      checksum: checksum(replacementBytes),
      byteSize: replacementBytes.byteLength,
      revision: pending.revision + 1,
    });
    bytesByDocument.set(current.id, replacementBytes);
    indexer.enqueue(current.id);
    indexer.enqueue(current.id);
    releaseExtraction();
    await indexer.whenIdleForTest();

    expect(processedDocumentIds).toEqual([current.id, current.id]);
    expect(storage.documents.get(current.id)).toMatchObject({
      searchIndexState: 'ready',
      searchIndexChecksum: checksum(replacementBytes),
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
    });
  });

  it('finishes activated cleanup before a queued replacement can publish its manifest', async () => {
    const current = document();
    const replacementBytes = pdf('serializedreplacement');
    const bytesByDocument = new Map([[current.id, pdf(current.id)]]);
    const { indexer, storage, processedDocumentIds } = createHarness({
      documents: [current],
      bytesByDocument,
    });
    const cleanupList = controlledGate();
    storage.chunkListGate = { call: 3, ...cleanupList.hook };

    indexer.enqueue(current.id);
    await cleanupList.entered;
    const activated = storage.documents.get(current.id)!;
    storage.documents.set(current.id, {
      ...activated,
      checksum: checksum(replacementBytes),
      byteSize: replacementBytes.byteLength,
      revision: activated.revision + 1,
    });
    bytesByDocument.set(current.id, replacementBytes);
    indexer.enqueue(current.id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    cleanupList.release();
    await indexer.whenIdleForTest();
    await settleHousekeeping();

    const replacementManifest = [...storage.chunks.values()].filter(
      (chunk) =>
        chunk.documentId === current.id &&
        chunk.checksum === checksum(replacementBytes) &&
        chunk.indexVersion === KNOWLEDGE_SEARCH_INDEX_VERSION,
    );
    expect(processedDocumentIds).toEqual([current.id, current.id]);
    expect(storage.documents.get(current.id)).toMatchObject({
      searchIndexState: 'ready',
      searchIndexChecksum: checksum(replacementBytes),
    });
    expect(replacementManifest).toHaveLength(1);
  });

  it('rejects a partial manifest and preserves the previous ready checksum', async () => {
    const current = document('replacement', {
      searchIndexState: 'ready',
      searchIndexChecksum: 'c'.repeat(64),
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      searchIndexedAt: '2026-07-18T10:00:00.000Z',
    });
    const pages = new Map([
      [current.id, [extractedPage(1, 'First passage'), extractedPage(2, 'Second passage')]],
    ]);
    const { indexer, storage } = createHarness({ documents: [current], pagesByDocument: pages });
    storage.partialBatchWrites = 1;

    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();

    expect(storage.documentUpdates.at(-1)).toMatchObject({
      searchIndexState: 'failed',
      searchIndexChecksum: 'c'.repeat(64),
      searchIndexError: 'storage-unavailable',
    });
    expect(storage.chunkDeletes).not.toContainEqual(
      expect.objectContaining({ checksum: 'c'.repeat(64) }),
    );
  });

  it('writes passage records in batches of no more than 100', async () => {
    const current = document('largedocument', { pageCount: 101 });
    const pages = new Map([
      [
        current.id,
        Array.from({ length: 101 }, (_, index) => extractedPage(index + 1, `Page ${index + 1}`)),
      ],
    ]);
    const { indexer, storage } = createHarness({ documents: [current], pagesByDocument: pages });

    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();

    expect(storage.batchSizes).toEqual([100, 1]);
    expect(storage.documents.get(current.id)).toMatchObject({ searchIndexState: 'ready' });
  });

  it('removes earlier new-checksum batches before failing a later batch', async () => {
    const oldChecksum = 'e'.repeat(64);
    const current = document('batchfailure', {
      pageCount: 101,
      searchIndexState: 'ready',
      searchIndexChecksum: oldChecksum,
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      searchIndexedAt: '2026-07-18T10:00:00.000Z',
    });
    const pages = new Map([
      [
        current.id,
        Array.from({ length: 101 }, (_, index) => extractedPage(index + 1, `Page ${index + 1}`)),
      ],
    ]);
    const { indexer, storage } = createHarness({ documents: [current], pagesByDocument: pages });
    storage.failBatchNumber = 2;
    storage.chunks.set('old-chunk', {
      id: 'old-chunk',
      documentId: current.id,
      checksum: oldChecksum,
      pageNumber: 1,
      passageNumber: 1,
      headingId: null,
      heading: null,
      text: 'Old ready content',
      normalizedText: 'old ready content',
      normalizedStart: 0,
      normalizedEnd: 17,
      indexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      indexedAt: '2026-07-18T10:00:00.000Z',
      created: '2026-07-18T10:00:00.000Z',
      updated: '2026-07-18T10:00:00.000Z',
    });

    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();

    expect(storage.batchSizes).toEqual([100, 1]);
    expect(
      [...storage.chunks.values()].filter((chunk) => chunk.checksum === current.checksum),
    ).toEqual([]);
    expect(storage.chunks.get('old-chunk')).toMatchObject({ checksum: oldChecksum });
    expect(storage.documentUpdates.at(-1)).toMatchObject({
      searchIndexState: 'failed',
      searchIndexChecksum: oldChecksum,
      searchIndexError: 'storage-unavailable',
    });
  });

  it('deletes old chunks only after activation and contains cleanup failures', async () => {
    const current = document('replacement', {
      searchIndexState: 'ready',
      searchIndexChecksum: 'd'.repeat(64),
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      searchIndexedAt: '2026-07-18T10:00:00.000Z',
    });
    const { indexer, storage } = createHarness({ documents: [current] });
    storage.chunks.set('old-chunk', {
      id: 'old-chunk',
      documentId: current.id,
      checksum: 'd'.repeat(64),
      pageNumber: 1,
      passageNumber: 1,
      headingId: null,
      heading: null,
      text: 'Old content',
      normalizedText: 'old content',
      normalizedStart: 0,
      normalizedEnd: 11,
      indexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      indexedAt: '2026-07-18T10:00:00.000Z',
      created: '2026-07-18T10:00:00.000Z',
      updated: '2026-07-18T10:00:00.000Z',
    });

    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();
    await settleHousekeeping();

    expect(
      storage.documentUpdates.findIndex((patch) => patch.searchIndexState === 'ready'),
    ).toBeGreaterThan(-1);
    expect(storage.chunkDeletes).toContainEqual(expect.objectContaining({ id: 'old-chunk' }));

    storage.deleteError = new Error('cleanup-offline');
    await expect(indexer.remove(current.id)).resolves.toBeUndefined();
  });

  it('preserves a newly activated manifest when best-effort old cleanup fails', async () => {
    const oldChecksum = 'f'.repeat(64);
    const current = document('cleanupfailure', {
      searchIndexState: 'ready',
      searchIndexChecksum: oldChecksum,
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      searchIndexedAt: '2026-07-18T10:00:00.000Z',
    });
    const { indexer, storage } = createHarness({ documents: [current] });
    storage.chunks.set('old-chunk', {
      id: 'old-chunk',
      documentId: current.id,
      checksum: oldChecksum,
      pageNumber: 1,
      passageNumber: 1,
      headingId: null,
      heading: null,
      text: 'Old ready content',
      normalizedText: 'old ready content',
      normalizedStart: 0,
      normalizedEnd: 17,
      indexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      indexedAt: '2026-07-18T10:00:00.000Z',
      created: '2026-07-18T10:00:00.000Z',
      updated: '2026-07-18T10:00:00.000Z',
    });
    storage.deleteError = new Error('cleanup-offline');

    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();

    const activatedManifest = [...storage.chunks.values()].filter(
      (chunk) =>
        chunk.documentId === current.id &&
        chunk.checksum === current.checksum &&
        chunk.indexVersion === KNOWLEDGE_SEARCH_INDEX_VERSION,
    );
    expect(storage.documents.get(current.id)).toMatchObject({
      searchIndexState: 'ready',
      searchIndexChecksum: current.checksum,
      searchIndexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      searchIndexError: null,
    });
    expect(activatedManifest).toHaveLength(1);
    expect(storage.chunks.get('old-chunk')).toMatchObject({ checksum: oldChecksum });
    expect(storage.documentUpdates.at(-1)).not.toMatchObject({ searchIndexState: 'failed' });
  });

  it('contains permanent removal failures and rejects invalid identifiers', async () => {
    const current = document();
    const { indexer, storage, extractor } = createHarness({ documents: [current] });
    storage.deleteError = new Error('storage-offline');

    expect(() => indexer.enqueue('../escape')).not.toThrow();
    expect(() => indexer.retry('')).not.toThrow();
    await expect(indexer.remove(current.id)).resolves.toBeUndefined();
    await indexer.whenIdleForTest();

    expect(extractor.extractSearchPages).not.toHaveBeenCalled();
  });

  it('permanently suppresses enqueue, retry, and backfill after removal starts', async () => {
    const current = document('tombstoned');
    const { indexer, extractor, storage } = createHarness({ documents: [current] });

    await indexer.remove(current.id);
    indexer.enqueue(current.id);
    indexer.retry(current.id);
    await indexer.start();
    await indexer.whenIdleForTest();

    expect(extractor.extractSearchPages).not.toHaveBeenCalled();
    expect(storage.chunkCreates).toEqual([]);
  });

  it('does not resolve removal while an active batch can still create chunks', async () => {
    const current = document('removecreate');
    const { indexer, storage } = createHarness({ documents: [current] });
    const batchSend = controlledGate();
    storage.batchSendGate = { batch: 1, ...batchSend.hook };

    indexer.enqueue(current.id);
    await batchSend.entered;
    let removalResolved = false;
    const removal = indexer.remove(current.id).then(() => {
      removalResolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const resolvedBeforeCreateFinished = removalResolved;
    batchSend.release();
    await removal;
    await indexer.whenIdleForTest();
    const mutationsAtResolution =
      storage.chunkCreates.length + storage.chunkDeletes.length + storage.documentUpdates.length;
    await settleHousekeeping();

    expect(resolvedBeforeCreateFinished).toBe(false);
    expect([...storage.chunks.values()].filter((chunk) => chunk.documentId === current.id)).toEqual(
      [],
    );
    expect(
      storage.chunkCreates.length + storage.chunkDeletes.length + storage.documentUpdates.length,
    ).toBe(mutationsAtResolution);
  });

  it('does not recreate derived chunks when permanent removal races active extraction', async () => {
    let releaseExtraction!: () => void;
    const extractionGate = new Promise<void>((resolve) => {
      releaseExtraction = resolve;
    });
    const current = document('removeddocument');
    const { indexer, extractor, storage } = createHarness({
      documents: [current],
      extractionGate,
    });

    indexer.enqueue(current.id);
    await vi.waitFor(() => expect(extractor.extractSearchPages).toHaveBeenCalledTimes(1));
    storage.documents.delete(current.id);
    const removal = indexer.remove(current.id);
    releaseExtraction();
    await removal;
    await indexer.whenIdleForTest();

    expect(storage.chunkCreates).toEqual([]);
    expect(storage.documentUpdates).not.toContainEqual(
      expect.objectContaining({ searchIndexState: 'ready' }),
    );
  });

  it('clears queued work and prevents an active extraction from publishing after dispose', async () => {
    let releaseExtraction!: () => void;
    const extractionGate = new Promise<void>((resolve) => {
      releaseExtraction = resolve;
    });
    const active = document('activedocument');
    const queued = document('queueddocument');
    const { indexer, extractor, storage, processedDocumentIds } = createHarness({
      documents: [active, queued],
      extractionGate,
    });

    indexer.enqueue(active.id);
    indexer.enqueue(queued.id);
    await vi.waitFor(() => expect(extractor.extractSearchPages).toHaveBeenCalledTimes(1));
    const dispose = indexer.dispose();
    releaseExtraction();
    await expect(dispose).resolves.toBeUndefined();
    await indexer.whenIdleForTest();

    expect(processedDocumentIds).toEqual([active.id]);
    expect(extractor.stop).toHaveBeenCalledTimes(1);
    expect(storage.documentUpdates).not.toContainEqual(
      expect.objectContaining({ searchIndexState: 'ready' }),
    );
    expect(() => indexer.enqueue(active.id)).not.toThrow();
  });

  it('does not resolve disposal while cancelled create cleanup can still delete chunks', async () => {
    const current = document('disposecreate');
    const { indexer, storage } = createHarness({ documents: [current] });
    const batchSend = controlledGate();
    const chunkDelete = controlledGate();
    storage.batchSendGate = { batch: 1, ...batchSend.hook };
    storage.chunkDeleteGate = chunkDelete.hook;

    indexer.enqueue(current.id);
    await batchSend.entered;
    let disposalResolved = false;
    const disposal = indexer.dispose().then(() => {
      disposalResolved = true;
    });
    batchSend.release();
    await chunkDelete.entered;
    await Promise.resolve();
    const resolvedBeforeCleanupFinished = disposalResolved;
    chunkDelete.release();
    await disposal;
    const mutationsAtResolution =
      storage.chunkCreates.length + storage.chunkDeletes.length + storage.documentUpdates.length;
    await settleHousekeeping();

    expect(resolvedBeforeCleanupFinished).toBe(false);
    expect(storage.chunks.size).toBe(0);
    expect(
      storage.chunkCreates.length + storage.chunkDeletes.length + storage.documentUpdates.length,
    ).toBe(mutationsAtResolution);
  });

  it('waits for an in-flight removal delete before disposal resolves', async () => {
    const current = document('disposeduringremove');
    const { indexer, storage } = createHarness({ documents: [current] });
    storage.chunks.set('existing-chunk', {
      id: 'existing-chunk',
      documentId: current.id,
      checksum: current.checksum,
      pageNumber: 1,
      passageNumber: 1,
      headingId: null,
      heading: null,
      text: 'Existing content',
      normalizedText: 'existing content',
      normalizedStart: 0,
      normalizedEnd: 16,
      indexVersion: KNOWLEDGE_SEARCH_INDEX_VERSION,
      indexedAt: '2026-07-18T10:00:00.000Z',
      created: '2026-07-18T10:00:00.000Z',
      updated: '2026-07-18T10:00:00.000Z',
    });
    const chunkDelete = controlledGate();
    storage.chunkDeleteGate = chunkDelete.hook;

    const removal = indexer.remove(current.id);
    await chunkDelete.entered;
    let disposalResolved = false;
    const disposal = indexer.dispose().then(() => {
      disposalResolved = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const resolvedBeforeRemovalFinished = disposalResolved;
    chunkDelete.release();
    await Promise.all([removal, disposal]);
    const deletesAtResolution = storage.chunkDeletes.length;
    await settleHousekeeping();

    expect(resolvedBeforeRemovalFinished).toBe(false);
    expect(storage.chunkDeletes).toHaveLength(1);
    expect(storage.chunkDeletes).toHaveLength(deletesAtResolution);
  });

  it('refuses to write more chunks than the search service will read back', async () => {
    const current = document('chunkcap', { pageCount: 1 });
    const pages = new Map([
      [
        current.id,
        Array.from({ length: KNOWLEDGE_SEARCH_MAX_CHUNKS_PER_DOCUMENT + 1 }, (_, index) =>
          extractedPage(index + 1, `Page ${index + 1}`),
        ),
      ],
    ]);
    const { indexer, storage } = createHarness({ documents: [current], pagesByDocument: pages });

    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();

    expect(storage.chunkCreates).toEqual([]);
    expect(storage.documents.get(current.id)).toMatchObject({
      searchIndexState: 'failed',
      searchIndexError: 'extraction-failed',
    });
  });

  it('retries a failed chunk removal instead of orphaning the chunks', async () => {
    const current = document('retryremoval');
    const { indexer, storage } = createHarness({ documents: [current] });

    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();
    expect(storage.chunks.size).toBe(1);

    vi.useFakeTimers();
    try {
      storage.deleteError = new Error('storage-offline');
      await indexer.remove(current.id);
      expect(storage.chunks.size).toBe(1);

      storage.deleteError = null;
      await vi.advanceTimersByTimeAsync(30_000);
      await indexer.whenIdleForTest();

      expect(storage.chunks.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sweeps chunks whose document no longer exists at startup', async () => {
    const current = document('orphansweep');
    const { indexer, storage, extractor, readPdf } = createHarness({ documents: [current] });

    indexer.enqueue(current.id);
    await indexer.whenIdleForTest();
    expect(storage.chunks.size).toBe(1);
    // The document row is gone while its chunks survived an earlier removal failure.
    storage.documents.delete(current.id);

    const restarted = new KnowledgeSearchIndexer({
      pb: storage,
      extractor,
      readPdf,
      now: () => NOW,
    });
    await restarted.start();
    await restarted.whenIdleForTest();

    expect(storage.chunks.size).toBe(0);
  });
});
