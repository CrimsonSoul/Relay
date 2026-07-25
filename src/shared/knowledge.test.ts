import { describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_CATEGORIES_COLLECTION,
  KNOWLEDGE_CATEGORY_MIGRATION_VERSION,
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_MAX_COVER_BYTES,
  KNOWLEDGE_UNCATEGORIZED_SYSTEM_KEY,
  KNOWLEDGE_UPLOAD_BATCHES_COLLECTION,
  KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION,
  KNOWLEDGE_UPLOAD_CHUNK_BYTES,
  KNOWLEDGE_UPLOAD_CONCURRENCY,
  KNOWLEDGE_UPLOAD_MAX_FILES,
  KNOWLEDGE_UPLOAD_MAX_RETRIES,
  KNOWLEDGE_UPLOAD_RETENTION_MS,
  KNOWLEDGE_MAX_LINK_URL_LENGTH,
  KNOWLEDGE_MAX_OUTLINE_NODES,
  KNOWLEDGE_MAX_PAGES,
  KNOWLEDGE_MAX_PDF_BYTES,
  compareKnowledgeCategories,
  compareKnowledgeDocuments,
  normalizeKnowledgeUploadBatchView,
  normalizeKnowledgeUploadManifestView,
  normalizeKnowledgeUploadQueueView,
  normalizeKnowledgeDocumentRecord,
  normalizeKnowledgeCategoryRecord,
  normalizeKnowledgeAuditEventView,
  normalizeKnowledgeManagementSnapshot,
  normalizeKnowledgeManagementUploadView,
} from './knowledge';
import { normalizeKnowledgeSearchText } from './knowledgeSearch';
import { IPC_CHANNELS } from './ipc';

const validRecord = {
  id: 'record123',
  sourceKey: 'Monitoring & Triage/Runbook.pdf',
  category: 'Monitoring & Triage',
  title: 'Runbook',
  fileName: 'Runbook.pdf',
  pdf: 'runbook.pdf',
  checksum: 'a'.repeat(64),
  byteSize: 1_024,
  pageCount: 3,
  outline: [
    { id: 'intro', label: 'Introduction', level: 1, pageIndex: 0, top: 720 },
    { id: 'check', label: 'Check status', level: 2, pageIndex: 1, top: null },
  ],
  outlineSource: 'native',
  sourceModifiedAt: '2026-07-14T12:00:00.000Z',
  indexedAt: '2026-07-14T12:01:00.000Z',
  created: '2026-07-14T12:01:00.000Z',
  updated: '2026-07-14T12:01:00.000Z',
};

const blankPocketBaseSearchIndexMetadata = {
  searchIndexState: '',
  searchIndexChecksum: '',
  searchIndexVersion: 0,
  searchIndexedAt: '',
  searchIndexError: '',
};

function category(name: string, sortOrder: number) {
  return {
    id: `category-${name.toLocaleLowerCase('en')}`,
    name,
    normalizedName: name.toLocaleLowerCase('en'),
    sortOrder,
    systemKey: '' as const,
    revision: 1,
    created: '2026-07-18T12:00:00.000Z',
    updated: '2026-07-18T12:00:00.000Z',
  };
}

