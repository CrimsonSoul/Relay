import { createHash } from 'node:crypto';
import type PocketBase from 'pocketbase';
import {
  KNOWLEDGE_AUDIT_EVENTS_COLLECTION,
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_LIBRARY_STATE_COLLECTION,
  KNOWLEDGE_MAX_CATEGORY_LENGTH,
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_UPLOADS_COLLECTION,
  compareKnowledgeDocuments,
  normalizeKnowledgeDocumentRecord,
  normalizeKnowledgeSearchText,
  type KnowledgeAuditAction,
  type KnowledgeAuditEventView,
  type KnowledgeDocumentRecord,
  type KnowledgeLibraryMode,
  type KnowledgeManagementDocumentView,
  type KnowledgeManagementSnapshot,
  type KnowledgeManagementUploadView,
  type KnowledgePage,
  type KnowledgeUploadView,
} from '@shared/knowledge';

type Actor = { operatorId: string; operatorName: string; accountId: string };
type UploadRecord = KnowledgeUploadView & { pdf: string; accountId: string; operatorId: string };
type StoredUploadRecord = Partial<KnowledgeUploadView> & {
  id: string;
  requestId: string;
  fileName: string;
  checksum: string;
  byteSize: number;
  state: KnowledgeUploadView['state'];
  expiresAt: string;
  revision: number;
};

type ManagedKnowledgeServiceOptions = {
  pb: PocketBase;
  now?: () => number;
  readUploadPdf?: (record: UploadRecord) => Promise<Uint8Array>;
  fetch?: typeof globalThis.fetch;
};

export class ManagedKnowledgeConflictError extends Error {
  constructor(readonly currentRevision: number) {
    super('The Knowledge document changed. Refresh and try again.');
    this.name = 'ManagedKnowledgeConflictError';
  }
}

function escapeFilter(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function normalizedText(value: string, max: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > max) throw new Error('Knowledge metadata is invalid.');
  return normalized;
}

function sourceKey(category: string, fileName: string): string {
  return `${category}/${fileName}`;
}

function documentView(document: KnowledgeDocumentRecord): KnowledgeManagementDocumentView {
  return {
    id: document.id,
    category: document.category,
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
    updated: document.updated,
  };
}

