import { createHash } from 'node:crypto';
import type PocketBase from 'pocketbase';
import {
  KNOWLEDGE_AUDIT_EVENTS_COLLECTION,
  KNOWLEDGE_CATEGORIES_COLLECTION,
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_LIBRARY_STATE_COLLECTION,
  KNOWLEDGE_MAX_CATEGORY_LENGTH,
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_MAX_COVER_BYTES,
  KNOWLEDGE_UPLOADS_COLLECTION,
  compareKnowledgeCategories,
  compareKnowledgeDocuments,
  knowledgeCategoryKey,
  normalizeKnowledgeAuditEventView,
  normalizeKnowledgeCategoryName,
  normalizeKnowledgeCategoryRecord,
  normalizeKnowledgeDocumentRecord,
  normalizeKnowledgeSearchText,
  type KnowledgeAuditAction,
  type KnowledgeAuditEventView,
  type KnowledgeCategoryRecord,
  type KnowledgeDocumentRecord,
  type KnowledgeDocumentType,
  type KnowledgeLibraryMode,
  type KnowledgeManagementDocumentView,
  type KnowledgeManagementSnapshot,
  type KnowledgeManagementUploadView,
  type KnowledgePage,
  type KnowledgeUploadView,
} from '@shared/knowledge';

type Actor = { accountId: string; displayName: string };
type UploadRecord = KnowledgeUploadView & {
  pdf: string;
  cover: string;
  accountId: string;
  replacementDocumentId?: string | null;
};
type StoredUploadRecord = Partial<KnowledgeUploadView> & {
  id: string;
  requestId: string;
  fileName: string;
  checksum: string;
  byteSize: number;
  state: KnowledgeUploadView['state'];
  expiresAt: string;
  revision: number;
  replacementDocumentId?: string | null;
};

export class ManagedKnowledgeFilenameConflictError extends Error {
  constructor() {
    super('A published document with this PDF filename already exists.');
    this.name = 'ManagedKnowledgeFilenameConflictError';
  }
}

type ManagedKnowledgeServiceOptions = {
  pb: PocketBase;
  now?: () => number;
  readUploadPdf?: (record: UploadRecord) => Promise<Uint8Array>;
  readUploadCover?: (record: UploadRecord) => Promise<Uint8Array>;
  fetch?: typeof globalThis.fetch;
};

export class ManagedKnowledgeConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super('The Knowledge document changed. Refresh and try again.');
    this.name = 'ManagedKnowledgeConflictError';
  }
}

