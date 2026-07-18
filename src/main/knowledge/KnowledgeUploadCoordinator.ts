import { createHash } from 'node:crypto';
import {
  KNOWLEDGE_MAX_PDF_BYTES,
  KNOWLEDGE_MAX_COVER_BYTES,
  KNOWLEDGE_MAX_PAGES,
  KNOWLEDGE_UPLOAD_CHUNK_BYTES,
  KNOWLEDGE_UPLOAD_RETENTION_MS,
  type KnowledgeManagementErrorCode,
  type KnowledgeOutlineNode,
  type KnowledgeOutlineSource,
  type KnowledgeUploadBatchState,
  type KnowledgeUploadBatchStatusView,
  type KnowledgeUploadBatchView,
  type KnowledgeUploadManifestView,
} from '@shared/knowledge';
import { getPrivilegedCapabilities, type PrivilegedRole } from '@shared/privilegedAccess';
import type { KnowledgeExtractionResult } from './knowledgeExtractor';

export type KnowledgeUploadActor = {
  accountId: string;
  deviceId: string;
  displayName: string;
  role: PrivilegedRole;
};

export type KnowledgeUploadBatchRecord = {
  id: string;
  requestId: string;
  accountId: string;
  deviceId: string;
  actorDisplayName: string;
  operatorId?: string;
  operatorName?: string;
  fileCount: number;
  totalBytes: number;
  state: KnowledgeUploadBatchState;
  createdAt: string;
  lastActivityAt: string;
  expiresAt: string;
  revision: number;
};

export type KnowledgeUploadManifestRecord = {
  id: string;
  requestId: string;
  batchId: string;
  accountId: string;
  deviceId: string;
  actorDisplayName: string;
  operatorId?: string;
  operatorName?: string;
  fileName: string;
  byteSize: number;
  checksum: string;
  chunkSize: number;
  chunkCount: number;
  state: KnowledgeUploadManifestView['state'];
  pdf: string | null;
  cover: string | null;
  pageCount: number | null;
  outline: KnowledgeOutlineNode[];
  outlineSource: KnowledgeOutlineSource | null;
  proposedTitle: string;
  proposedCategory: string;
  duplicateDocumentId: string | null;
  safeError: KnowledgeManagementErrorCode | null;
  lastActivityAt: string;
  readyAt: string | null;
  expiresAt: string;
  revision: number;
};

export type KnowledgeUploadChunkRecord = {
  id: string;
  uploadId: string;
  batchId: string;
  accountId: string;
  deviceId: string;
  index: number;
  byteSize: number;
  checksum: string;
  fileName: string;
  data?: Uint8Array;
};

export type KnowledgeUploadRepository = {
  findBatchByRequest(
    accountId: string,
    requestId: string,
  ): Promise<KnowledgeUploadBatchRecord | null>;
  findUploadByRequest(
    accountId: string,
    requestId: string,
  ): Promise<KnowledgeUploadManifestRecord | null>;
  createBatch(record: Omit<KnowledgeUploadBatchRecord, 'id'>): Promise<KnowledgeUploadBatchRecord>;
  getBatch(id: string): Promise<KnowledgeUploadBatchRecord | null>;
  updateBatch(
    id: string,
    patch: Partial<KnowledgeUploadBatchRecord>,
  ): Promise<KnowledgeUploadBatchRecord>;
  createUpload(
    record: Omit<KnowledgeUploadManifestRecord, 'id'>,
  ): Promise<KnowledgeUploadManifestRecord>;
  getUpload(id: string): Promise<KnowledgeUploadManifestRecord | null>;
  updateUpload(
    id: string,
    patch: Partial<KnowledgeUploadManifestRecord>,
  ): Promise<KnowledgeUploadManifestRecord>;
  listUploads(batchId: string): Promise<KnowledgeUploadManifestRecord[]>;
  listRecoverableUploads(): Promise<KnowledgeUploadManifestRecord[]>;
  listChunks(uploadId: string): Promise<KnowledgeUploadChunkRecord[]>;
  readChunk(chunk: KnowledgeUploadChunkRecord): Promise<Uint8Array>;
  deleteChunks(uploadId: string): Promise<void>;
  storeStagedPdf(
    upload: KnowledgeUploadManifestRecord,
    bytes: Uint8Array,
  ): Promise<KnowledgeUploadManifestRecord>;
  readStagedPdf(upload: KnowledgeUploadManifestRecord): Promise<Uint8Array>;
  storeStagedCover(
    upload: KnowledgeUploadManifestRecord,
    bytes: Uint8Array,
  ): Promise<KnowledgeUploadManifestRecord>;
  readStagedCover(upload: KnowledgeUploadManifestRecord): Promise<Uint8Array>;
  clearStagedPdf(uploadId: string): Promise<void>;
  findDuplicateDocumentId(fileName: string): Promise<string | null>;
};

