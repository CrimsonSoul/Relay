import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_AUDIT_EVENTS_COLLECTION,
  KNOWLEDGE_CATEGORIES_COLLECTION,
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_LIBRARY_STATE_COLLECTION,
  KNOWLEDGE_UPLOADS_COLLECTION,
  normalizeKnowledgeManagementSnapshot,
} from '@shared/knowledge';
import { ManagedKnowledgeConflictError, ManagedKnowledgeService } from '../ManagedKnowledgeService';

const NOW = '2026-07-16T01:00:00.000Z';
const PDF = Buffer.from('%PDF-test');
const CHECKSUM = createHash('sha256').update(PDF).digest('hex');
const ACTOR = {
  accountId: 'account-admin',
  displayName: 'Ryan Bledsoe',
};

function document(overrides: Record<string, unknown> = {}) {
  return {
    id: 'document-1',
    sourceKey: 'Operations/Runbook.pdf',
    category: 'Operations',
    categoryId: 'category-operations',
    documentType: 'sop',
    title: 'Runbook',
    displayTitle: 'Runbook',
    fileName: 'Runbook.pdf',
    pdf: 'stored.pdf',
    cover: 'stored.png',
    checksum: CHECKSUM,
    byteSize: PDF.byteLength,
    pageCount: 2,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: NOW,
    indexedAt: NOW,
    lifecycleState: 'active',
    revision: 3,
    publishedByAccountId: ACTOR.accountId,
    publishedByName: ACTOR.displayName,
    publishedAt: NOW,
    trashedByAccountId: '',
    trashedByName: '',
    trashedAt: '',
    created: NOW,
    updated: NOW,
    ...overrides,
  };
}

function upload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'upload-1',
    requestId: 'upload-request-1',
    accountId: ACTOR.accountId,
    deviceId: 'device-1',
    operatorId: 'historical-roster-id',
    operatorName: ACTOR.displayName,
    fileName: 'Replacement.pdf',
    pdf: 'upload.pdf',
    cover: 'upload.png',
    checksum: CHECKSUM,
    byteSize: PDF.byteLength,
    state: 'ready',
    progress: 100,
    proposedTitle: 'Replacement',
    proposedCategory: 'General',
    pageCount: 2,
    outline: [],
    outlineSource: 'none',
    replacementDocumentId: null,
    duplicateDocumentId: null,
    safeError: null,
    expiresAt: '2026-07-17T01:00:00.000Z',
    revision: 1,
    ...overrides,
  };
}