function uploadView(upload: StoredUploadRecord): KnowledgeManagementUploadView {
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
    pageCount: Number.isInteger(upload.pageCount) ? (upload.pageCount ?? null) : null,
    outlineSource: upload.outlineSource || null,
    outlineCount: Array.isArray(upload.outline) ? upload.outline.length : 0,
    duplicateDocumentId: upload.duplicateDocumentId || null,
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
    operatorId: event.operatorId,
    operatorName: event.operatorName,
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
  }

  async snapshot(input: {
    accountId: string;
    query: string;
    cursor: string | null;
    pageSize: number;
  }): Promise<KnowledgeManagementSnapshot> {
    const pageSize = Math.min(input.pageSize, 25);
    const [mode, documents, uploads] = await Promise.all([
      this.readMode(),
      this.readDocuments(),
      this.pb.collection(KNOWLEDGE_UPLOADS_COLLECTION).getFullList<StoredUploadRecord>({
        filter: `accountId="${escapeFilter(input.accountId)}"`,
        requestKey: null,
      }),
    ]);
    const query = normalizeKnowledgeSearchText(input.query);
    const matches = documents.filter((document) => {
      const text = normalizeKnowledgeSearchText(
        `${document.displayTitle} ${document.fileName} ${document.category}`,
      );
      return !query || query.split(' ').every((term) => text.includes(term));
    });
    const sortedUploads = uploads.toSorted((left, right) =>
      right.expiresAt.localeCompare(left.expiresAt),
    );
    const uploadStart = input.cursor
      ? Math.max(0, sortedUploads.findIndex(({ id }) => id === input.cursor) + 1)
      : 0;
    const uploadItems = sortedUploads.slice(uploadStart, uploadStart + pageSize);
    return {
      mode,
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
        items: uploadItems.map(uploadView),
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
  }): Promise<KnowledgeManagementDocumentView> {
    const upload = await this.readyUpload(input.uploadId, input.actor);
    await this.assertUniqueFilename(upload.fileName);
    const title = normalizedText(input.title, 240);
    const category = normalizedText(input.category, KNOWLEDGE_MAX_CATEGORY_LENGTH);
    const bytes = await this.readAndVerifyUpload(upload);
    const publishedAt = this.timestamp();
    const form = this.documentForm(upload, bytes, {
      category,
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
      category,
      title,
      fileName: upload.fileName,
      publishedAt,
      actor: input.actor,
      revision: 1,
    });
    await this.completeUpload(upload.id);
    await this.audit(input.requestId, 'published', document, input.actor);
    return documentView(document);
  }

  async replace(input: {
    actor: Actor;
    requestId: string;
    uploadId: string;
    documentId: string;
    expectedRevision: number;
    title: string;
    category: string;
  }): Promise<KnowledgeManagementDocumentView> {
    const [upload, current] = await Promise.all([
      this.readyUpload(input.uploadId, input.actor),
      this.getDocument(input.documentId),
    ]);
    this.assertRevision(current, input.expectedRevision);
    const title = normalizedText(input.title, 240);
    const category = normalizedText(input.category, KNOWLEDGE_MAX_CATEGORY_LENGTH);
    const bytes = await this.readAndVerifyUpload(upload);
    const publishedAt = this.timestamp();
    const metadata = {
      category,
      title,
      fileName: current.fileName,
      publishedAt,
      actor: input.actor,
      revision: current.revision + 1,
    };
    const saved = await this.pb
      .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
      .update(current.id, this.documentForm(upload, bytes, metadata), { requestKey: null });
    const document = this.documentFromSaved(saved, upload, metadata, current);
    await this.completeUpload(upload.id);
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

  async trash(input: {
    actor: Actor;
    requestId: string;
    documentId: string;
    expectedRevision: number;
  }): Promise<KnowledgeManagementDocumentView> {
    return this.patchDocument(input, 'trashed', {
      lifecycleState: 'trashed',
      trashedByOperatorId: input.actor.operatorId,
      trashedByName: input.actor.operatorName,
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
    await this.audit(input.requestId, 'deleted', current, input.actor);
    await this.pb.collection(KNOWLEDGE_DOCUMENTS_COLLECTION).delete(current.id, {
      requestKey: null,
    });
    return { id: current.id, deleted: true };
  }

  async readAudit(input: {
    cursor: string | null;
    pageSize: number;
    targetId: string | null;
  }): Promise<KnowledgePage<KnowledgeAuditEventView>> {
    const events = await this.pb
      .collection(KNOWLEDGE_AUDIT_EVENTS_COLLECTION)
      .getFullList<KnowledgeAuditEventView>({ requestKey: null, sort: '-occurredAt' });
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
      upload.operatorId !== actor.operatorId ||
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

  private documentForm(
    upload: UploadRecord,
    bytes: Uint8Array,
    metadata: {
      category: string;
      title: string;
      fileName: string;
      publishedAt: string;
      actor: Actor;
      revision: number;
    },
  ): FormData {
    const form = new FormData();
    const values = {
      sourceKey: sourceKey(metadata.category, metadata.fileName),
      category: metadata.category,
      title: metadata.title,
      displayTitle: metadata.title,
      fileName: metadata.fileName,
      checksum: upload.checksum,
      byteSize: upload.byteSize,
      pageCount: upload.pageCount,
      outline: JSON.stringify(upload.outline),
      outlineSource: upload.outlineSource,
      sourceModifiedAt: metadata.publishedAt,
      indexedAt: metadata.publishedAt,
      lifecycleState: 'active',
      revision: metadata.revision,
      publishedByOperatorId: metadata.actor.operatorId,
      publishedByName: metadata.actor.operatorName,
      publishedAt: metadata.publishedAt,
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
    return form;
  }

  private documentFromSaved(
    saved: Record<string, unknown>,
    upload: UploadRecord,
    metadata: {
      category: string;
      title: string;
      fileName: string;
      publishedAt: string;
      actor: Actor;
      revision: number;
    },
    existing?: KnowledgeDocumentRecord,
  ): KnowledgeDocumentRecord {
    return {
      id: String(saved.id),
      sourceKey: sourceKey(metadata.category, metadata.fileName),
      category: metadata.category,
      title: metadata.title,
      displayTitle: metadata.title,
      fileName: metadata.fileName,
      pdf: String(saved.pdf || metadata.fileName),
      checksum: upload.checksum,
      byteSize: upload.byteSize,
      pageCount: upload.pageCount ?? 1,
      outline: upload.outline,
      outlineSource: upload.outlineSource ?? 'none',
      sourceModifiedAt: metadata.publishedAt,
      indexedAt: metadata.publishedAt,
      lifecycleState: 'active',
      revision: metadata.revision,
      publishedByOperatorId: metadata.actor.operatorId,
      publishedByName: metadata.actor.operatorName,
      publishedAt: metadata.publishedAt,
      trashedByOperatorId: null,
      trashedByName: null,
      trashedAt: null,
      created: canonicalTimestamp(
        String(saved.created || existing?.created || metadata.publishedAt),
      ),
      updated: canonicalTimestamp(String(saved.updated || metadata.publishedAt)),
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
      throw new Error('A document with this PDF filename already exists.');
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

  private completeUpload(id: string): Promise<unknown> {
    return this.pb
      .collection(KNOWLEDGE_UPLOADS_COLLECTION)
      .update(id, { state: 'published', pdf: null }, { requestKey: null });
  }

  private async audit(
    requestId: string,
    action: KnowledgeAuditAction,
    document: KnowledgeDocumentRecord | null,
    actor: Actor,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.pb.collection(KNOWLEDGE_AUDIT_EVENTS_COLLECTION).create(
      {
        requestId,
        action,
        targetId: document?.id ?? '',
        fileName: document?.fileName ?? '',
        title: document?.displayTitle ?? '',
        category: document?.category ?? '',
        operatorId: actor.operatorId,
        operatorName: actor.operatorName,
        occurredAt: this.timestamp(),
        details,
      },
      { requestKey: null },
    );
  }

  private timestamp(): string {
    return new Date(this.now()).toISOString();
  }
}