type KnowledgeUploadCapacityPort = {
  assertBatch(input: { accountId: string; fileCount: number; totalBytes: number }): Promise<void>;
};

type KnowledgeUploadExtractorPort = {
  extract(data: Uint8Array): Promise<KnowledgeExtractionResult>;
  stop(): Promise<void>;
};

type KnowledgeUploadCoordinatorOptions = {
  repository: KnowledgeUploadRepository;
  capacity: KnowledgeUploadCapacityPort;
  extractor: KnowledgeUploadExtractorPort;
  now?: () => number;
};

export type KnowledgeUploadCoordinatorErrorCode =
  | 'unauthorized'
  | 'invalid-request'
  | 'conflict'
  | 'not-found'
  | 'unavailable';

export class KnowledgeUploadCoordinatorError extends Error {
  constructor(
    readonly code: KnowledgeUploadCoordinatorErrorCode,
    readonly currentRevision?: number,
  ) {
    super(
      code === 'conflict' ? 'Refresh upload status and try again.' : 'Upload request rejected.',
    );
    this.name = 'KnowledgeUploadCoordinatorError';
  }
}

export type BeginKnowledgeUploadBatchInput = {
  requestId: string;
  fileCount: number;
  totalBytes: number;
};

export type BeginKnowledgeUploadFileInput = {
  requestId: string;
  batchId: string;
  fileName: string;
  byteSize: number;
  checksum: string;
  chunkCount: number;
};

export type FinalizeKnowledgeUploadInput = { uploadId: string; expectedRevision: number };
export type CancelKnowledgeUploadBatchInput = { batchId: string; expectedRevision: number };

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function batchView(record: KnowledgeUploadBatchRecord): KnowledgeUploadBatchView {
  return {
    id: record.id,
    requestId: record.requestId,
    fileCount: record.fileCount,
    totalBytes: record.totalBytes,
    state: record.state,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
    expiresAt: record.expiresAt,
    revision: record.revision,
  };
}

function manifestView(
  record: KnowledgeUploadManifestRecord,
  missingChunkIndexes: number[],
): KnowledgeUploadManifestView {
  return {
    id: record.id,
    batchId: record.batchId,
    fileName: record.fileName,
    byteSize: record.byteSize,
    checksum: record.checksum,
    chunkSize: record.chunkSize,
    chunkCount: record.chunkCount,
    missingChunkIndexes,
    state: record.state,
    proposedTitle: record.proposedTitle,
    proposedCategory: record.proposedCategory,
    pageCount: record.pageCount,
    outline: record.outline,
    outlineSource: record.outlineSource,
    duplicateDocumentId: record.duplicateDocumentId,
    safeError: record.safeError,
    lastActivityAt: record.lastActivityAt,
    readyAt: record.readyAt,
    expiresAt: record.expiresAt,
    revision: record.revision,
  };
}

function sameBatchDeclaration(
  record: KnowledgeUploadBatchRecord,
  input: BeginKnowledgeUploadBatchInput,
): boolean {
  return record.fileCount === input.fileCount && record.totalBytes === input.totalBytes;
}

function sameFileDeclaration(
  record: KnowledgeUploadManifestRecord,
  input: BeginKnowledgeUploadFileInput,
): boolean {
  return (
    record.batchId === input.batchId &&
    record.fileName === input.fileName &&
    record.byteSize === input.byteSize &&
    record.checksum === input.checksum &&
    record.chunkCount === input.chunkCount
  );
}

function safeProcessingError(error: unknown): KnowledgeManagementErrorCode {
  if (error instanceof KnowledgeUploadProcessingError) return error.code;
  const message = error instanceof Error ? error.message : '';
  if (message === 'encrypted-pdf') return 'encrypted-pdf';
  if (message === 'page-limit') return 'too-many-pages';
  if (message === 'extraction-timeout') return 'extraction-timeout';
  return 'validation-failed';
}