describe('ManagedKnowledgeService', () => {
  const categoryRecords = [
    {
      id: 'category-operations',
      name: 'Operations',
      normalizedName: 'operations',
      sortOrder: 100,
      systemKey: '',
      revision: 2,
      created: NOW,
      updated: NOW,
    },
    {
      id: 'category-uncategorized',
      name: 'Uncategorized',
      normalizedName: 'uncategorized',
      sortOrder: 200,
      systemKey: 'uncategorized',
      revision: 1,
      created: NOW,
      updated: NOW,
    },
  ];
  const categories = {
    getFullList: vi.fn(async () => categoryRecords),
    getOne: vi.fn(async (id: string) => categoryRecords.find((category) => category.id === id)),
    create: vi.fn(async (value: Record<string, unknown>) => ({
      id: 'category-new',
      created: NOW,
      updated: NOW,
      ...value,
    })),
    update: vi.fn(async (id: string, value: Record<string, unknown>) => ({
      ...(categoryRecords.find((category) => category.id === id) ?? categoryRecords[0]),
      ...value,
      id,
      updated: NOW,
    })),
    delete: vi.fn(async () => true),
  };
  const documents = {
    getFullList: vi.fn(async () => [] as Record<string, unknown>[]),
    getOne: vi.fn(async () => document()),
    create: vi.fn(async () => ({
      id: 'document-2',
      pdf: 'stored-new.pdf',
      created: NOW,
      updated: NOW,
    })),
    update: vi.fn(async (id: string, value: Record<string, unknown> | FormData) =>
      value instanceof FormData
        ? { id, pdf: 'stored-replacement.pdf', created: NOW, updated: NOW }
        : { ...document(), ...value, id, updated: NOW },
    ),
    delete: vi.fn(async () => true),
  };
  const uploads = {
    getFullList: vi.fn(async () => []),
    getOne: vi.fn(async () => upload()),
    update: vi.fn(async () => ({})),
  };
  const audits = {
    getFullList: vi.fn(async () => []),
    create: vi.fn(async (value) => ({ id: 'audit-1', ...value })),
  };
  const batchDocuments = { delete: vi.fn() };
  const batchAudits = { create: vi.fn() };
  const batch = {
    collection: vi.fn((name: string) => {
      if (name === KNOWLEDGE_DOCUMENTS_COLLECTION) return batchDocuments;
      if (name === KNOWLEDGE_AUDIT_EVENTS_COLLECTION) return batchAudits;
      throw new Error(`Unexpected batch collection ${name}`);
    }),
    send: vi.fn(async () => [{ status: 200 }, { status: 204 }]),
  };
  const libraryState = {
    getFirstListItem: vi.fn(async () => ({ mode: 'managed' })),
  };
  const pb = {
    createBatch: vi.fn(() => batch),
    collection: vi.fn((name: string) => {
      if (name === KNOWLEDGE_DOCUMENTS_COLLECTION) return documents;
      if (name === KNOWLEDGE_CATEGORIES_COLLECTION) return categories;
      if (name === KNOWLEDGE_UPLOADS_COLLECTION) return uploads;
      if (name === KNOWLEDGE_AUDIT_EVENTS_COLLECTION) return audits;
      if (name === KNOWLEDGE_LIBRARY_STATE_COLLECTION) return libraryState;
      throw new Error(`Unexpected collection ${name}`);
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    documents.getFullList.mockResolvedValue([]);
    documents.getOne.mockResolvedValue(document());
    categories.getFullList.mockResolvedValue(categoryRecords);
    categories.getOne.mockImplementation(async (id: string) =>
      categoryRecords.find((category) => category.id === id),
    );
    uploads.getOne.mockResolvedValue(upload());
    batch.send.mockResolvedValue([{ status: 200 }, { status: 204 }]);
  });

  function service() {
    return new ManagedKnowledgeService({
      pb: pb as never,
      now: () => Date.parse(NOW),
      readUploadPdf: vi.fn(async () => PDF),
      readUploadCover: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47])),
    });
  }

  it('normalizes PocketBase empty numeric upload metadata in management snapshots', async () => {
    uploads.getFullList.mockResolvedValueOnce([
      upload({ state: 'uploading', progress: 50, pageCount: 0, outlineSource: '' }),
    ]);

    const snapshot = await service().snapshot({
      accountId: ACTOR.accountId,
      query: '',
      cursor: null,
      pageSize: 25,
    });

    expect(snapshot.uploads.items[0]).toMatchObject({
      state: 'uploading',
      pageCount: null,
      outlineSource: null,
    });
    expect(snapshot.categories.map(({ id }) => id)).toEqual([
      'category-operations',
      'category-uncategorized',
    ]);
    expect(normalizeKnowledgeManagementSnapshot(snapshot)).not.toBeNull();
  });

  it('paginates actionable uploads before terminal history so the next replacement stays reviewable', async () => {
    documents.getFullList.mockResolvedValueOnce([document()]);
    uploads.getFullList.mockResolvedValueOnce([
      ...Array.from({ length: 25 }, (_, index) =>
        upload({
          id: `upload-terminal-${index}`,
          requestId: `request-terminal-${index}`,
          state: index % 2 === 0 ? 'published' : 'cancelled',
        }),
      ),
      upload({
        id: 'upload-next-replacement',
        requestId: 'request-next-replacement',
        fileName: 'Runbook.pdf',
        replacementDocumentId: 'document-1',
        duplicateDocumentId: 'document-1',
      }),
    ]);

    const snapshot = await service().snapshot({
      accountId: ACTOR.accountId,
      query: '',
      cursor: null,
      pageSize: 25,
    });

    expect(snapshot.uploads.items.map(({ id }) => id)).toEqual(['upload-next-replacement']);
    expect(snapshot.uploads.nextCursor).toBeNull();
    expect(normalizeKnowledgeManagementSnapshot(snapshot)).not.toBeNull();
  });

  it('resolves upload filename conflicts from the current active document set', async () => {
    documents.getFullList.mockResolvedValueOnce([
      document({
        id: 'document-current',
        fileName: 'Replacement.pdf',
        lifecycleState: 'active',
      }),
      document({
        id: 'document-trashed',
        fileName: 'Trashed.pdf',
        lifecycleState: 'trashed',
      }),
      document({
        id: 'document-target',
        fileName: 'Original Target.pdf',
        lifecycleState: 'active',
      }),
    ]);
    uploads.getFullList.mockResolvedValueOnce([
      upload({
        id: 'upload-current',
        fileName: 'Replacement.pdf',
        duplicateDocumentId: 'document-stale',
      }),
      upload({
        id: 'upload-deleted',
        fileName: 'Deleted.pdf',
        duplicateDocumentId: 'document-deleted',
      }),
      upload({
        id: 'upload-trashed',
        fileName: 'Trashed.pdf',
        duplicateDocumentId: 'document-trashed',
      }),
      upload({
        id: 'upload-targeted-replacement',
        fileName: 'Replacement.pdf',
        replacementDocumentId: 'document-target',
        duplicateDocumentId: 'document-target',
      }),
      upload({
        id: 'upload-unavailable-replacement',
        fileName: 'Replacement.pdf',
        replacementDocumentId: 'document-deleted',
        duplicateDocumentId: 'document-deleted',
      }),
    ]);

    const snapshot = await service().snapshot({
      accountId: ACTOR.accountId,
      query: '',
      cursor: null,
      pageSize: 25,
    });

    expect(
      snapshot.uploads.items.map(({ id, duplicateDocumentId }) => ({
        id,
        duplicateDocumentId,
      })),
    ).toEqual([
      { id: 'upload-current', duplicateDocumentId: 'document-current' },
      { id: 'upload-deleted', duplicateDocumentId: null },
      { id: 'upload-trashed', duplicateDocumentId: null },
      { id: 'upload-targeted-replacement', duplicateDocumentId: 'document-target' },
      { id: 'upload-unavailable-replacement', duplicateDocumentId: 'document-deleted' },
    ]);
    expect(
      snapshot.uploads.items.find(({ id }) => id === 'upload-targeted-replacement'),
    ).toMatchObject({
      replacementDocument: {
        id: 'document-target',
        displayTitle: 'Runbook',
        fileName: 'Original Target.pdf',
        revision: 3,
      },
    });
    expect(
      snapshot.uploads.items.find(({ id }) => id === 'upload-unavailable-replacement'),
    ).toMatchObject({
      duplicateDocumentId: 'document-deleted',
      replacementDocument: null,
    });
  });

  it('publishes a ready upload with attribution and an audit event', async () => {
    await expect(
      service().publish({
        actor: ACTOR,
        requestId: 'request-publish',
        uploadId: 'upload-1',
        title: 'Checkout Runbook',
        category: 'Operations',
      }),
    ).resolves.toMatchObject({
      id: 'document-2',
      checksum: upload().checksum,
      displayTitle: 'Checkout Runbook',
      fileName: 'Replacement.pdf',
      lifecycleState: 'active',
      revision: 1,
      publishedByName: 'Ryan Bledsoe',
      searchIndexState: 'pending',
      searchIndexChecksum: null,
      searchIndexVersion: 0,
      searchIndexedAt: null,
      searchIndexError: null,
    });
    expect(documents.create).toHaveBeenCalledWith(expect.any(FormData), { requestKey: null });
    const publishForm = documents.create.mock.calls[0]?.[0] as FormData;
    expect(publishForm.get('publishedByAccountId')).toBe(ACTOR.accountId);
    expect(publishForm.get('categoryId')).toBe('category-operations');
    expect(publishForm.get('category')).toBe('Operations');
    expect(publishForm.get('documentType')).toBe('sop');
    expect(publishForm.get('searchIndexState')).toBe('pending');
    expect(publishForm.get('searchIndexVersion')).toBe('0');
    expect(publishForm.get('cover')).toMatchObject({ type: 'image/png' });
    expect(publishForm.get('publishedByOperatorId')).toBe('');
    expect(publishForm.get('trashedByAccountId')).toBe('');
    expect(publishForm.get('trashedByOperatorId')).toBe('');
    expect(uploads.update).toHaveBeenCalledWith(
      'upload-1',
      { state: 'published', pdf: null, cover: null, revision: 2 },
      { requestKey: null },
    );
    expect(audits.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-publish',
        action: 'published',
        accountId: ACTOR.accountId,
        actorDisplayName: 'Ryan Bledsoe',
        operatorId: '',
        operatorName: '',
      }),
      { requestKey: null },
    );
  });

  it('rejects publishing an upload that was explicitly staged as a replacement', async () => {
    uploads.getOne.mockResolvedValueOnce(
      upload({
        fileName: 'Different Name.pdf',
        replacementDocumentId: 'document-target',
        duplicateDocumentId: 'document-target',
      }),
    );

    await expect(
      service().publish({
        actor: ACTOR,
        requestId: 'request-publish-replacement',
        uploadId: 'upload-1',
        title: 'Different Name',
        category: 'Operations',
      }),
    ).rejects.toThrow('Knowledge replacement cannot be published as a new document.');
    expect(documents.create).not.toHaveBeenCalled();
  });

  it('publishes directly into Quick Guides when requested', async () => {
    await service().publish({
      actor: ACTOR,
      requestId: 'request-publish-quick-guide',
      uploadId: 'upload-1',
      title: 'Checkout Quick Guide',
      category: 'Operations',
      documentType: 'cheatsheet',
    });

    const publishForm = documents.create.mock.calls[0]?.[0] as FormData;
    expect(publishForm.get('documentType')).toBe('cheatsheet');
  });

  it('reads current audit attribution first and falls back for historical events', async () => {
    audits.getFullList.mockResolvedValueOnce([
      {
        id: 'audit-current',
        requestId: 'request-current',
        action: 'published',
        targetId: 'document-1',
        fileName: 'Runbook.pdf',
        title: 'Runbook',
        category: 'Operations',
        accountId: ACTOR.accountId,
        actorDisplayName: ACTOR.displayName,
        operatorId: 'legacy-should-not-win',
        operatorName: 'Legacy Should Not Win',
        occurredAt: NOW,
      },
      {
        id: 'audit-legacy',
        requestId: 'request-legacy',
        action: 'trashed',
        targetId: 'document-1',
        fileName: 'Runbook.pdf',
        title: 'Runbook',
        category: 'Operations',
        operatorId: 'legacy-account',
        operatorName: 'Legacy Publisher',
        occurredAt: NOW,
      },
    ]);

    await expect(
      service().readAudit({ cursor: null, pageSize: 25, targetId: null }),
    ).resolves.toMatchObject({
      items: [
        { accountId: ACTOR.accountId, actorDisplayName: ACTOR.displayName },
        { accountId: 'legacy-account', actorDisplayName: 'Legacy Publisher' },
      ],
    });
  });

  it('replaces only file-derived content while preserving every existing document field', async () => {
    const originalPublishedAt = '2025-11-03T14:30:00.000Z';
    uploads.getOne.mockResolvedValueOnce(
      upload({
        replacementDocumentId: 'document-1',
        duplicateDocumentId: 'document-1',
      }),
    );
    documents.getOne.mockResolvedValueOnce(
      document({
        sourceKey: 'Custom/Stable-Runbook.pdf',
        category: 'Uncategorized',
        categoryId: 'category-uncategorized',
        documentType: 'cheatsheet',
        title: 'Original embedded title',
        displayTitle: 'Pinned operations title',
        publishedByAccountId: 'account-original-publisher',
        publishedByName: 'Original Publisher',
        publishedAt: originalPublishedAt,
      }),
    );

    await expect(
      service().replace({
        actor: ACTOR,
        requestId: 'request-replace',
        uploadId: 'upload-1',
        documentId: 'document-1',
        expectedRevision: 3,
      }),
    ).resolves.toMatchObject({
      id: 'document-1',
      fileName: 'Runbook.pdf',
      category: 'Uncategorized',
      categoryId: 'category-uncategorized',
      documentType: 'cheatsheet',
      displayTitle: 'Pinned operations title',
      publishedByName: 'Original Publisher',
      publishedAt: originalPublishedAt,
      revision: 4,
      searchIndexState: 'pending',
      searchIndexChecksum: null,
      searchIndexVersion: 0,
      searchIndexedAt: null,
      searchIndexError: null,
    });
    expect(documents.update).toHaveBeenCalledWith('document-1', expect.any(FormData), {
      requestKey: null,
    });
    const replacementForm = documents.update.mock.calls.at(-1)?.[1] as FormData;
    expect(replacementForm.get('sourceKey')).toBe('Custom/Stable-Runbook.pdf');
    expect(replacementForm.get('title')).toBe('Original embedded title');
    expect(replacementForm.get('displayTitle')).toBe('Pinned operations title');
    expect(replacementForm.get('publishedByAccountId')).toBe('account-original-publisher');
    expect(replacementForm.get('publishedByName')).toBe('Original Publisher');
    expect(replacementForm.get('publishedAt')).toBe(originalPublishedAt);
    expect(replacementForm.get('categoryId')).toBe('category-uncategorized');
    expect(replacementForm.get('documentType')).toBe('cheatsheet');
    expect(replacementForm.get('searchIndexState')).toBe('pending');
    expect(replacementForm.get('searchIndexVersion')).toBe('0');
    expect(replacementForm.get('publishedByOperatorId')).toBe('');
  });

  it('rejects a replace command that redirects an explicitly bound upload', async () => {
    uploads.getOne.mockResolvedValueOnce(
      upload({
        replacementDocumentId: 'document-target',
        duplicateDocumentId: 'document-target',
      }),
    );

    await expect(
      service().replace({
        actor: ACTOR,
        requestId: 'request-retarget',
        uploadId: 'upload-1',
        documentId: 'document-1',
        expectedRevision: 3,
      }),
    ).rejects.toThrow('Knowledge replacement target is unavailable.');
    expect(documents.update).not.toHaveBeenCalled();
  });

  it('replaces the current same-filename document when a generic upload has a stale duplicate ID', async () => {
    uploads.getOne.mockResolvedValueOnce(
      upload({
        fileName: 'Runbook.pdf',
        replacementDocumentId: null,
        duplicateDocumentId: 'document-stale',
      }),
    );

    await expect(
      service().replace({
        actor: ACTOR,
        requestId: 'request-current-filename-target',
        uploadId: 'upload-1',
        documentId: 'document-1',
        expectedRevision: 3,
      }),
    ).resolves.toMatchObject({
      id: 'document-1',
      fileName: 'Runbook.pdf',
      revision: 4,
    });
    expect(documents.update).toHaveBeenCalledOnce();
  });

  it('rejects replacement after the bound document is trashed', async () => {
    uploads.getOne.mockResolvedValueOnce(
      upload({
        replacementDocumentId: 'document-1',
        duplicateDocumentId: 'document-1',
      }),
    );
    documents.getOne.mockResolvedValueOnce(
      document({
        lifecycleState: 'trashed',
        trashedByAccountId: ACTOR.accountId,
        trashedByName: ACTOR.displayName,
        trashedAt: NOW,
      }),
    );

    await expect(
      service().replace({
        actor: ACTOR,
        requestId: 'request-trashed-target',
        uploadId: 'upload-1',
        documentId: 'document-1',
        expectedRevision: 3,
      }),
    ).rejects.toThrow('Knowledge replacement target is unavailable.');
    expect(documents.update).not.toHaveBeenCalled();
  });

  it('trashes with account attribution while leaving legacy identity blank', async () => {
    await expect(
      service().trash({
        actor: ACTOR,
        requestId: 'request-trash',
        documentId: 'document-1',
        expectedRevision: 3,
      }),
    ).resolves.toMatchObject({ lifecycleState: 'trashed', trashedByName: ACTOR.displayName });
    expect(documents.update).toHaveBeenCalledWith(
      'document-1',
      expect.objectContaining({
        trashedByAccountId: ACTOR.accountId,
        trashedByOperatorId: '',
      }),
      { requestKey: null },
    );
  });

  it('enforces optimistic revisions and canonicalizes cleared trash fields on restore', async () => {
    await expect(
      service().setTitle({
        actor: ACTOR,
        requestId: 'request-title',
        documentId: 'document-1',
        title: 'New title',
        expectedRevision: 2,
      }),
    ).rejects.toEqual(new ManagedKnowledgeConflictError(3));

    documents.getOne.mockResolvedValueOnce(
      document({
        lifecycleState: 'trashed',
        trashedByOperatorId: 'operator-admin',
        trashedByName: 'Ryan Bledsoe',
        trashedAt: NOW,
      }),
    );
    await expect(
      service().restore({
        actor: ACTOR,
        requestId: 'request-restore',
        documentId: 'document-1',
        expectedRevision: 3,
      }),
    ).resolves.toMatchObject({
      lifecycleState: 'active',
      trashedByName: null,
      trashedAt: null,
      revision: 4,
    });
    expect(documents.update).toHaveBeenCalledWith(
      'document-1',
      expect.objectContaining({
        trashedByAccountId: '',
        trashedByOperatorId: '',
      }),
      { requestKey: null },
    );
  });

  it('atomically deletes a trashed document with its permanent-deletion audit record', async () => {
    documents.getOne.mockResolvedValueOnce(
      document({
        lifecycleState: 'trashed',
        trashedByAccountId: ACTOR.accountId,
        trashedByName: ACTOR.displayName,
        trashedAt: NOW,
      }),
    );
    await expect(
      service().deletePermanently({
        actor: ACTOR,
        requestId: 'request-delete',
        documentId: 'document-1',
        expectedRevision: 3,
      }),
    ).resolves.toEqual({ id: 'document-1', deleted: true });
    expect(batchAudits.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-delete',
        action: 'deleted',
        targetId: 'document-1',
      }),
    );
    expect(batchDocuments.delete).toHaveBeenCalledWith('document-1');
    expect(batch.send).toHaveBeenCalledWith({ requestKey: null });
    expect(audits.create).not.toHaveBeenCalled();
    expect(documents.delete).not.toHaveBeenCalled();
  });

  it('rejects a permanent deletion when its transactional batch does not fully commit', async () => {
    documents.getOne.mockResolvedValueOnce(
      document({
        lifecycleState: 'trashed',
        trashedByAccountId: ACTOR.accountId,
        trashedByName: ACTOR.displayName,
        trashedAt: NOW,
      }),
    );
    batch.send.mockResolvedValueOnce([{ status: 200 }, { status: 500 }]);

    await expect(
      service().deletePermanently({
        actor: ACTOR,
        requestId: 'request-delete-failed',
        documentId: 'document-1',
        expectedRevision: 3,
      }),
    ).rejects.toThrow('Permanent document deletion did not commit.');

    expect(batchAudits.create).toHaveBeenCalledOnce();
    expect(batchDocuments.delete).toHaveBeenCalledOnce();
    expect(audits.create).not.toHaveBeenCalled();
    expect(documents.delete).not.toHaveBeenCalled();
  });

  it('creates categories while rejecting case-insensitive duplicate names', async () => {
    await expect(
      service().createCategory({
        actor: ACTOR,
        requestId: 'request-create-category',
        name: 'Network',
        afterCategoryId: 'category-operations',
      }),
    ).resolves.toMatchObject({ id: 'category-new', name: 'Network', revision: 1 });

    await expect(
      service().createCategory({
        actor: ACTOR,
        requestId: 'request-duplicate-category',
        name: '  OPERATIONS  ',
        afterCategoryId: null,
      }),
    ).rejects.toThrow(/already exists/i);
    expect(audits.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'category-created' }),
      { requestKey: null },
    );
  });

  it('updates document title, category, type, and source key together', async () => {
    await expect(
      service().setDocumentMetadata({
        actor: ACTOR,
        requestId: 'request-metadata',
        documentId: 'document-1',
        title: 'Oracle quick reference',
        categoryId: 'category-uncategorized',
        documentType: 'cheatsheet',
        expectedRevision: 3,
      }),
    ).resolves.toMatchObject({
      displayTitle: 'Oracle quick reference',
      categoryId: 'category-uncategorized',
      category: 'Uncategorized',
      documentType: 'cheatsheet',
      revision: 4,
    });
    expect(documents.update).toHaveBeenCalledWith(
      'document-1',
      expect.objectContaining({
        sourceKey: 'Uncategorized/Runbook.pdf',
        documentType: 'cheatsheet',
      }),
      { requestKey: null },
    );
  });

  it('reorders the complete category set with optimistic revisions', async () => {
    await expect(
      service().setCategoryOrder({
        actor: ACTOR,
        requestId: 'request-order',
        orderedCategoryIds: ['category-uncategorized', 'category-operations'],
        expectedRevisions: {
          'category-operations': 2,
          'category-uncategorized': 1,
        },
      }),
    ).resolves.toHaveLength(2);
    expect(categories.update).toHaveBeenCalledWith(
      'category-uncategorized',
      expect.objectContaining({ sortOrder: 100, revision: 2 }),
      { requestKey: null },
    );
  });

  it('reassigns documents before deleting a non-system category', async () => {
    documents.getFullList.mockResolvedValueOnce([document()]);
    await expect(
      service().deleteCategory({
        actor: ACTOR,
        requestId: 'request-delete-category',
        categoryId: 'category-operations',
        replacementCategoryId: 'category-uncategorized',
        expectedRevision: 2,
        expectedDocumentRevisions: { 'document-1': 3 },
      }),
    ).resolves.toBeUndefined();
    expect(documents.update).toHaveBeenCalledBefore(categories.delete);
    expect(categories.delete).toHaveBeenCalledWith('category-operations', { requestKey: null });

    await expect(
      service().deleteCategory({
        actor: ACTOR,
        requestId: 'request-delete-fallback',
        categoryId: 'category-uncategorized',
        replacementCategoryId: 'category-operations',
        expectedRevision: 1,
        expectedDocumentRevisions: {},
      }),
    ).rejects.toThrow(/cannot be deleted/i);
  });
});