function escapeFilter(value: string): string {
  return value.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`);
}

function normalizedText(value: string, max: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > max) throw new Error('Knowledge metadata is invalid.');
  return normalized;
}

function firstNonEmptyString(...values: readonly unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return '';
}

function knowledgeDocumentId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('PocketBase did not return a Knowledge document ID.');
  }
  return value;
}

function sourceKey(category: string, fileName: string): string {
  return `${category}/${fileName}`;
}

function documentView(document: KnowledgeDocumentRecord): KnowledgeManagementDocumentView {
  return {
    id: document.id,
    checksum: document.checksum,
    category: document.category,
    categoryId: document.categoryId,
    documentType: document.documentType,
    displayTitle: document.displayTitle,
    fileName: document.fileName,
    byteSize: document.byteSize,
    pageCount: document.pageCount,
    lifecycleState: document.lifecycleState,
    revision: document.revision,
    publishedByName: document.publishedByName,
    publishedAt: document.publishedAt,
    trashedByName: document.trashedByName,
    trashedAt: document.trashedAt,
    searchIndexState: document.searchIndexState,
    searchIndexChecksum: document.searchIndexChecksum,
    searchIndexVersion: document.searchIndexVersion,
    searchIndexedAt: document.searchIndexedAt,
    searchIndexError: document.searchIndexError,
    updated: document.updated,
  };
}

function uploadView(
  upload: StoredUploadRecord,
  duplicateDocumentId: string | null = upload.duplicateDocumentId || null,
): KnowledgeManagementUploadView {
  let progress = 50;
  if (upload.state === 'failed') progress = 0;
  if (upload.state === 'ready' || upload.state === 'published') progress = 100;
  return {
    id: upload.id,
    requestId: upload.requestId,
    fileName: upload.fileName,
    byteSize: upload.byteSize,
    checksum: upload.checksum,
    state: upload.state,
    progress,
    proposedTitle: upload.proposedTitle || upload.fileName.replace(/\.pdf$/i, ''),
    proposedCategory: upload.proposedCategory || 'General',
    proposedCategoryId: upload.proposedCategoryId || null,
    proposedDocumentType: upload.proposedDocumentType === 'cheatsheet' ? 'cheatsheet' : 'sop',
    pageCount:
      Number.isInteger(upload.pageCount) && Number(upload.pageCount) > 0
        ? Number(upload.pageCount)
        : null,
    outlineSource: upload.outlineSource || null,
    outlineCount: Array.isArray(upload.outline) ? upload.outline.length : 0,
    duplicateDocumentId,
    safeError: upload.safeError || null,
    expiresAt: canonicalTimestamp(upload.expiresAt),
    revision: Number.isInteger(upload.revision) ? upload.revision : 0,
  };
}

function auditView(event: KnowledgeAuditEventView): KnowledgeAuditEventView {
  return {
    id: event.id,
    requestId: event.requestId,
    action: event.action,
    targetId: event.targetId || null,
    fileName: event.fileName || null,
    title: event.title || null,
    category: event.category || null,
    accountId: event.accountId,
    actorDisplayName: event.actorDisplayName,
    occurredAt: canonicalTimestamp(event.occurredAt),
  };
}

function canonicalTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date(0).toISOString();
}

export class ManagedKnowledgeService {
  private readonly pb: PocketBase;
  private readonly now: () => number;
  private readonly readUploadPdf: (record: UploadRecord) => Promise<Uint8Array>;
  private readonly readUploadCover: (record: UploadRecord) => Promise<Uint8Array>;

  constructor(options: ManagedKnowledgeServiceOptions) {
    this.pb = options.pb;
    this.now = options.now ?? Date.now;
    const fetchImpl = options.fetch ?? globalThis.fetch;
    this.readUploadPdf =
      options.readUploadPdf ??
      (async (record) => {
        const token = await this.pb.files.getToken({ requestKey: null });
        const url = this.pb.files.getURL(record as never, record.pdf, { token });
        const response = await fetchImpl(url, { redirect: 'error' });
        if (!response.ok) throw new Error('Knowledge upload is unavailable.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > KNOWLEDGE_MAX_PDF_BYTES)
          throw new Error('Knowledge upload is invalid.');
        return bytes;
      });
    this.readUploadCover =
      options.readUploadCover ??
      (async (record) => {
        const token = await this.pb.files.getToken({ requestKey: null });
        const url = this.pb.files.getURL(record as never, record.cover, { token });
        const response = await fetchImpl(url, { redirect: 'error' });
        if (!response.ok) throw new Error('Knowledge upload cover is unavailable.');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength < 1 || bytes.byteLength > KNOWLEDGE_MAX_COVER_BYTES) {
          throw new Error('Knowledge upload cover is invalid.');
        }
        return bytes;
      });
  }

  async snapshot(input: {
    accountId: string;
    query: string;
    cursor: string | null;
    pageSize: number;
  }): Promise<KnowledgeManagementSnapshot> {
    const pageSize = Math.min(input.pageSize, 25);
    const [mode, categories, documents, uploads] = await Promise.all([
      this.readMode(),
      this.readCategories(),
      this.readDocuments(),
      this.pb.collection(KNOWLEDGE_UPLOADS_COLLECTION).getFullList<StoredUploadRecord>({
        filter: `accountId="${escapeFilter(input.accountId)}" && state!="published" && state!="cancelled"`,
        requestKey: null,
      }),
    ]);
    const query = normalizeKnowledgeSearchText(input.query);
    const activeDocuments = documents.filter(({ lifecycleState }) => lifecycleState === 'active');
    const activeDocumentIds = new Set(activeDocuments.map(({ id }) => id));
    const activeDocumentById = new Map(activeDocuments.map((document) => [document.id, document]));
    const activeDocumentIdByFilename = new Map(
      activeDocuments.map(({ fileName, id }) => [fileName, id]),
    );
    const matches = documents.filter((document) => {
      const text = normalizeKnowledgeSearchText(
        `${document.displayTitle} ${document.fileName} ${document.category}`,
      );
      return !query || query.split(' ').every((term) => text.includes(term));
    });
    const sortedUploads = uploads
      .filter(({ state }) => state !== 'published' && state !== 'cancelled')
      .toSorted((left, right) => right.expiresAt.localeCompare(left.expiresAt));
    const uploadStart = input.cursor
      ? Math.max(0, sortedUploads.findIndex(({ id }) => id === input.cursor) + 1)
      : 0;
    const uploadItems = sortedUploads.slice(uploadStart, uploadStart + pageSize);
    return {
      mode,
      categories,
      documents: this.page(
        matches.filter(({ lifecycleState }) => lifecycleState === 'active'),
        input.cursor,
        pageSize,
      ),
      trash: this.page(
        matches.filter(({ lifecycleState }) => lifecycleState === 'trashed'),
        input.cursor,
        pageSize,
      ),
      uploads: {
        items: uploadItems.map((item) => {
          const explicitReplacementDocumentId = item.replacementDocumentId || null;
          const storedReplacementId =
            item.duplicateDocumentId && activeDocumentIds.has(item.duplicateDocumentId)
              ? item.duplicateDocumentId
              : null;
          const replacementDocumentId =
            explicitReplacementDocumentId ??
            storedReplacementId ??
            activeDocumentIdByFilename.get(item.fileName) ??
            null;
          const replacementDocument = replacementDocumentId
            ? activeDocumentById.get(replacementDocumentId)
            : undefined;
          return {
            ...uploadView(item, replacementDocumentId),
            replacementDocument: replacementDocument ? documentView(replacementDocument) : null,
          };
        }),
        nextCursor:
          uploadStart + pageSize < sortedUploads.length ? (uploadItems.at(-1)?.id ?? null) : null,
      },
    };
  }

  async publish(input: {
    actor: Actor;
    requestId: string;
    uploadId: string;
    title: string;
    category: string;
    documentType?: KnowledgeDocumentType;
  }): Promise<KnowledgeManagementDocumentView> {
    const upload = await this.readyUpload(input.uploadId, input.actor);
    if (upload.replacementDocumentId) {
      throw new Error('Knowledge replacement cannot be published as a new document.');
    }
    await this.assertUniqueFilename(upload.fileName);
    const title = normalizedText(input.title, 240);
    const category = await this.resolveOrCreateCategoryByName(input.category);
    const [bytes, coverBytes] = await Promise.all([
      this.readAndVerifyUpload(upload),
      this.readAndVerifyCover(upload),
    ]);
    const publishedAt = this.timestamp();
    const documentType = input.documentType === 'cheatsheet' ? 'cheatsheet' : 'sop';
    const form = this.documentForm(upload, bytes, coverBytes, {
      category: category.name,
      categoryId: category.id,
      documentType,
      title,
      fileName: upload.fileName,
      publishedAt,
      actor: input.actor,
      revision: 1,
    });
    const saved = await this.pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).create(form, {
      requestKey: null,
    });
    const document = this.documentFromSaved(saved, upload, {
      category: category.name,
      categoryId: category.id,
      documentType,
      title,
      fileName: upload.fileName,
      publishedAt,
      actor: input.actor,
      revision: 1,
    });
    await this.completeUpload(upload);
    await this.audit(input.requestId, 'published', document, input.actor);
    return documentView(document);
  }

  async replace(input: {
    actor: Actor;
    requestId: string;
    uploadId: string;
    documentId: string;
    expectedRevision: number;
  }): Promise<KnowledgeManagementDocumentView> {
    const [upload, current] = await Promise.all([
      this.readyUpload(input.uploadId, input.actor),
      this.getDocument(input.documentId),
    ]);
    const replacementTargetMatches = upload.replacementDocumentId
      ? upload.replacementDocumentId === input.documentId
      : upload.fileName === current.fileName;
    if (
      !replacementTargetMatches ||
      current.id !== input.documentId ||
      current.lifecycleState !== 'active'
    ) {
      throw new Error('Knowledge replacement target is unavailable.');
    }
    this.assertRevision(current, input.expectedRevision);
    const [bytes, coverBytes] = await Promise.all([
      this.readAndVerifyUpload(upload),
      this.readAndVerifyCover(upload),
    ]);
    const contentUpdatedAt = this.timestamp();
    const metadata = {
      sourceKey: current.sourceKey,
      category: current.category,
      categoryId: current.categoryId,
      documentType: current.documentType,
      title: current.title,
      displayTitle: current.displayTitle,
      fileName: current.fileName,
      contentUpdatedAt,
      publishedAt: current.publishedAt,
      actor: {
        accountId: current.publishedByAccountId,
        displayName: current.publishedByName,
      },
      revision: current.revision + 1,
    };
    const saved = await this.pb
      .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
      .update(current.id, this.documentForm(upload, bytes, coverBytes, metadata), {
        requestKey: null,
      });
    const document = this.documentFromSaved(saved, upload, metadata, current);
    await this.completeUpload(upload);
    await this.audit(input.requestId, 'replaced', document, input.actor);
    return documentView(document);
  }

  async setTitle(input: {
    actor: Actor;
    requestId: string;
    documentId: string;
    title: string;
    expectedRevision: number;
  }): Promise<KnowledgeManagementDocumentView> {
    return this.patchDocument(input, 'title-changed', {
      displayTitle: normalizedText(input.title, 240),
    });
  }

  async setCategory(input: {
    actor: Actor;
    requestId: string;
    documentId: string;
    category: string;
    expectedRevision: number;
  }): Promise<KnowledgeManagementDocumentView> {
    const current = await this.getDocument(input.documentId);
    const category = normalizedText(input.category, KNOWLEDGE_MAX_CATEGORY_LENGTH);
    return this.patchKnownDocument(input, current, 'category-changed', {
      category,
      sourceKey: sourceKey(category, current.fileName),
    });
  }

  async renameCategory(input: {
    actor: Actor;
    requestId: string;
    from: string;
    to: string;
    expectedDocumentRevisions: Record<string, number>;
  }): Promise<KnowledgeManagementDocumentView[]> {
    const from = normalizedText(input.from, KNOWLEDGE_MAX_CATEGORY_LENGTH);
    const to = normalizedText(input.to, KNOWLEDGE_MAX_CATEGORY_LENGTH);
    const documents = (await this.readDocuments()).filter(({ category }) => category === from);
    for (const document of documents) {
      this.assertRevision(document, input.expectedDocumentRevisions[document.id] ?? -1);
    }
    const changed: KnowledgeManagementDocumentView[] = [];
    for (const document of documents) {
      changed.push(
        await this.patchKnownDocument(
          {
            actor: input.actor,
            requestId: input.requestId,
            documentId: document.id,
            expectedRevision: document.revision,
          },
          document,
          'category-renamed',
          { category: to, sourceKey: sourceKey(to, document.fileName) },
          false,
        ),
      );
    }
    await this.audit(input.requestId, 'category-renamed', null, input.actor, { from, to });
    return changed;
  }

  async createCategory(input: {
    actor: Actor;
    requestId: string;
    name: string;
    afterCategoryId: string | null;
  }): Promise<KnowledgeCategoryRecord> {
    const name = normalizeKnowledgeCategoryName(
      normalizedText(input.name, KNOWLEDGE_MAX_CATEGORY_LENGTH),
    );
    const categories = await this.readCategories();
    this.assertUniqueCategoryName(categories, name);
    const afterIndex = input.afterCategoryId
      ? categories.findIndex(({ id }) => id === input.afterCategoryId)
      : categories.length - 1;
    if (input.afterCategoryId && afterIndex < 0)
      throw new Error('Knowledge category is unavailable.');
    const previousOrder = categories[afterIndex]?.sortOrder ?? 0;
    const nextOrder = categories[afterIndex + 1]?.sortOrder ?? previousOrder + 200;
    const saved = await this.pb.collection(KNOWLEDGE_CATEGORIES_COLLECTION).create(
      {
        name,
        normalizedName: knowledgeCategoryKey(name),
        sortOrder: Math.floor((previousOrder + nextOrder) / 2),
        systemKey: '',
        revision: 1,
      },
      { requestKey: null },
    );
    const category = normalizeKnowledgeCategoryRecord(saved);
    if (!category) throw new Error('Knowledge category creation was invalid.');
    await this.audit(input.requestId, 'category-created', null, input.actor, {
      categoryId: category.id,
      name: category.name,
    });
    return category;
  }

  async setCategoryName(input: {
    actor: Actor;
    requestId: string;
    categoryId: string;
    name: string;
    expectedRevision: number;
  }): Promise<KnowledgeCategoryRecord> {
    const [current, categories] = await Promise.all([
      this.getCategory(input.categoryId),
      this.readCategories(),
    ]);
    this.assertCategoryRevision(current, input.expectedRevision);
    const name = normalizeKnowledgeCategoryName(
      normalizedText(input.name, KNOWLEDGE_MAX_CATEGORY_LENGTH),
    );
    this.assertUniqueCategoryName(categories, name, current.id);
    const saved = await this.pb.collection(KNOWLEDGE_CATEGORIES_COLLECTION).update(
      current.id,
      {
        name,
        normalizedName: knowledgeCategoryKey(name),
        revision: current.revision + 1,
      },
      { requestKey: null },
    );
    const category = normalizeKnowledgeCategoryRecord({ ...current, ...saved });
    if (!category) throw new Error('Knowledge category update was invalid.');
    const documents = (await this.readDocuments()).filter(
      ({ categoryId }) => categoryId === current.id,
    );
    for (const document of documents) {
      await this.patchKnownDocument(
        {
          actor: input.actor,
          requestId: input.requestId,
          documentId: document.id,
          expectedRevision: document.revision,
        },
        document,
        'category-renamed',
        { category: name, sourceKey: sourceKey(name, document.fileName) },
        false,
      );
    }
    await this.audit(input.requestId, 'category-renamed', null, input.actor, {
      categoryId: category.id,
      from: current.name,
      to: category.name,
    });
    return category;
  }

  async setCategoryOrder(input: {
    actor: Actor;
    requestId: string;
    orderedCategoryIds: string[];
    expectedRevisions: Record<string, number>;
  }): Promise<KnowledgeCategoryRecord[]> {
    const categories = await this.readCategories();
    const currentIds = categories
      .map(({ id }) => id)
      .toSorted((left, right) => left.localeCompare(right));
    const orderedIds = input.orderedCategoryIds.toSorted((left, right) =>
      left.localeCompare(right),
    );
    if (
      currentIds.length !== orderedIds.length ||
      currentIds.some((id, index) => id !== orderedIds[index])
    ) {
      throw new Error('The complete Knowledge category order is required.');
    }
    for (const category of categories) {
      this.assertCategoryRevision(category, input.expectedRevisions[category.id] ?? -1);
    }
    const byId = new Map(categories.map((category) => [category.id, category]));
    const updated: KnowledgeCategoryRecord[] = [];
    for (const [index, id] of input.orderedCategoryIds.entries()) {
      const current = byId.get(id)!;
      const saved = await this.pb
        .collection(KNOWLEDGE_CATEGORIES_COLLECTION)
        .update(
          id,
          { sortOrder: (index + 1) * 100, revision: current.revision + 1 },
          { requestKey: null },
        );
      const category = normalizeKnowledgeCategoryRecord({ ...current, ...saved });
      if (!category) throw new Error('Knowledge category order update was invalid.');
      updated.push(category);
    }
    await this.audit(input.requestId, 'category-reordered', null, input.actor, {
      orderedCategoryIds: input.orderedCategoryIds,
    });
    return updated;
  }

  async deleteCategory(input: {
    actor: Actor;
    requestId: string;
    categoryId: string;
    replacementCategoryId: string;
    expectedRevision: number;
    expectedDocumentRevisions: Record<string, number>;
  }): Promise<void> {
    if (input.categoryId === input.replacementCategoryId) {
      throw new Error('A different replacement category is required.');
    }
    const [current, replacement, documents] = await Promise.all([
      this.getCategory(input.categoryId),
      this.getCategory(input.replacementCategoryId),
      this.readDocuments(),
    ]);
    this.assertCategoryRevision(current, input.expectedRevision);
    if (current.systemKey === 'uncategorized') {
      throw new Error('The fallback Knowledge category cannot be deleted.');
    }
    const affected = documents.filter(({ categoryId }) => categoryId === current.id);
    for (const document of affected) {
      this.assertRevision(document, input.expectedDocumentRevisions[document.id] ?? -1);
    }
    for (const document of affected) {
      await this.patchKnownDocument(
        {
          actor: input.actor,
          requestId: input.requestId,
          documentId: document.id,
          expectedRevision: document.revision,
        },
        document,
        'documents-reassigned',
        {
          categoryId: replacement.id,
          category: replacement.name,
          sourceKey: sourceKey(replacement.name, document.fileName),
        },
        false,
      );
    }
    await this.pb.collection(KNOWLEDGE_CATEGORIES_COLLECTION).delete(current.id, {
      requestKey: null,
    });
    await this.audit(input.requestId, 'category-deleted', null, input.actor, {
      categoryId: current.id,
      replacementCategoryId: replacement.id,
      documentIds: affected.map(({ id }) => id),
    });
  }

  async setDocumentMetadata(input: {
    actor: Actor;
    requestId: string;
    documentId: string;
    title: string;
    categoryId: string;
    documentType: KnowledgeDocumentType;
    expectedRevision: number;
  }): Promise<KnowledgeManagementDocumentView> {
    const [current, category] = await Promise.all([
      this.getDocument(input.documentId),
      this.getCategory(input.categoryId),
    ]);
    return this.patchKnownDocument(input, current, 'document-type-changed', {
      displayTitle: normalizedText(input.title, 240),
      categoryId: category.id,
      category: category.name,
      documentType: input.documentType,
      sourceKey: sourceKey(category.name, current.fileName),
    });
  }

  async assignDocumentCategories(input: {
    actor: Actor;
    requestId: string;
    categoryId: string;
    documents: Array<{ documentId: string; expectedRevision: number }>;
  }): Promise<KnowledgeManagementDocumentView[]> {
    const category = await this.getCategory(input.categoryId);
    const changed: KnowledgeManagementDocumentView[] = [];
    for (const item of input.documents) {
      const document = await this.getDocument(item.documentId);
      changed.push(
        await this.patchKnownDocument(
          {
            actor: input.actor,
            requestId: input.requestId,
            documentId: item.documentId,
            expectedRevision: item.expectedRevision,
          },
          document,
          'documents-reassigned',
          {
            categoryId: category.id,
            category: category.name,
            sourceKey: sourceKey(category.name, document.fileName),
          },
          false,
        ),
      );
    }
    await this.audit(input.requestId, 'documents-reassigned', null, input.actor, {
      categoryId: category.id,
      documentIds: input.documents.map(({ documentId }) => documentId),
    });
    return changed;
  }

  async trash(input: {
    actor: Actor;
    requestId: string;
    documentId: string;
    expectedRevision: number;
  }): Promise<KnowledgeManagementDocumentView> {
    return this.patchDocument(input, 'trashed', {
      lifecycleState: 'trashed',
      trashedByAccountId: input.actor.accountId,
      trashedByOperatorId: '',
      trashedByName: input.actor.displayName,
      trashedAt: this.timestamp(),
    });
  }

  async restore(input: {
    actor: Actor;
    requestId: string;
    documentId: string;
    expectedRevision: number;
  }): Promise<KnowledgeManagementDocumentView> {
    const current = await this.getDocument(input.documentId);
    await this.assertUniqueFilename(current.fileName, current.id);
    return this.patchKnownDocument(input, current, 'restored', {
      lifecycleState: 'active',
      trashedByAccountId: '',
      trashedByOperatorId: '',
      trashedByName: '',
      trashedAt: '',
    });
  }

  async deletePermanently(input: {
    actor: Actor;
    requestId: string;
    documentId: string;
    expectedRevision: number;
  }): Promise<{ id: string; deleted: true }> {
    const current = await this.getDocument(input.documentId);
    this.assertRevision(current, input.expectedRevision);
    if (current.lifecycleState !== 'trashed')
      throw new Error('Only trashed documents can be deleted.');
    const batch = this.pb.createBatch();
    batch
      .collection(KNOWLEDGE_AUDIT_EVENTS_COLLECTION)
      .create(this.auditRecord(input.requestId, 'deleted', current, input.actor));
    batch.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).delete(current.id);
    const results = await batch.send({ requestKey: null });
    if (results.length !== 2 || results.some(({ status }) => status < 200 || status >= 300)) {
      throw new Error('Permanent document deletion did not commit.');
    }
    return { id: current.id, deleted: true };
  }

  async readAudit(input: {
    cursor: string | null;
    pageSize: number;
    targetId: string | null;
  }): Promise<KnowledgePage<KnowledgeAuditEventView>> {
    const rawEvents = await this.pb
      .collection(KNOWLEDGE_AUDIT_EVENTS_COLLECTION)
      .getFullList<Record<string, unknown>>({ requestKey: null, sort: '-occurredAt' });
    const events = rawEvents
      .map(normalizeKnowledgeAuditEventView)
      .filter((event): event is KnowledgeAuditEventView => event !== null);
    const filtered = input.targetId
      ? events.filter(({ targetId }) => targetId === input.targetId)
      : events;
    const start = input.cursor
      ? Math.max(0, filtered.findIndex(({ id }) => id === input.cursor) + 1)
      : 0;
    const pageSize = Math.min(input.pageSize, 25);
    const items = filtered.slice(start, start + pageSize).map(auditView);
    return {
      items,
      nextCursor: start + pageSize < filtered.length ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private async readMode(): Promise<KnowledgeLibraryMode> {
    const state = await this.pb
      .collection(KNOWLEDGE_LIBRARY_STATE_COLLECTION)
      .getFirstListItem<{ mode: KnowledgeLibraryMode }>('key="primary"', { requestKey: null });
    return state.mode;
  }

  private async readCategories(): Promise<KnowledgeCategoryRecord[]> {
    const records = await this.pb.collection(KNOWLEDGE_CATEGORIES_COLLECTION).getFullList({
      sort: 'sortOrder,name',
      requestKey: null,
    });
    return records
      .map(normalizeKnowledgeCategoryRecord)
      .filter((record): record is KnowledgeCategoryRecord => record !== null)
      .toSorted(compareKnowledgeCategories);
  }

  private async getCategory(id: string): Promise<KnowledgeCategoryRecord> {
    const record = await this.pb
      .collection(KNOWLEDGE_CATEGORIES_COLLECTION)
      .getOne(id, { requestKey: null });
    const category = normalizeKnowledgeCategoryRecord(record);
    if (!category) throw new Error('Knowledge category is unavailable.');
    return category;
  }

  private async resolveOrCreateCategoryByName(value: string): Promise<KnowledgeCategoryRecord> {
    const name = normalizeKnowledgeCategoryName(
      normalizedText(value, KNOWLEDGE_MAX_CATEGORY_LENGTH),
    );
    const categories = await this.readCategories();
    const existing = categories.find(
      ({ normalizedName }) => normalizedName === knowledgeCategoryKey(name),
    );
    if (existing) return existing;
    const saved = await this.pb.collection(KNOWLEDGE_CATEGORIES_COLLECTION).create(
      {
        name,
        normalizedName: knowledgeCategoryKey(name),
        sortOrder: (categories.length + 1) * 100,
        systemKey: '',
        revision: 1,
      },
      { requestKey: null },
    );
    const category = normalizeKnowledgeCategoryRecord(saved);
    if (!category) throw new Error('Knowledge category creation was invalid.');
    return category;
  }

  private assertUniqueCategoryName(
    categories: KnowledgeCategoryRecord[],
    name: string,
    excludingId?: string,
  ): void {
    const key = knowledgeCategoryKey(name);
    if (
      categories.some((category) => category.id !== excludingId && category.normalizedName === key)
    ) {
      throw new Error('A Knowledge category with this name already exists.');
    }
  }

  private assertCategoryRevision(
    category: KnowledgeCategoryRecord,
    expectedRevision: number,
  ): void {
    if (category.revision !== expectedRevision) {
      throw new ManagedKnowledgeConflictError(category.revision);
    }
  }

  private async readDocuments(): Promise<KnowledgeDocumentRecord[]> {
    const records = await this.pb
      .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
      .getFullList({ requestKey: null });
    return records
      .map(normalizeKnowledgeDocumentRecord)
      .filter((record): record is KnowledgeDocumentRecord => record !== null)
      .toSorted(compareKnowledgeDocuments);
  }

  private page(
    documents: KnowledgeDocumentRecord[],
    cursor: string | null,
    pageSize: number,
  ): KnowledgePage<KnowledgeManagementDocumentView> {
    const start = cursor ? Math.max(0, documents.findIndex(({ id }) => id === cursor) + 1) : 0;
    const items = documents.slice(start, start + pageSize).map(documentView);
    return {
      items,
      nextCursor: start + pageSize < documents.length ? (items.at(-1)?.id ?? null) : null,
    };
  }

  private async readyUpload(uploadId: string, actor: Actor): Promise<UploadRecord> {
    const upload = await this.pb
      .collection(KNOWLEDGE_UPLOADS_COLLECTION)
      .getOne<UploadRecord>(uploadId, { requestKey: null });
    if (
      upload.state !== 'ready' ||
      upload.accountId !== actor.accountId ||
      Date.parse(upload.expiresAt) <= this.now()
    ) {
      throw new Error('Knowledge upload is not ready.');
    }
    return upload;
  }

  private async readAndVerifyUpload(upload: UploadRecord): Promise<Uint8Array> {
    const bytes = await this.readUploadPdf(upload);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    if (
      bytes.byteLength !== upload.byteSize ||
      checksum !== upload.checksum ||
      Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-'
    ) {
      throw new Error('Knowledge upload failed final validation.');
    }
    return bytes;
  }

  private async readAndVerifyCover(upload: UploadRecord): Promise<Uint8Array> {
    const bytes = await this.readUploadCover(upload);
    const signature = [0x89, 0x50, 0x4e, 0x47];
    if (
      bytes.byteLength < signature.length ||
      bytes.byteLength > KNOWLEDGE_MAX_COVER_BYTES ||
      signature.some((value, index) => bytes[index] !== value)
    ) {
      throw new Error('Knowledge upload cover failed final validation.');
    }
    return bytes;
  }

  private documentForm(
    upload: UploadRecord,
    bytes: Uint8Array,
    coverBytes: Uint8Array,
    metadata: {
      sourceKey?: string;
      category: string;
      categoryId: string | null;
      documentType: KnowledgeDocumentType;
      title: string;
      displayTitle?: string;
      fileName: string;
      contentUpdatedAt?: string;
      publishedAt: string;
      actor: Actor;
      revision: number;
    },
  ): FormData {
    const form = new FormData();
    const contentUpdatedAt = metadata.contentUpdatedAt ?? metadata.publishedAt;
    const values = {
      sourceKey: metadata.sourceKey ?? sourceKey(metadata.category, metadata.fileName),
      category: metadata.category,
      categoryId: metadata.categoryId,
      documentType: metadata.documentType,
      title: metadata.title,
      displayTitle: metadata.displayTitle ?? metadata.title,
      fileName: metadata.fileName,
      checksum: upload.checksum,
      byteSize: upload.byteSize,
      pageCount: upload.pageCount,
      outline: JSON.stringify(upload.outline),
      outlineSource: upload.outlineSource,
      sourceModifiedAt: contentUpdatedAt,
      indexedAt: contentUpdatedAt,
      searchIndexState: 'pending',
      searchIndexChecksum: '',
      searchIndexVersion: 0,
      searchIndexedAt: '',
      searchIndexError: '',
      lifecycleState: 'active',
      revision: metadata.revision,
      publishedByAccountId: metadata.actor.accountId,
      publishedByOperatorId: '',
      publishedByName: metadata.actor.displayName,
      publishedAt: metadata.publishedAt,
      trashedByAccountId: '',
      trashedByOperatorId: '',
      trashedByName: '',
      trashedAt: '',
    };
    for (const [key, value] of Object.entries(values)) form.set(key, String(value ?? ''));
    const copy = bytes.slice();
    form.set(
      'pdf',
      new Blob([copy.buffer as ArrayBuffer], { type: 'application/pdf' }),
      metadata.fileName,
    );
    const coverCopy = coverBytes.slice();
    form.set(
      'cover',
      new Blob([coverCopy.buffer as ArrayBuffer], { type: 'image/png' }),
      `${upload.checksum}.png`,
    );
    return form;
  }

  private documentFromSaved(
    saved: Record<string, unknown>,
    upload: UploadRecord,
    metadata: {
      sourceKey?: string;
      category: string;
      categoryId: string | null;
      documentType: KnowledgeDocumentType;
      title: string;
      displayTitle?: string;
      fileName: string;
      contentUpdatedAt?: string;
      publishedAt: string;
      actor: Actor;
      revision: number;
    },
    existing?: KnowledgeDocumentRecord,
  ): KnowledgeDocumentRecord {
    const contentUpdatedAt = metadata.contentUpdatedAt ?? metadata.publishedAt;
    return {
      id: knowledgeDocumentId(saved.id),
      sourceKey: metadata.sourceKey ?? sourceKey(metadata.category, metadata.fileName),
      category: metadata.category,
      categoryId: metadata.categoryId,
      documentType: metadata.documentType,
      title: metadata.title,
      displayTitle: metadata.displayTitle ?? metadata.title,
      fileName: metadata.fileName,
      pdf: firstNonEmptyString(saved.pdf, metadata.fileName),
      cover: firstNonEmptyString(saved.cover, upload.cover) || null,
      checksum: upload.checksum,
      byteSize: upload.byteSize,
      pageCount: upload.pageCount ?? 1,
      outline: upload.outline,
      outlineSource: upload.outlineSource ?? 'none',
      sourceModifiedAt: contentUpdatedAt,
      indexedAt: contentUpdatedAt,
      searchIndexState: 'pending',
      searchIndexChecksum: null,
      searchIndexVersion: 0,
      searchIndexedAt: null,
      searchIndexError: null,
      lifecycleState: 'active',
      revision: metadata.revision,
      publishedByAccountId: metadata.actor.accountId,
      publishedByName: metadata.actor.displayName,
      publishedAt: metadata.publishedAt,
      trashedByAccountId: null,
      trashedByName: null,
      trashedAt: null,
      created: canonicalTimestamp(
        firstNonEmptyString(saved.created, existing?.created, metadata.publishedAt),
      ),
      updated: canonicalTimestamp(firstNonEmptyString(saved.updated, metadata.publishedAt)),
    };
  }

  private async getDocument(id: string): Promise<KnowledgeDocumentRecord> {
    const record = await this.pb
      .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
      .getOne(id, { requestKey: null });
    const document = normalizeKnowledgeDocumentRecord(record);
    if (!document) throw new Error('Knowledge document is unavailable.');
    return document;
  }

  private assertRevision(document: KnowledgeDocumentRecord, expectedRevision: number): void {
    if (document.revision !== expectedRevision) {
      throw new ManagedKnowledgeConflictError(document.revision);
    }
  }

  private async assertUniqueFilename(fileName: string, excludingId?: string): Promise<void> {
    const records = await this.pb
      .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
      .getFullList<{ id: string; lifecycleState: string }>({
        filter: `fileName="${escapeFilter(fileName)}"`,
        requestKey: null,
      });
    if (
      records.some(({ id, lifecycleState }) => id !== excludingId && lifecycleState !== 'trashed')
    ) {
      throw new ManagedKnowledgeFilenameConflictError();
    }
  }

  private async patchDocument(
    input: { actor: Actor; requestId: string; documentId: string; expectedRevision: number },
    action: KnowledgeAuditAction,
    patch: Record<string, unknown>,
  ): Promise<KnowledgeManagementDocumentView> {
    const current = await this.getDocument(input.documentId);
    return this.patchKnownDocument(input, current, action, patch);
  }

  private async patchKnownDocument(
    input: { actor: Actor; requestId: string; documentId: string; expectedRevision: number },
    current: KnowledgeDocumentRecord,
    action: KnowledgeAuditAction,
    patch: Record<string, unknown>,
    writeAudit = true,
  ): Promise<KnowledgeManagementDocumentView> {
    this.assertRevision(current, input.expectedRevision);
    const updated = await this.pb
      .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
      .update(current.id, { ...patch, revision: current.revision + 1 }, { requestKey: null });
    const document = normalizeKnowledgeDocumentRecord({ ...current, ...patch, ...updated });
    if (!document) throw new Error('Knowledge document update was invalid.');
    if (writeAudit) await this.audit(input.requestId, action, document, input.actor);
    return documentView(document);
  }

  private completeUpload(upload: UploadRecord): Promise<unknown> {
    return this.pb.collection(KNOWLEDGE_UPLOADS_COLLECTION).update(
      upload.id,
      {
        state: 'published',
        pdf: null,
        cover: null,
        revision: upload.revision + 1,
      },
      { requestKey: null },
    );
  }

  private async audit(
    requestId: string,
    action: KnowledgeAuditAction,
    document: KnowledgeDocumentRecord | null,
    actor: Actor,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.pb
      .collection(KNOWLEDGE_AUDIT_EVENTS_COLLECTION)
      .create(this.auditRecord(requestId, action, document, actor, details), { requestKey: null });
  }

  private auditRecord(
    requestId: string,
    action: KnowledgeAuditAction,
    document: KnowledgeDocumentRecord | null,
    actor: Actor,
    details: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      requestId,
      action,
      targetId: document?.id ?? '',
      fileName: document?.fileName ?? '',
      title: document?.displayTitle ?? '',
      category: document?.category ?? '',
      accountId: actor.accountId,
      actorDisplayName: actor.displayName,
      operatorId: '',
      operatorName: '',
      occurredAt: this.timestamp(),
      details,
    };
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }
}