class KnowledgeUploadProcessingError extends Error {
  constructor(readonly code: KnowledgeManagementErrorCode) {
    super(code);
    this.name = 'KnowledgeUploadProcessingError';
  }
}

export class KnowledgeUploadCoordinator {
  private readonly repository: KnowledgeUploadRepository;
  private readonly capacity: KnowledgeUploadCapacityPort;
  private readonly extractor: KnowledgeUploadExtractorPort;
  private readonly now: () => number;
  private readonly queued = new Set<string>();
  private readonly pending: string[] = [];
  private worker: Promise<void> | null = null;
  private accepting = true;
  private disposed = false;

  constructor(options: KnowledgeUploadCoordinatorOptions) {
    this.repository = options.repository;
    this.capacity = options.capacity;
    this.extractor = options.extractor;
    this.now = options.now ?? Date.now;
  }

  async start(): Promise<void> {
    this.assertAvailable();
    const recoverable = await this.repository.listRecoverableUploads();
    for (const upload of recoverable) this.enqueue(upload.id);
  }

  async beginBatch(
    actor: KnowledgeUploadActor,
    input: BeginKnowledgeUploadBatchInput,
  ): Promise<KnowledgeUploadBatchView> {
    this.assertAvailable();
    const existing = await this.repository.findBatchByRequest(actor.accountId, input.requestId);
    if (existing) {
      if (!sameBatchDeclaration(existing, input)) this.conflict(existing.revision);
      return batchView(existing);
    }
    await this.capacity.assertBatch({ accountId: actor.accountId, ...input });
    const now = isoDate(this.now());
    const created = await this.repository.createBatch({
      ...input,
      accountId: actor.accountId,
      deviceId: actor.deviceId,
      actorDisplayName: actor.displayName,
      operatorId: '',
      operatorName: '',
      state: 'active',
      createdAt: now,
      lastActivityAt: now,
      expiresAt: isoDate(this.now() + KNOWLEDGE_UPLOAD_RETENTION_MS),
      revision: 0,
    });
    return batchView(created);
  }

  async beginFile(
    actor: KnowledgeUploadActor,
    input: BeginKnowledgeUploadFileInput,
  ): Promise<KnowledgeUploadManifestView> {
    this.assertAvailable();
    const existing = await this.repository.findUploadByRequest(actor.accountId, input.requestId);
    if (existing) {
      if (!sameFileDeclaration(existing, input)) this.conflict(existing.revision);
      return this.viewUpload(existing);
    }
    const batch = await this.requireBatch(input.batchId);
    this.authorize(batch, actor, false);
    if (batch.state !== 'active') this.conflict(batch.revision);
    this.validateFileDeclaration(input);
    const uploads = await this.repository.listUploads(batch.id);
    const declaredBytes = uploads.reduce((total, upload) => total + upload.byteSize, 0);
    if (uploads.length >= batch.fileCount || declaredBytes + input.byteSize > batch.totalBytes) {
      throw new KnowledgeUploadCoordinatorError('invalid-request');
    }
    const now = isoDate(this.now());
    const created = await this.repository.createUpload({
      ...input,
      accountId: actor.accountId,
      deviceId: actor.deviceId,
      actorDisplayName: actor.displayName,
      operatorId: '',
      operatorName: '',
      chunkSize: KNOWLEDGE_UPLOAD_CHUNK_BYTES,
      state: 'uploading',
      pdf: null,
      cover: null,
      pageCount: null,
      outline: [],
      outlineSource: null,
      proposedTitle: '',
      proposedCategory: '',
      duplicateDocumentId: null,
      safeError: null,
      lastActivityAt: now,
      readyAt: null,
      expiresAt: batch.expiresAt,
      revision: 0,
    });
    await this.touchBatch(batch);
    return manifestView(
      created,
      Array.from({ length: created.chunkCount }, (_, index) => index),
    );
  }

  async status(
    actor: KnowledgeUploadActor,
    batchId: string,
  ): Promise<KnowledgeUploadBatchStatusView> {
    this.assertAvailable();
    const batch = await this.requireBatch(batchId);
    this.authorize(batch, actor, true);
    const uploads = await this.repository.listUploads(batch.id);
    return {
      batch: batchView(batch),
      uploads: await Promise.all(uploads.map((upload) => this.viewUpload(upload))),
    };
  }

