import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_AUDIT_EVENTS_COLLECTION,
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
    title: 'Runbook',
    displayTitle: 'Runbook',
    fileName: 'Runbook.pdf',
    pdf: 'stored.pdf',
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
    checksum: CHECKSUM,
    byteSize: PDF.byteLength,
    state: 'ready',
    progress: 100,
    proposedTitle: 'Replacement',
    proposedCategory: 'General',
    pageCount: 2,
    outline: [],
    outlineSource: 'none',
    duplicateDocumentId: null,
    safeError: null,
    expiresAt: '2026-07-17T01:00:00.000Z',
    revision: 1,
    ...overrides,
  };
}

describe('ManagedKnowledgeService', () => {
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
  const libraryState = {
    getFirstListItem: vi.fn(async () => ({ mode: 'managed' })),
  };
  const pb = {
    collection: vi.fn((name: string) => {
      if (name === KNOWLEDGE_DOCUMENTS_COLLECTION) return documents;
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
    uploads.getOne.mockResolvedValue(upload());
  });

  function service() {
    return new ManagedKnowledgeService({
      pb: pb as never,
      now: () => Date.parse(NOW),
      readUploadPdf: vi.fn(async () => PDF),
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
    expect(normalizeKnowledgeManagementSnapshot(snapshot)).not.toBeNull();
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
      displayTitle: 'Checkout Runbook',
      fileName: 'Replacement.pdf',
      lifecycleState: 'active',
      revision: 1,
      publishedByName: 'Ryan Bledsoe',
    });
    expect(documents.create).toHaveBeenCalledWith(expect.any(FormData), { requestKey: null });
    const publishForm = documents.create.mock.calls[0]?.[0] as FormData;
    expect(publishForm.get('publishedByAccountId')).toBe(ACTOR.accountId);
    expect(publishForm.get('publishedByOperatorId')).toBe('');
    expect(publishForm.get('trashedByAccountId')).toBe('');
    expect(publishForm.get('trashedByOperatorId')).toBe('');
    expect(uploads.update).toHaveBeenCalledWith(
      'upload-1',
      { state: 'published', pdf: null },
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

  it('replaces PDF bytes while preserving the stable document and relative-link filename', async () => {
    await expect(
      service().replace({
        actor: ACTOR,
        requestId: 'request-replace',
        uploadId: 'upload-1',
        documentId: 'document-1',
        expectedRevision: 3,
        title: 'Runbook revised',
        category: 'Operations',
      }),
    ).resolves.toMatchObject({
      id: 'document-1',
      fileName: 'Runbook.pdf',
      displayTitle: 'Runbook revised',
      revision: 4,
    });
    expect(documents.update).toHaveBeenCalledWith('document-1', expect.any(FormData), {
      requestKey: null,
    });
    const replacementForm = documents.update.mock.calls.at(-1)?.[1] as FormData;
    expect(replacementForm.get('publishedByAccountId')).toBe(ACTOR.accountId);
    expect(replacementForm.get('publishedByOperatorId')).toBe('');
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

  it('only permanently deletes a trashed document and preserves its audit record', async () => {
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
    expect(audits.create).toHaveBeenCalledBefore(documents.delete);
  });
});
