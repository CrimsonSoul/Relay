import type PocketBase from 'pocketbase';
import {
  KNOWLEDGE_DOCUMENTS_COLLECTION,
  KNOWLEDGE_MAX_COVER_BYTES,
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_UPLOAD_BATCHES_COLLECTION,
  KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION,
  KNOWLEDGE_UPLOAD_CHUNK_BYTES,
  KNOWLEDGE_UPLOADS_COLLECTION,
} from '@shared/knowledge';
import type {
  KnowledgeUploadBatchRecord,
  KnowledgeUploadChunkRecord,
  KnowledgeUploadManifestRecord,
  KnowledgeUploadRepository,
} from './KnowledgeUploadCoordinator';

type PocketBaseKnowledgeUploadRepositoryOptions = {
  pb: PocketBase;
  fetch?: typeof globalThis.fetch;
};

type StoredChunkRecord = Omit<KnowledgeUploadChunkRecord, 'fileName'> & { chunk: string };

function escapeFilterValue(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function batchRecord(value: KnowledgeUploadBatchRecord): KnowledgeUploadBatchRecord {
  return {
    ...value,
    actorDisplayName: value.actorDisplayName || value.operatorName || '',
    fileCount: Number(value.fileCount),
    totalBytes: Number(value.totalBytes),
    revision: Number(value.revision),
  };
}

function uploadRecord(value: KnowledgeUploadManifestRecord): KnowledgeUploadManifestRecord {
  return {
    ...value,
    actorDisplayName: value.actorDisplayName || value.operatorName || '',
    byteSize: Number(value.byteSize),
    chunkSize: Number(value.chunkSize),
    chunkCount: Number(value.chunkCount),
    pdf: value.pdf || null,
    cover: value.cover || null,
    proposedCategoryId: value.proposedCategoryId || null,
    proposedDocumentType: value.proposedDocumentType === 'cheatsheet' ? 'cheatsheet' : 'sop',
    pageCount:
      Number.isInteger(value.pageCount) && Number(value.pageCount) > 0
        ? Number(value.pageCount)
        : null,
    outline: Array.isArray(value.outline) ? value.outline : [],
    outlineSource: value.outlineSource || null,
    replacementDocumentId: value.replacementDocumentId || null,
    duplicateDocumentId: value.duplicateDocumentId || null,
    safeError: value.safeError || null,
    readyAt: value.readyAt || null,
    revision: Number(value.revision),
  };
}

export class PocketBaseKnowledgeUploadRepository implements KnowledgeUploadRepository {
  private readonly pb: PocketBase;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: PocketBaseKnowledgeUploadRepositoryOptions) {
    this.pb = options.pb;
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async findBatchByRequest(
    accountId: string,
    requestId: string,
  ): Promise<KnowledgeUploadBatchRecord | null> {
    const result = await this.pb
      .collection(KNOWLEDGE_UPLOAD_BATCHES_COLLECTION)
      .getList<KnowledgeUploadBatchRecord>(1, 2, {
        filter: `accountId="${escapeFilterValue(accountId)}" && requestId="${escapeFilterValue(requestId)}"`,
        requestKey: null,
      });
    return result.items[0] ? batchRecord(result.items[0]) : null;
  }

  async hasActiveBatch(accountId: string): Promise<boolean> {
    const result = await this.pb
      .collection(KNOWLEDGE_UPLOAD_BATCHES_COLLECTION)
      .getList<KnowledgeUploadBatchRecord>(1, 1, {
        filter: `accountId="${escapeFilterValue(accountId)}" && state="active"`,
        fields: 'id',
        requestKey: null,
      });
    return result.totalItems > 0;
  }

  async findUploadByRequest(
    accountId: string,
    requestId: string,
  ): Promise<KnowledgeUploadManifestRecord | null> {
    const result = await this.pb
      .collection(KNOWLEDGE_UPLOADS_COLLECTION)
      .getList<KnowledgeUploadManifestRecord>(1, 2, {
        filter: `accountId="${escapeFilterValue(accountId)}" && requestId="${escapeFilterValue(requestId)}"`,
        requestKey: null,
      });
    return result.items[0] ? uploadRecord(result.items[0]) : null;
  }

  async createBatch(
    record: Omit<KnowledgeUploadBatchRecord, 'id'>,
  ): Promise<KnowledgeUploadBatchRecord> {
    const created = await this.pb
      .collection(KNOWLEDGE_UPLOAD_BATCHES_COLLECTION)
      .create<KnowledgeUploadBatchRecord>(record, { requestKey: null });
    return batchRecord(created);
  }

  async getBatch(id: string): Promise<KnowledgeUploadBatchRecord | null> {
    try {
      const record = await this.pb
        .collection(KNOWLEDGE_UPLOAD_BATCHES_COLLECTION)
        .getOne<KnowledgeUploadBatchRecord>(id, { requestKey: null });
      return batchRecord(record);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async updateBatch(
    id: string,
    patch: Partial<KnowledgeUploadBatchRecord>,
  ): Promise<KnowledgeUploadBatchRecord> {
    const updated = await this.pb
      .collection(KNOWLEDGE_UPLOAD_BATCHES_COLLECTION)
      .update<KnowledgeUploadBatchRecord>(id, patch, { requestKey: null });
    return batchRecord(updated);
  }

  async createUpload(
    record: Omit<KnowledgeUploadManifestRecord, 'id'>,
  ): Promise<KnowledgeUploadManifestRecord> {
    const created = await this.pb
      .collection(KNOWLEDGE_UPLOADS_COLLECTION)
      .create<KnowledgeUploadManifestRecord>(record, { requestKey: null });
    return uploadRecord(created);
  }

  async getUpload(id: string): Promise<KnowledgeUploadManifestRecord | null> {
    try {
      const record = await this.pb
        .collection(KNOWLEDGE_UPLOADS_COLLECTION)
        .getOne<KnowledgeUploadManifestRecord>(id, { requestKey: null });
      return uploadRecord(record);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async updateUpload(
    id: string,
    patch: Partial<KnowledgeUploadManifestRecord>,
  ): Promise<KnowledgeUploadManifestRecord> {
    const updated = await this.pb
      .collection(KNOWLEDGE_UPLOADS_COLLECTION)
      .update<KnowledgeUploadManifestRecord>(id, patch, { requestKey: null });
    return uploadRecord(updated);
  }

  async listUploads(batchId: string): Promise<KnowledgeUploadManifestRecord[]> {
    const records = await this.pb
      .collection(KNOWLEDGE_UPLOADS_COLLECTION)
      .getFullList<KnowledgeUploadManifestRecord>({
        filter: `batchId="${escapeFilterValue(batchId)}"`,
        sort: 'created,id',
        requestKey: null,
      });
    return records.map(uploadRecord);
  }

  async listRecoverableUploads(): Promise<KnowledgeUploadManifestRecord[]> {
    const records = await this.pb
      .collection(KNOWLEDGE_UPLOADS_COLLECTION)
      .getFullList<KnowledgeUploadManifestRecord>({
        filter: 'state="assembling" || state="extracting"',
        sort: 'updated,id',
        requestKey: null,
      });
    return records.map(uploadRecord);
  }

  async listChunks(uploadId: string): Promise<KnowledgeUploadChunkRecord[]> {
    const records = await this.pb
      .collection(KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION)
      .getFullList<StoredChunkRecord>({
        filter: `uploadId="${escapeFilterValue(uploadId)}"`,
        sort: 'index,id',
        requestKey: null,
      });
    return records.map((record) => ({
      ...record,
      index: Number(record.index),
      byteSize: Number(record.byteSize),
      fileName: record.chunk,
    }));
  }

  readChunk(chunk: KnowledgeUploadChunkRecord): Promise<Uint8Array> {
    return this.downloadProtectedFile(
      KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION,
      chunk,
      chunk.fileName,
      KNOWLEDGE_UPLOAD_CHUNK_BYTES,
    );
  }

  async deleteChunks(uploadId: string): Promise<void> {
    const chunks = await this.listChunks(uploadId);
    for (const chunk of chunks) {
      await this.pb.collection(KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION).delete(chunk.id, {
        requestKey: null,
      });
    }
  }

  async storeStagedPdf(
    upload: KnowledgeUploadManifestRecord,
    bytes: Uint8Array,
  ): Promise<KnowledgeUploadManifestRecord> {
    const form = new FormData();
    const buffer = Uint8Array.from(bytes).buffer;
    form.set('pdf', new Blob([buffer], { type: 'application/pdf' }), upload.fileName);
    const updated = await this.pb
      .collection(KNOWLEDGE_UPLOADS_COLLECTION)
      .update<KnowledgeUploadManifestRecord>(upload.id, form, { requestKey: null });
    return uploadRecord(updated);
  }

  readStagedPdf(upload: KnowledgeUploadManifestRecord): Promise<Uint8Array> {
    if (!upload.pdf) return Promise.reject(new Error('missing-staged-pdf'));
    return this.downloadProtectedFile(
      KNOWLEDGE_UPLOADS_COLLECTION,
      upload,
      upload.pdf,
      KNOWLEDGE_MAX_PDF_BYTES,
    );
  }

  async storeStagedCover(
    upload: KnowledgeUploadManifestRecord,
    bytes: Uint8Array,
  ): Promise<KnowledgeUploadManifestRecord> {
    if (bytes.byteLength < 1 || bytes.byteLength > KNOWLEDGE_MAX_COVER_BYTES) {
      throw new Error('invalid-staged-cover');
    }
    const form = new FormData();
    const buffer = Uint8Array.from(bytes).buffer;
    form.set('cover', new Blob([buffer], { type: 'image/png' }), `${upload.checksum}.png`);
    const updated = await this.pb
      .collection(KNOWLEDGE_UPLOADS_COLLECTION)
      .update<KnowledgeUploadManifestRecord>(upload.id, form, { requestKey: null });
    return uploadRecord(updated);
  }

  readStagedCover(upload: KnowledgeUploadManifestRecord): Promise<Uint8Array> {
    if (!upload.cover) return Promise.reject(new Error('missing-staged-cover'));
    return this.downloadProtectedFile(
      KNOWLEDGE_UPLOADS_COLLECTION,
      upload,
      upload.cover,
      KNOWLEDGE_MAX_COVER_BYTES,
    );
  }

  async clearStagedPdf(uploadId: string): Promise<void> {
    await this.pb
      .collection(KNOWLEDGE_UPLOADS_COLLECTION)
      .update(uploadId, { pdf: null, cover: null }, { requestKey: null });
  }

  async findDuplicateDocumentId(fileName: string): Promise<string | null> {
    const records = await this.pb
      .collection(KNOWLEDGE_DOCUMENTS_COLLECTION)
      .getList<{ id: string }>(1, 1, {
        filter: `fileName="${escapeFilterValue(fileName)}" && lifecycleState="active"`,
        fields: 'id',
        requestKey: null,
      });
    return records.items[0]?.id ?? null;
  }

  private async downloadProtectedFile(
    collection: string,
    record: object,
    fileName: string,
    maxBytes: number,
  ): Promise<Uint8Array> {
    const token = await this.pb.files.getToken({ requestKey: null });
    const url = this.pb.files.getURL(record as never, fileName, { token });
    const response = await this.fetch(url, { redirect: 'error' });
    if (!response.ok) throw new Error(`${collection}-download-failed`);
    const declaredBytes = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new Error(`${collection}-download-too-large`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
      throw new Error(`${collection}-download-size-invalid`);
    }
    return bytes;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status?: unknown }).status === 404
  );
}