  async finalize(
    actor: KnowledgeUploadActor,
    input: FinalizeKnowledgeUploadInput,
  ): Promise<KnowledgeUploadManifestView> {
    this.assertAvailable();
    const upload = await this.requireUpload(input.uploadId);
    this.authorize(upload, actor, true);
    if (['assembling', 'extracting'].includes(upload.state)) {
      this.enqueue(upload.id);
      return this.viewUpload(upload);
    }
    if (upload.state === 'ready') return this.viewUpload(upload);
    if (upload.state === 'cancelled') this.conflict(upload.revision);
    if (upload.revision !== input.expectedRevision) this.conflict(upload.revision);
    const view = await this.viewUpload(upload);
    if (view.missingChunkIndexes.length > 0) this.conflict(upload.revision);
    const claimed = await this.repository.updateUpload(upload.id, {
      state: 'assembling',
      safeError: null,
      lastActivityAt: isoDate(this.now()),
      revision: upload.revision + 1,
    });
    this.enqueue(upload.id);
    return manifestView(claimed, []);
  }

  async cancelFile(
    actor: KnowledgeUploadActor,
    input: FinalizeKnowledgeUploadInput,
  ): Promise<void> {
    this.assertAvailable();
    const upload = await this.requireUpload(input.uploadId);
    this.authorize(upload, actor, true);
    if (upload.state !== 'cancelled') {
      if (upload.revision !== input.expectedRevision) this.conflict(upload.revision);
      await this.repository.updateUpload(upload.id, {
        state: 'cancelled',
        lastActivityAt: isoDate(this.now()),
        revision: upload.revision + 1,
      });
    }
    await this.repository.clearStagedPdf(upload.id);
    await this.repository.deleteChunks(upload.id);
  }

  async cancelBatch(
    actor: KnowledgeUploadActor,
    input: CancelKnowledgeUploadBatchInput,
  ): Promise<void> {
    this.assertAvailable();
    const batch = await this.requireBatch(input.batchId);
    this.authorize(batch, actor, true);
    if (batch.state !== 'cancelled') {
      if (batch.revision !== input.expectedRevision) this.conflict(batch.revision);
      await this.repository.updateBatch(batch.id, {
        state: 'cancelled',
        lastActivityAt: isoDate(this.now()),
        revision: batch.revision + 1,
      });
    }
    const uploads = await this.repository.listUploads(batch.id);
    for (const upload of uploads) {
      if (upload.state !== 'cancelled') {
        await this.repository.updateUpload(upload.id, {
          state: 'cancelled',
          lastActivityAt: isoDate(this.now()),
          revision: upload.revision + 1,
        });
      }
      await this.repository.clearStagedPdf(upload.id);
      await this.repository.deleteChunks(upload.id);
    }
  }

  async whenIdle(): Promise<void> {
    while (this.worker) await this.worker;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.accepting = false;
    await this.whenIdle();
    await this.extractor.stop();
    this.disposed = true;
  }

  private validateFileDeclaration(input: BeginKnowledgeUploadFileInput): void {
    if (
      input.byteSize < 1 ||
      input.byteSize > KNOWLEDGE_MAX_PDF_BYTES ||
      input.chunkCount !== Math.ceil(input.byteSize / KNOWLEDGE_UPLOAD_CHUNK_BYTES) ||
      !/^[0-9a-f]{64}$/.test(input.checksum)
    ) {
      throw new KnowledgeUploadCoordinatorError('invalid-request');
    }
  }

  private async viewUpload(
    upload: KnowledgeUploadManifestRecord,
  ): Promise<KnowledgeUploadManifestView> {
    if (!['uploading', 'failed', 'assembling'].includes(upload.state)) {
      return manifestView(upload, []);
    }
    const chunks = await this.repository.listChunks(upload.id);
    const acknowledged = new Map<number, string>();
    for (const chunk of chunks) {
      if (
        chunk.uploadId !== upload.id ||
        chunk.batchId !== upload.batchId ||
        chunk.accountId !== upload.accountId ||
        chunk.deviceId !== upload.deviceId ||
        chunk.index < 0 ||
        chunk.index >= upload.chunkCount
      ) {
        throw new KnowledgeUploadCoordinatorError('unauthorized');
      }
      const prior = acknowledged.get(chunk.index);
      if (prior && prior !== chunk.checksum) this.conflict(upload.revision);
      acknowledged.set(chunk.index, chunk.checksum);
    }
    const missing = Array.from({ length: upload.chunkCount }, (_, index) => index).filter(
      (index) => !acknowledged.has(index),
    );
    return manifestView(upload, missing);
  }