describe('knowledge contracts', () => {
  it('publishes the approved collection and safety limits', () => {
    expect(KNOWLEDGE_CATEGORIES_COLLECTION).toBe('knowledge_categories');
    expect(KNOWLEDGE_CATEGORY_MIGRATION_VERSION).toBe(1);
    expect(KNOWLEDGE_DOCUMENTS_COLLECTION).toBe('knowledge_documents');
    expect(KNOWLEDGE_MAX_COVER_BYTES).toBe(2 * 1024 * 1024);
    expect(KNOWLEDGE_UNCATEGORIZED_SYSTEM_KEY).toBe('uncategorized');
    expect(KNOWLEDGE_UPLOAD_BATCHES_COLLECTION).toBe('knowledge_upload_batches');
    expect(KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION).toBe('knowledge_upload_chunks');
    expect(KNOWLEDGE_UPLOAD_CHUNK_BYTES).toBe(4 * 1024 * 1024);
    expect(KNOWLEDGE_UPLOAD_MAX_FILES).toBe(100);
    expect(KNOWLEDGE_UPLOAD_RETENTION_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(KNOWLEDGE_UPLOAD_MAX_RETRIES).toBe(8);
    expect(KNOWLEDGE_UPLOAD_CONCURRENCY).toBe(2);
    expect(KNOWLEDGE_MAX_PDF_BYTES).toBe(50 * 1024 * 1024);
    expect(KNOWLEDGE_MAX_PAGES).toBe(1_000);
    expect(KNOWLEDGE_MAX_OUTLINE_NODES).toBe(500);
    expect(KNOWLEDGE_MAX_LINK_URL_LENGTH).toBe(4_096);
    expect(IPC_CHANNELS.KNOWLEDGE_INDEX_STATUS_CHANGED).toBe('knowledge:indexStatusChanged');
  });

  it('normalizes bounded resumable batch and manifest views', () => {
    const batch = normalizeKnowledgeUploadBatchView({
      id: 'batch-1',
      requestId: 'request-1',
      fileCount: 2,
      totalBytes: 8_000,
      state: 'active',
      createdAt: '2026-07-15T20:00:00.000Z',
      lastActivityAt: '2026-07-15T20:01:00.000Z',
      expiresAt: '2026-07-22T20:00:00.000Z',
      revision: 1,
      accountId: 'must-not-cross-ipc',
    });
    expect(batch).toEqual({
      id: 'batch-1',
      requestId: 'request-1',
      fileCount: 2,
      totalBytes: 8_000,
      state: 'active',
      createdAt: '2026-07-15T20:00:00.000Z',
      lastActivityAt: '2026-07-15T20:01:00.000Z',
      expiresAt: '2026-07-22T20:00:00.000Z',
      revision: 1,
    });

    const manifest = normalizeKnowledgeUploadManifestView({
      id: 'upload-1',
      batchId: 'batch-1',
      fileName: 'Checkout Runbook.pdf',
      byteSize: 8_000,
      checksum: 'b'.repeat(64),
      chunkSize: KNOWLEDGE_UPLOAD_CHUNK_BYTES,
      chunkCount: 1,
      missingChunkIndexes: [0],
      state: 'uploading',
      proposedTitle: '',
      proposedCategory: '',
      pageCount: null,
      outline: [],
      outlineSource: null,
      duplicateDocumentId: null,
      safeError: null,
      lastActivityAt: '2026-07-15T20:01:00.000Z',
      readyAt: null,
      expiresAt: '2026-07-22T20:00:00.000Z',
      revision: 2,
      pdf: 'protected.pdf',
      localSourcePath: '/Users/publisher/Documents/Checkout Runbook.pdf',
    });
    expect(manifest).not.toHaveProperty('pdf');
    expect(manifest).not.toHaveProperty('localSourcePath');
    expect(manifest).toMatchObject({
      id: 'upload-1',
      batchId: 'batch-1',
      state: 'uploading',
      missingChunkIndexes: [0],
    });
  });

  it('normalizes queue state without exposing encrypted paths or private account metadata', () => {
    const queue = normalizeKnowledgeUploadQueueView({
      restartRecovery: true,
      activeBatchId: 'batch-1',
      totalBytes: 8_000,
      acknowledgedBytes: 4_000,
      items: [
        {
          id: 'local-1',
          uploadId: 'upload-1',
          batchId: 'batch-1',
          fileName: 'Runbook.pdf',
          byteSize: 8_000,
          acknowledgedBytes: 4_000,
          chunkCount: 2,
          acknowledgedChunkCount: 1,
          state: 'paused-network',
          safeError: 'offline',
          retryCount: 8,
          restartRecovery: true,
          encryptedSourcePath: 'ciphertext',
          accountId: 'account-1',
          deviceId: 'device-1',
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
      encryptedSourcePath: 'ciphertext',
    });

    expect(queue).toMatchObject({
      restartRecovery: true,
      activeBatchId: 'batch-1',
      acknowledgedBytes: 4_000,
      items: [expect.objectContaining({ fileName: 'Runbook.pdf', state: 'paused-network' })],
    });
    expect(queue).not.toHaveProperty('encryptedSourcePath');
    expect(queue?.items[0]).not.toHaveProperty('encryptedSourcePath');
    expect(queue?.items[0]).not.toHaveProperty('accountId');
    expect(queue?.items[0]).not.toHaveProperty('deviceId');
    expect(queue?.items[0]).not.toHaveProperty('bytes');
  });

  it('normalizes a valid PocketBase record and discards unknown data', () => {
    expect(normalizeKnowledgeDocumentRecord({ ...validRecord, ignored: 'value' })).toEqual({
      ...validRecord,
      categoryId: null,
      documentType: 'sop',
      cover: null,
      lifecycleState: 'active',
      displayTitle: 'Runbook',
      revision: 1,
      publishedByAccountId: '',
      publishedByName: '',
      publishedAt: '2026-07-14T12:01:00.000Z',
      trashedByAccountId: null,
      trashedByName: null,
      trashedAt: null,
      searchIndexState: 'pending',
      searchIndexChecksum: null,
      searchIndexVersion: 0,
      searchIndexedAt: null,
      searchIndexError: null,
    });
  });

  it('keeps legacy documents valid with pending search-index defaults', () => {
    const legacy = normalizeKnowledgeDocumentRecord(validRecord);

    expect(legacy).toMatchObject({
      searchIndexState: 'pending',
      searchIndexChecksum: null,
      searchIndexVersion: 0,
      searchIndexedAt: null,
      searchIndexError: null,
    });
  });

  it('normalizes PocketBase blank search-index fields on legacy documents', () => {
    expect(
      normalizeKnowledgeDocumentRecord({
        ...validRecord,
        ...blankPocketBaseSearchIndexMetadata,
      }),
    ).toMatchObject({
      searchIndexState: 'pending',
      searchIndexChecksum: null,
      searchIndexVersion: 0,
      searchIndexedAt: null,
      searchIndexError: null,
    });
  });

  it('continues rejecting invalid nonblank search-index metadata', () => {
    expect(
      normalizeKnowledgeDocumentRecord({
        ...validRecord,
        ...blankPocketBaseSearchIndexMetadata,
        searchIndexState: 'indexing',
      }),
    ).toBeNull();
  });

  it('canonicalizes PocketBase timestamps for ready search-index metadata', () => {
    const ready = {
      ...validRecord,
      searchIndexState: 'ready',
      searchIndexChecksum: 'a'.repeat(64),
      searchIndexVersion: 1,
      searchIndexedAt: '2026-07-19T18:00:00.000Z',
      searchIndexError: null,
    };

    expect(normalizeKnowledgeDocumentRecord(ready)).not.toBeNull();
    expect(
      normalizeKnowledgeDocumentRecord({
        ...ready,
        searchIndexedAt: '2026-07-19 18:00:00.000Z',
      }),
    ).toMatchObject({ searchIndexedAt: '2026-07-19T18:00:00.000Z' });
    expect(
      normalizeKnowledgeDocumentRecord({
        ...ready,
        searchIndexedAt: '2026-02-30T18:00:00.000Z',
      }),
    ).toBeNull();
  });

  it('normalizes stable categories and document presentation metadata', () => {
    expect(
      normalizeKnowledgeCategoryRecord({
        id: 'cat_operations',
        name: 'Operations',
        normalizedName: 'operations',
        sortOrder: 200,
        systemKey: '',
        revision: 3,
        created: '2026-07-18T12:00:00.000Z',
        updated: '2026-07-18T12:00:00.000Z',
      }),
    ).toMatchObject({ id: 'cat_operations', name: 'Operations', sortOrder: 200 });

    expect(
      normalizeKnowledgeDocumentRecord({
        ...validRecord,
        categoryId: 'cat_operations',
        documentType: 'cheatsheet',
        cover: 'oracle-cover.png',
      }),
    ).toMatchObject({
      categoryId: 'cat_operations',
      documentType: 'cheatsheet',
      cover: 'oracle-cover.png',
    });
  });

  it('rejects malformed category and document presentation metadata', () => {
    expect(
      normalizeKnowledgeCategoryRecord({ ...category('Operations', 100), name: '' }),
    ).toBeNull();
    expect(
      normalizeKnowledgeCategoryRecord({
        ...category('Operations', 100),
        systemKey: 'other-system-key',
      }),
    ).toBeNull();
    expect(
      normalizeKnowledgeDocumentRecord({ ...validRecord, documentType: 'reference' }),
    ).toBeNull();
    expect(
      normalizeKnowledgeDocumentRecord({ ...validRecord, categoryId: '../category' }),
    ).toBeNull();
  });

  it('normalizes managed active and trashed records while preserving the authored filename', () => {
    const managed = {
      ...validRecord,
      lifecycleState: 'trashed',
      displayTitle: 'Checkout recovery',
      revision: 7,
      publishedByOperatorId: 'operator-1',
      publishedByName: 'Ryan Bledsoe',
      publishedAt: '2026-07-15T12:00:00.000Z',
      trashedByOperatorId: 'operator-2',
      trashedByName: 'Ryan Bell',
      trashedAt: '2026-07-15T13:00:00.000Z',
    };

    expect(normalizeKnowledgeDocumentRecord(managed)).toMatchObject({
      lifecycleState: 'trashed',
      displayTitle: 'Checkout recovery',
      fileName: 'Runbook.pdf',
      revision: 7,
      trashedByName: 'Ryan Bell',
    });
    expect(normalizeKnowledgeDocumentRecord({ ...managed, lifecycleState: 'deleted' })).toBeNull();
    expect(normalizeKnowledgeDocumentRecord({ ...managed, revision: -1 })).toBeNull();
    expect(normalizeKnowledgeDocumentRecord({ ...managed, displayTitle: '' })).toBeNull();
  });

  it('normalizes account attribution first while preserving legacy document rows', () => {
    const legacy = normalizeKnowledgeDocumentRecord({
      ...validRecord,
      publishedByOperatorId: 'legacy-publisher',
      publishedByName: 'Legacy Publisher',
    });
    expect(legacy).toMatchObject({
      publishedByAccountId: 'legacy-publisher',
      publishedByName: 'Legacy Publisher',
    });
    expect(legacy).not.toHaveProperty('publishedByOperatorId');

    const current = normalizeKnowledgeDocumentRecord({
      ...validRecord,
      publishedByAccountId: 'account-publisher',
      publishedByOperatorId: 'legacy-should-not-win',
      publishedByName: 'Current Publisher',
    });
    expect(current).toMatchObject({ publishedByAccountId: 'account-publisher' });
  });

  it('normalizes current and historical audit attribution to account vocabulary', () => {
    const base = {
      id: 'audit-1',
      requestId: 'request-1',
      action: 'published',
      targetId: 'document-1',
      fileName: 'Runbook.pdf',
      title: 'Runbook',
      category: 'Operations',
      occurredAt: '2026-07-15T12:00:00.000Z',
    };
    expect(
      normalizeKnowledgeAuditEventView({
        ...base,
        accountId: 'account-current',
        actorDisplayName: 'Current Publisher',
        operatorId: 'legacy-should-not-win',
        operatorName: 'Legacy Should Not Win',
      }),
    ).toMatchObject({ accountId: 'account-current', actorDisplayName: 'Current Publisher' });
    expect(
      normalizeKnowledgeAuditEventView({
        ...base,
        operatorId: 'legacy-publisher',
        operatorName: 'Legacy Publisher',
      }),
    ).toMatchObject({ accountId: 'legacy-publisher', actorDisplayName: 'Legacy Publisher' });
  });

  it('drops malformed outline nodes without rejecting a readable document', () => {
    const result = normalizeKnowledgeDocumentRecord({
      ...validRecord,
      outline: [
        validRecord.outline[0],
        { id: 'bad-level', label: 'Bad', level: 3, pageIndex: 0, top: 12 },
        { id: 'bad-page', label: 'Bad', level: 1, pageIndex: -1, top: null },
      ],
    });

    expect(result?.outline).toEqual([validRecord.outline[0]]);
  });

  it('rejects a malformed document record', () => {
    expect(normalizeKnowledgeDocumentRecord({ ...validRecord, checksum: 'short' })).toBeNull();
    expect(normalizeKnowledgeDocumentRecord({ ...validRecord, pageCount: 0 })).toBeNull();
    expect(
      normalizeKnowledgeDocumentRecord({ ...validRecord, outlineSource: 'guessed' }),
    ).toBeNull();
  });

  it('normalizes search text case while preserving diacritics', () => {
    expect(normalizeKnowledgeSearchText('  Résolution ÉTAPES  ')).toBe('résolution étapes');
  });

  it('normalizes metadata-only management snapshots without exposing PDF fields', () => {
    const document = normalizeKnowledgeDocumentRecord(validRecord)!;
    const safeDocument: typeof document & { pdf?: string; outline?: unknown[] } = { ...document };
    delete safeDocument.pdf;
    delete safeDocument.outline;
    const snapshot = normalizeKnowledgeManagementSnapshot({
      mode: 'managed',
      categories: [category('Operations', 100)],
      documents: { items: [safeDocument], nextCursor: null },
      trash: { items: [], nextCursor: null },
      uploads: { items: [], nextCursor: null },
    });

    expect(snapshot?.documents.items[0]).toMatchObject({
      id: document.id,
      checksum: document.checksum,
      displayTitle: document.title,
      searchIndexState: 'pending',
    });
    expect(snapshot?.documents.items[0]).not.toHaveProperty('pdf');
    expect(snapshot?.documents.items[0]).not.toHaveProperty('outline');
    expect(snapshot?.categories).toEqual([category('Operations', 100)]);
  });

  it('validates optional replacement summaries while accepting older upload views', () => {
    const replacementDocument = {
      id: 'document-1',
      checksum: 'b'.repeat(64),
      category: 'Operations',
      categoryId: 'category-operations',
      documentType: 'sop',
      displayTitle: 'Existing runbook',
      fileName: 'Existing.pdf',
      byteSize: 1_024,
      pageCount: 4,
      lifecycleState: 'active',
      revision: 3,
      publishedByName: 'Publisher',
      publishedAt: '2026-07-16T01:00:00.000Z',
      trashedByName: null,
      trashedAt: null,
      searchIndexState: 'ready',
      searchIndexChecksum: 'b'.repeat(64),
      searchIndexVersion: 1,
      searchIndexedAt: '2026-07-16T01:00:00.000Z',
      searchIndexError: null,
      updated: '2026-07-16T01:00:00.000Z',
    };
    const upload = {
      id: 'upload-1',
      requestId: 'request-1',
      fileName: 'Replacement.pdf',
      byteSize: 2_048,
      checksum: 'c'.repeat(64),
      state: 'ready',
      progress: 100,
      proposedTitle: 'Replacement',
      proposedCategory: 'Operations',
      proposedCategoryId: 'category-operations',
      proposedDocumentType: 'sop',
      pageCount: 5,
      outlineSource: 'native',
      duplicateDocumentId: replacementDocument.id,
      safeError: null,
      expiresAt: '2026-07-23T01:00:00.000Z',
      revision: 2,
      outlineCount: 3,
    };

    expect(
      normalizeKnowledgeManagementUploadView({ ...upload, replacementDocument }),
    ).toMatchObject({
      duplicateDocumentId: replacementDocument.id,
      replacementDocument: {
        id: replacementDocument.id,
        revision: replacementDocument.revision,
      },
    });
    expect(normalizeKnowledgeManagementUploadView(upload)).not.toHaveProperty(
      'replacementDocument',
    );
    expect(
      normalizeKnowledgeManagementUploadView({
        ...upload,
        replacementDocument: { ...replacementDocument, revision: 0 },
      }),
    ).toBeNull();
  });

  it('keeps legacy PocketBase documents visible in management snapshots', () => {
    const snapshot = normalizeKnowledgeManagementSnapshot({
      mode: 'managed',
      categories: [category('Operations', 100)],
      documents: {
        items: [
          {
            ...validRecord,
            ...blankPocketBaseSearchIndexMetadata,
            categoryId: null,
            documentType: 'sop',
            displayTitle: validRecord.title,
            lifecycleState: 'active',
            revision: 1,
            publishedByName: '',
            publishedAt: validRecord.indexedAt,
            trashedByName: null,
            trashedAt: null,
          },
        ],
        nextCursor: null,
      },
      trash: { items: [], nextCursor: null },
      uploads: { items: [], nextCursor: null },
    });

    expect(snapshot?.documents.items[0]).toMatchObject({
      id: validRecord.id,
      searchIndexState: 'pending',
      searchIndexChecksum: null,
      searchIndexVersion: 0,
      searchIndexedAt: null,
      searchIndexError: null,
    });
  });

  it('sorts General before alphabetical categories', () => {
    expect(['Zoo', 'access', 'General', 'Monitoring'].sort(compareKnowledgeCategories)).toEqual([
      'General',
      'access',
      'Monitoring',
      'Zoo',
    ]);
  });

  it('orders stable category records by sort order and then name', () => {
    expect(
      [category('Network', 200), category('Zulu', 100), category('Access', 100)].toSorted(
        compareKnowledgeCategories,
      ),
    ).toEqual([category('Access', 100), category('Zulu', 100), category('Network', 200)]);
  });

  it('sorts documents case-insensitively by title then filename', () => {
    const records = [
      { ...validRecord, id: '3', title: 'Zulu', fileName: 'z.pdf' },
      { ...validRecord, id: '2', title: 'alpha', fileName: 'b.pdf' },
      { ...validRecord, id: '1', title: 'Alpha', fileName: 'a.pdf' },
    ];

    expect(records.toSorted(compareKnowledgeDocuments).map((record) => record.id)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('prefers the managed display title when sorting', () => {
    const records = [
      { ...validRecord, id: 'legacy-first', displayTitle: 'Zulu' },
      { ...validRecord, id: 'managed-first', displayTitle: 'Alpha' },
    ];
    expect(records.toSorted(compareKnowledgeDocuments).map(({ id }) => id)).toEqual([
      'managed-first',
      'legacy-first',
    ]);
  });
});