  private enqueue(uploadId: string): void {
    if (this.queued.has(uploadId)) return;
    this.queued.add(uploadId);
    this.pending.push(uploadId);
    if (!this.worker) {
      this.worker = this.runWorker().finally(() => {
        this.worker = null;
        if (this.pending.length > 0) this.enqueuePendingWorker();
      });
    }
  }

  private enqueuePendingWorker(): void {
    if (this.worker || this.pending.length === 0) return;
    this.worker = this.runWorker().finally(() => {
      this.worker = null;
      if (this.pending.length > 0) this.enqueuePendingWorker();
    });
  }

  private async runWorker(): Promise<void> {
    while (this.pending.length > 0) {
      const uploadId = this.pending.shift();
      if (!uploadId) continue;
      try {
        await this.processUpload(uploadId);
      } finally {
        this.queued.delete(uploadId);
      }
    }
  }

  private async processUpload(uploadId: string): Promise<void> {
    let upload = await this.requireUpload(uploadId);
    try {
      let bytes: Uint8Array;
      if (upload.state === 'assembling') {
        bytes = await this.assemble(upload);
        if (await this.wasCancelled(upload.id)) return;
        upload = await this.repository.storeStagedPdf(upload, bytes);
        if (await this.wasCancelled(upload.id)) {
          await this.repository.clearStagedPdf(upload.id);
          return;
        }
        upload = await this.repository.updateUpload(upload.id, {
          state: 'extracting',
          lastActivityAt: isoDate(this.now()),
          revision: upload.revision + 1,
        });
      } else if (upload.state === 'extracting') {
        bytes = await this.repository.readStagedPdf(upload);
        this.validateCompletePdf(upload, bytes);
      } else {
        return;
      }
      const extraction = await this.extractor.extract(bytes);
      if (await this.wasCancelled(upload.id)) return;
      this.validateExtraction(extraction);
      upload = await this.repository.storeStagedCover(upload, extraction.coverPng);
      if (await this.wasCancelled(upload.id)) {
        await this.repository.clearStagedPdf(upload.id);
        return;
      }
      const duplicateDocumentId = await this.repository.findDuplicateDocumentId(upload.fileName);
      const now = isoDate(this.now());
      await this.repository.updateUpload(upload.id, {
        state: 'ready',
        pdf: upload.pdf,
        cover: upload.cover,
        pageCount: extraction.pageCount,
        outline: extraction.outline,
        outlineSource: extraction.outlineSource,
        proposedTitle: extraction.metadataTitle || upload.fileName.replace(/\.pdf$/i, ''),
        proposedCategory: upload.proposedCategory || 'General',
        duplicateDocumentId,
        safeError: null,
        lastActivityAt: now,
        readyAt: now,
        expiresAt: isoDate(this.now() + KNOWLEDGE_UPLOAD_RETENTION_MS),
        revision: upload.revision + 1,
      });
      await this.repository.deleteChunks(upload.id);
      await this.completeBatchIfSettled(upload.batchId);
    } catch (error) {
      const current = await this.repository.getUpload(upload.id);
      if (!current || current.state === 'cancelled') return;
      await this.repository.updateUpload(upload.id, {
        state: 'failed',
        safeError: safeProcessingError(error),
        lastActivityAt: isoDate(this.now()),
        revision: current.revision + 1,
      });
      await this.completeBatchIfSettled(upload.batchId);
    }
  }

  private async assemble(upload: KnowledgeUploadManifestRecord): Promise<Uint8Array> {
    const chunks = (await this.repository.listChunks(upload.id)).toSorted(
      (left, right) => left.index - right.index,
    );
    if (chunks.length !== upload.chunkCount) {
      throw new KnowledgeUploadProcessingError('validation-failed');
    }
    const assembled = new Uint8Array(upload.byteSize);
    let offset = 0;
    for (let expectedIndex = 0; expectedIndex < chunks.length; expectedIndex += 1) {
      const chunk = chunks[expectedIndex]!;
      this.validateChunkBinding(upload, chunk, expectedIndex);
      const bytes = await this.repository.readChunk(chunk);
      const expectedBytes = Math.min(KNOWLEDGE_UPLOAD_CHUNK_BYTES, upload.byteSize - offset);
      if (
        bytes.byteLength !== chunk.byteSize ||
        bytes.byteLength !== expectedBytes ||
        sha256(bytes) !== chunk.checksum
      ) {
        throw new KnowledgeUploadProcessingError('checksum-mismatch');
      }
      assembled.set(bytes, offset);
      offset += bytes.byteLength;
    }
    this.validateCompletePdf(upload, assembled);
    return assembled;
  }

  private validateChunkBinding(
    upload: KnowledgeUploadManifestRecord,
    chunk: KnowledgeUploadChunkRecord,
    expectedIndex: number,
  ): void {
    if (
      chunk.index !== expectedIndex ||
      chunk.uploadId !== upload.id ||
      chunk.batchId !== upload.batchId ||
      chunk.accountId !== upload.accountId ||
      chunk.deviceId !== upload.deviceId
    ) {
      throw new KnowledgeUploadProcessingError('validation-failed');
    }
  }

  private validateCompletePdf(upload: KnowledgeUploadManifestRecord, bytes: Uint8Array): void {
    if (
      bytes.byteLength !== upload.byteSize ||
      bytes.byteLength < 5 ||
      Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-' ||
      sha256(bytes) !== upload.checksum
    ) {
      throw new KnowledgeUploadProcessingError('checksum-mismatch');
    }
  }

  private validateExtraction(extraction: KnowledgeExtractionResult): void {
    if (extraction.pageCount < 1 || extraction.pageCount > KNOWLEDGE_MAX_PAGES) {
      throw new KnowledgeUploadProcessingError('too-many-pages');
    }
    if (
      extraction.coverPng.byteLength < 1 ||
      extraction.coverPng.byteLength > KNOWLEDGE_MAX_COVER_BYTES
    ) {
      throw new KnowledgeUploadProcessingError('validation-failed');
    }
  }

  private async completeBatchIfSettled(batchId: string): Promise<void> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch || batch.state !== 'active') return;
    const uploads = await this.repository.listUploads(batch.id);
    if (
      uploads.length !== batch.fileCount ||
      uploads.some((upload) =>
        ['queued', 'uploading', 'assembling', 'extracting'].includes(upload.state),
      )
    ) {
      return;
    }
    await this.repository.updateBatch(batch.id, {
      state: 'ready',
      lastActivityAt: isoDate(this.now()),
      revision: batch.revision + 1,
    });
  }

  private async wasCancelled(uploadId: string): Promise<boolean> {
    return (await this.repository.getUpload(uploadId))?.state === 'cancelled';
  }

  private async touchBatch(batch: KnowledgeUploadBatchRecord): Promise<void> {
    await this.repository.updateBatch(batch.id, {
      lastActivityAt: isoDate(this.now()),
      revision: batch.revision + 1,
    });
  }

  private authorize(
    record: Pick<KnowledgeUploadBatchRecord, 'accountId' | 'deviceId'>,
    actor: KnowledgeUploadActor,
    allowAdministratorCrossAccount: boolean,
  ): void {
    const capabilities = getPrivilegedCapabilities({
      active: true,
      assigned: true,
      role: actor.role,
    });
    if (
      allowAdministratorCrossAccount &&
      capabilities.includes('knowledge.manage') &&
      capabilities.includes('settings.manage')
    ) {
      return;
    }
    if (record.accountId !== actor.accountId || record.deviceId !== actor.deviceId) {
      throw new KnowledgeUploadCoordinatorError('unauthorized');
    }
  }

  private async requireBatch(batchId: string): Promise<KnowledgeUploadBatchRecord> {
    const batch = await this.repository.getBatch(batchId);
    if (!batch) throw new KnowledgeUploadCoordinatorError('not-found');
    return batch;
  }

  private async requireUpload(uploadId: string): Promise<KnowledgeUploadManifestRecord> {
    const upload = await this.repository.getUpload(uploadId);
    if (!upload) throw new KnowledgeUploadCoordinatorError('not-found');
    return upload;
  }

  private conflict(revision: number): never {
    throw new KnowledgeUploadCoordinatorError('conflict', revision);
  }

  private assertAvailable(): void {
    if (!this.accepting || this.disposed) throw new KnowledgeUploadCoordinatorError('unavailable');
  }
}
