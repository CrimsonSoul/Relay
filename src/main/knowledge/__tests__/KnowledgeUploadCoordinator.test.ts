import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { KNOWLEDGE_UPLOAD_CHUNK_BYTES, type KnowledgeOutlineSource } from '@shared/knowledge';
import {
  KnowledgeUploadCoordinator,
  KnowledgeUploadCoordinatorError,
  type KnowledgeUploadActor,
  type KnowledgeUploadBatchRecord,
  type KnowledgeUploadChunkRecord,
  type KnowledgeUploadManifestRecord,
  type KnowledgeUploadRepository,
} from '../KnowledgeUploadCoordinator';

vi.mock('@shared/knowledge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/knowledge')>();
  return {
    ...actual,
    // Preserve the multi-chunk boundary contract without hashing multi-megabyte fixtures in coverage.
    KNOWLEDGE_UPLOAD_CHUNK_BYTES: 64 * 1024,
  };
});

const NOW = Date.parse('2026-07-15T20:00:00.000Z');
const publisher: KnowledgeUploadActor = {
  accountId: 'account-publisher',
  deviceId: 'device-publisher',
  displayName: 'Tristan Bowles',
  role: 'publisher',
};
const admin: KnowledgeUploadActor = {
  accountId: 'account-admin',
  deviceId: 'server-local',
  displayName: 'Ryan Bledsoe',
  role: 'admin',
};
const owner: KnowledgeUploadActor = {
  ...admin,
  accountId: 'account-owner',
  displayName: 'Ryan Bledsoe',
  role: 'owner',
};

function checksum(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

class MemoryRepository implements KnowledgeUploadRepository {
  batches = new Map<string, KnowledgeUploadBatchRecord>();
  uploads = new Map<string, KnowledgeUploadManifestRecord>();
  chunks = new Map<string, KnowledgeUploadChunkRecord[]>();
  staged = new Map<string, Uint8Array>();
  stagedCovers = new Map<string, Uint8Array>();
  events: string[] = [];
  nextBatch = 1;
  nextUpload = 1;

  async findBatchByRequest(accountId: string, requestId: string) {
    return (
      [...this.batches.values()].find(
        (batch) => batch.accountId === accountId && batch.requestId === requestId,
      ) ?? null
    );
  }

  async findUploadByRequest(accountId: string, requestId: string) {
    return (
      [...this.uploads.values()].find(
        (upload) => upload.accountId === accountId && upload.requestId === requestId,
      ) ?? null
    );
  }

  async createBatch(record: Omit<KnowledgeUploadBatchRecord, 'id'>) {
    const created = { ...record, id: `batch-${this.nextBatch++}` };
    this.batches.set(created.id, created);
    return created;
  }

  async getBatch(id: string) {
    return this.batches.get(id) ?? null;
  }

  async updateBatch(id: string, patch: Partial<KnowledgeUploadBatchRecord>) {
    const current = this.batches.get(id);
    if (!current) throw new Error('missing-batch');
    const updated = { ...current, ...patch };
    this.batches.set(id, updated);
    return updated;
  }

  async createUpload(record: Omit<KnowledgeUploadManifestRecord, 'id'>) {
    const created = { ...record, id: `upload-${this.nextUpload++}` };
    this.uploads.set(created.id, created);
    return created;
  }

  async getUpload(id: string) {
    return this.uploads.get(id) ?? null;
  }

  async updateUpload(id: string, patch: Partial<KnowledgeUploadManifestRecord>) {
    const current = this.uploads.get(id);
    if (!current) throw new Error('missing-upload');
    const updated = { ...current, ...patch };
    this.uploads.set(id, updated);
    this.events.push(`upload:${id}:${String(patch.state ?? 'patched')}`);
    return updated;
  }

  async listUploads(batchId: string) {
    return [...this.uploads.values()].filter((upload) => upload.batchId === batchId);
  }

  async listRecoverableUploads() {
    return [...this.uploads.values()].filter((upload) =>
      ['assembling', 'extracting'].includes(upload.state),
    );
  }

  async listChunks(uploadId: string) {
    return this.chunks.get(uploadId) ?? [];
  }

  async readChunk(chunk: KnowledgeUploadChunkRecord) {
    this.events.push(`read:${chunk.uploadId}:${chunk.index}`);
    return chunk.data!;
  }

  async deleteChunks(uploadId: string) {
    this.events.push(`delete-chunks:${uploadId}`);
    this.chunks.delete(uploadId);
  }

  async storeStagedPdf(upload: KnowledgeUploadManifestRecord, bytes: Uint8Array) {
    this.events.push(`store:${upload.id}`);
    this.staged.set(upload.id, bytes.slice());
    const updated = { ...upload, pdf: `${upload.id}.pdf` };
    this.uploads.set(upload.id, updated);
    return updated;
  }

  async readStagedPdf(upload: KnowledgeUploadManifestRecord) {
    const bytes = this.staged.get(upload.id);
    if (!bytes) throw new Error('missing-staged-pdf');
    return bytes.slice();
  }

  async storeStagedCover(upload: KnowledgeUploadManifestRecord, bytes: Uint8Array) {
    this.events.push(`store-cover:${upload.id}`);
    this.stagedCovers.set(upload.id, bytes.slice());
    const updated = { ...upload, cover: `${upload.id}.png` };
    this.uploads.set(upload.id, updated);
    return updated;
  }

  async readStagedCover(upload: KnowledgeUploadManifestRecord) {
    const bytes = this.stagedCovers.get(upload.id);
    if (!bytes) throw new Error('missing-staged-cover');
    return bytes.slice();
  }

  async clearStagedPdf(uploadId: string) {
    this.events.push(`clear:${uploadId}`);
    this.staged.delete(uploadId);
    this.stagedCovers.delete(uploadId);
  }

  async findDuplicateDocumentId(fileName: string) {
    return fileName === 'Duplicate.pdf' ? 'document-existing' : null;
  }
}

function createCoordinator(repository = new MemoryRepository()) {
  const capacity = { assertBatch: vi.fn(async () => undefined) };
  const extract = vi.fn(async () => ({
    metadataTitle: 'Extracted title',
    pageCount: 2,
    outline: [],
    outlineSource: 'none' as KnowledgeOutlineSource,
    coverPng: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  }));
  const stop = vi.fn(async () => undefined);
  const coordinator = new KnowledgeUploadCoordinator({
    repository,
    capacity,
    extractor: { extract, stop },
    now: () => NOW,
  });
  return { capacity, coordinator, extract, repository, stop };
}

async function beginOneFile(
  coordinator: KnowledgeUploadCoordinator,
  bytes: Uint8Array,
  fileName = 'Runbook.pdf',
) {
  const batch = await coordinator.beginBatch(publisher, {
    requestId: 'batch-request-1',
    fileCount: 1,
    totalBytes: bytes.byteLength,
  });
  const upload = await coordinator.beginFile(publisher, {
    requestId: 'file-request-1',
    batchId: batch.id,
    fileName,
    byteSize: bytes.byteLength,
    checksum: checksum(bytes),
    chunkCount: Math.ceil(bytes.byteLength / KNOWLEDGE_UPLOAD_CHUNK_BYTES),
  });
  return { batch, upload };
}

function stageChunks(
  repository: MemoryRepository,
  uploadId: string,
  batchId: string,
  bytes: Uint8Array,
) {
  const chunks: KnowledgeUploadChunkRecord[] = [];
  for (
    let offset = 0, index = 0;
    offset < bytes.byteLength;
    offset += KNOWLEDGE_UPLOAD_CHUNK_BYTES, index += 1
  ) {
    const data = bytes.slice(
      offset,
      Math.min(offset + KNOWLEDGE_UPLOAD_CHUNK_BYTES, bytes.byteLength),
    );
    chunks.push({
      id: `chunk-${index}`,
      uploadId,
      batchId,
      accountId: publisher.accountId,
      deviceId: publisher.deviceId,
      index,
      byteSize: data.byteLength,
      checksum: checksum(data),
      fileName: `chunk-${index}.bin`,
      data,
    });
  }
  repository.chunks.set(uploadId, chunks);
}

describe('KnowledgeUploadCoordinator', () => {
  it('binds an explicit replacement target without relying on the PDF filename', async () => {
    const { coordinator, repository } = createCoordinator();
    const bytes = Buffer.from('%PDF-test');
    const batch = await coordinator.beginBatch(publisher, {
      requestId: 'replacement-batch',
      fileCount: 1,
      totalBytes: bytes.byteLength,
    });

    const upload = await coordinator.beginFile(publisher, {
      requestId: 'replacement-file',
      batchId: batch.id,
      fileName: 'A Different Filename.pdf',
      byteSize: bytes.byteLength,
      checksum: checksum(bytes),
      chunkCount: 1,
      replacementDocumentId: 'document-target',
    });

    expect(upload.duplicateDocumentId).toBe('document-target');
    expect(repository.uploads.get(upload.id)?.duplicateDocumentId).toBe('document-target');
    expect(repository.uploads.get(upload.id)?.replacementDocumentId).toBe('document-target');
    stageChunks(repository, upload.id, batch.id, bytes);
    await coordinator.finalize(publisher, {
      uploadId: upload.id,
      expectedRevision: upload.revision,
    });
    await coordinator.whenIdle();
    expect(repository.uploads.get(upload.id)).toMatchObject({
      state: 'ready',
      duplicateDocumentId: 'document-target',
      replacementDocumentId: 'document-target',
    });
  });

  it('admits one idempotent account-bound batch and file manifest', async () => {
    const { capacity, coordinator, repository } = createCoordinator();
    const bytes = Buffer.from('%PDF-test');

    const first = await beginOneFile(coordinator, bytes);
    const replay = await coordinator.beginBatch(publisher, {
      requestId: 'batch-request-1',
      fileCount: 1,
      totalBytes: bytes.byteLength,
    });

    expect(replay).toMatchObject({ id: first.batch.id, revision: 1 });
    expect(repository.batches.get(first.batch.id)).toMatchObject({
      accountId: publisher.accountId,
      actorDisplayName: publisher.displayName,
      operatorId: '',
      operatorName: '',
    });
    expect(repository.uploads.get(first.upload.id)).toMatchObject({
      accountId: publisher.accountId,
      actorDisplayName: publisher.displayName,
      operatorId: '',
      operatorName: '',
    });
    expect(capacity.assertBatch).toHaveBeenCalledOnce();
    await expect(
      coordinator.beginFile(
        { ...publisher, deviceId: 'other-device' },
        {
          requestId: 'file-request-2',
          batchId: first.batch.id,
          fileName: 'Other.pdf',
          byteSize: bytes.byteLength,
          checksum: checksum(bytes),
          chunkCount: 1,
        },
      ),
    ).rejects.toBeInstanceOf(KnowledgeUploadCoordinatorError);
  });

  it('reports authoritative missing indexes and enforces publisher/admin account scope', async () => {
    const { coordinator, repository } = createCoordinator();
    const bytes = new Uint8Array(KNOWLEDGE_UPLOAD_CHUNK_BYTES + 10).fill(7);
    bytes.set(Buffer.from('%PDF-'), 0);
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    stageChunks(repository, upload.id, batch.id, bytes);
    repository.chunks.set(upload.id, repository.chunks.get(upload.id)!.slice(0, 1));

    await expect(coordinator.status(publisher, batch.id)).resolves.toMatchObject({
      uploads: [expect.objectContaining({ missingChunkIndexes: [1] })],
    });
    await expect(coordinator.status(admin, batch.id)).resolves.toMatchObject({
      batch: { id: batch.id },
    });
    await expect(
      coordinator.status({ ...publisher, accountId: 'other-account' }, batch.id),
    ).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('lets a publisher discard the same-account upload from another paired device', async () => {
    const { coordinator, repository } = createCoordinator();
    const bytes = Buffer.from('%PDF-test');
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    await repository.updateUpload(upload.id, { state: 'ready' });
    const alternateDevice = { ...publisher, deviceId: 'web-session-device' };

    await expect(coordinator.status(alternateDevice, batch.id)).resolves.toMatchObject({
      batch: { id: batch.id },
    });
    await expect(
      coordinator.cancelFile(alternateDevice, {
        uploadId: upload.id,
        expectedRevision: upload.revision,
      }),
    ).resolves.toBeUndefined();
    expect(repository.uploads.get(upload.id)?.state).toBe('cancelled');
  });

  it('treats the effective Owner as the devices-and-knowledge capability superset cross-account', async () => {
    const { coordinator, repository } = createCoordinator();
    const bytes = Buffer.from('%PDF-test');
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    await repository.updateUpload(upload.id, { state: 'ready' });

    await expect(coordinator.status(owner, batch.id)).resolves.toMatchObject({
      batch: { id: batch.id },
    });
    await expect(
      coordinator.finalize(owner, { uploadId: upload.id, expectedRevision: upload.revision }),
    ).resolves.toMatchObject({ state: 'ready' });
    await coordinator.cancelFile(owner, {
      uploadId: upload.id,
      expectedRevision: upload.revision,
    });
    const currentBatch = repository.batches.get(batch.id)!;
    await coordinator.cancelBatch(owner, {
      batchId: batch.id,
      expectedRevision: currentBatch.revision,
    });

    expect(repository.uploads.get(upload.id)?.state).toBe('cancelled');
    expect(repository.batches.get(batch.id)?.state).toBe('cancelled');
  });

  it('returns processing immediately, assembles in order, and deletes chunks only after ready is durable', async () => {
    const { coordinator, repository, extract } = createCoordinator();
    const bytes = new Uint8Array(KNOWLEDGE_UPLOAD_CHUNK_BYTES + 10).fill(7);
    bytes.set(Buffer.from('%PDF-'), 0);
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    stageChunks(repository, upload.id, batch.id, bytes);
    repository.chunks.set(upload.id, repository.chunks.get(upload.id)!.toReversed());

    const processing = await coordinator.finalize(publisher, {
      uploadId: upload.id,
      expectedRevision: upload.revision,
    });
    expect(processing.state).toBe('assembling');
    await coordinator.whenIdle();

    expect(repository.uploads.get(upload.id)).toMatchObject({
      state: 'ready',
      pageCount: 2,
      proposedTitle: 'Extracted title',
    });
    expect(extract).toHaveBeenCalledOnce();
    expect(repository.staged.get(upload.id)).toEqual(bytes);
    expect(repository.stagedCovers.get(upload.id)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
    expect(repository.uploads.get(upload.id)?.cover).toBe(`${upload.id}.png`);
    expect(repository.events).toEqual(
      expect.arrayContaining([`read:${upload.id}:0`, `read:${upload.id}:1`]),
    );
    expect(repository.events.indexOf(`upload:${upload.id}:ready`)).toBeLessThan(
      repository.events.indexOf(`delete-chunks:${upload.id}`),
    );
  }, 30_000);

  it('marks checksum failures safely and retains chunks for diagnosis or retry', async () => {
    const { coordinator, repository } = createCoordinator();
    const bytes = Buffer.from('%PDF-test');
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    stageChunks(repository, upload.id, batch.id, bytes);
    repository.chunks.get(upload.id)![0]!.checksum = '0'.repeat(64);

    await coordinator.finalize(publisher, {
      uploadId: upload.id,
      expectedRevision: upload.revision,
    });
    await coordinator.whenIdle();

    expect(repository.uploads.get(upload.id)).toMatchObject({
      state: 'failed',
      safeError: 'checksum-mismatch',
    });
    expect(repository.chunks.has(upload.id)).toBe(true);
  });

  it('recovers assembling work after restart and serializes extraction', async () => {
    const { coordinator, repository } = createCoordinator();
    const firstBytes = Buffer.from('%PDF-first');
    const first = await beginOneFile(coordinator, firstBytes);
    stageChunks(repository, first.upload.id, first.batch.id, firstBytes);
    await repository.updateUpload(first.upload.id, { state: 'assembling' });

    await coordinator.start();
    await coordinator.whenIdle();

    expect(repository.uploads.get(first.upload.id)?.state).toBe('ready');
  });

  it('treats assembling, extracting, and ready finalize replays as idempotent', async () => {
    const { coordinator, repository } = createCoordinator();
    const bytes = Buffer.from('%PDF-test');
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    stageChunks(repository, upload.id, batch.id, bytes);
    await repository.updateUpload(upload.id, { state: 'assembling' });

    await expect(
      coordinator.finalize(publisher, { uploadId: upload.id, expectedRevision: 999 }),
    ).resolves.toMatchObject({ state: 'assembling' });
    await coordinator.whenIdle();
    await expect(
      coordinator.finalize(publisher, { uploadId: upload.id, expectedRevision: 0 }),
    ).resolves.toMatchObject({ state: 'ready' });
  });

  it('cancels files and batches idempotently before clearing staged bytes and chunks', async () => {
    const { coordinator, repository } = createCoordinator();
    const bytes = Buffer.from('%PDF-test');
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    stageChunks(repository, upload.id, batch.id, bytes);
    repository.staged.set(upload.id, bytes);

    await coordinator.cancelFile(publisher, {
      uploadId: upload.id,
      expectedRevision: upload.revision,
    });
    await coordinator.cancelFile(publisher, { uploadId: upload.id, expectedRevision: 0 });
    const currentBatch = repository.batches.get(batch.id)!;
    await coordinator.cancelBatch(publisher, {
      batchId: batch.id,
      expectedRevision: currentBatch.revision,
    });

    expect(repository.uploads.get(upload.id)?.state).toBe('cancelled');
    expect(repository.batches.get(batch.id)?.state).toBe('cancelled');
    expect(repository.staged.has(upload.id)).toBe(false);
    expect(repository.chunks.has(upload.id)).toBe(false);
  });

  it('settles a one-file batch when the file is discarded without a separate batch cancel', async () => {
    const { coordinator, repository } = createCoordinator();
    const bytes = Buffer.from('%PDF-test');
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    stageChunks(repository, upload.id, batch.id, bytes);

    await coordinator.cancelFile(publisher, {
      uploadId: upload.id,
      expectedRevision: upload.revision,
    });

    expect(repository.uploads.get(upload.id)?.state).toBe('cancelled');
    expect(repository.batches.get(batch.id)?.state).toBe('ready');
    expect(repository.staged.has(upload.id)).toBe(false);
    expect(repository.chunks.has(upload.id)).toBe(false);
  });

  it('keeps a discarded upload cancelled when in-flight extraction finishes later', async () => {
    let releaseExtraction!: () => void;
    let markExtractionStarted!: () => void;
    const extractionGate = new Promise<void>((resolve) => {
      releaseExtraction = resolve;
    });
    const extractionStarted = new Promise<void>((resolve) => {
      markExtractionStarted = resolve;
    });
    const repository = new MemoryRepository();
    const coordinator = new KnowledgeUploadCoordinator({
      repository,
      capacity: { assertBatch: vi.fn(async () => undefined) },
      extractor: {
        extract: vi.fn(async () => {
          markExtractionStarted();
          await extractionGate;
          return {
            metadataTitle: 'Replacement title',
            pageCount: 2,
            outline: [],
            outlineSource: 'none' as const,
            coverPng: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          };
        }),
        stop: vi.fn(async () => undefined),
      },
      now: () => NOW,
    });
    const bytes = Buffer.from('%PDF-replacement');
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    stageChunks(repository, upload.id, batch.id, bytes);

    await coordinator.finalize(publisher, {
      uploadId: upload.id,
      expectedRevision: upload.revision,
    });
    await extractionStarted;
    const extracting = repository.uploads.get(upload.id)!;
    expect(extracting.state).toBe('extracting');

    await coordinator.cancelFile(publisher, {
      uploadId: upload.id,
      expectedRevision: extracting.revision,
    });
    releaseExtraction();
    await coordinator.whenIdle();

    expect(repository.uploads.get(upload.id)?.state).toBe('cancelled');
    expect(repository.staged.has(upload.id)).toBe(false);
    expect(repository.stagedCovers.has(upload.id)).toBe(false);
    expect(repository.chunks.has(upload.id)).toBe(false);
    expect(repository.events).not.toContain(`upload:${upload.id}:ready`);
  });

  it('lets an accepted discard win when the worker already started its ready write', async () => {
    let releaseReadyWrite!: () => void;
    let markReadyWriteStarted!: () => void;
    let markCancelObserved!: () => void;
    const readyWriteGate = new Promise<void>((resolve) => {
      releaseReadyWrite = resolve;
    });
    const readyWriteStarted = new Promise<void>((resolve) => {
      markReadyWriteStarted = resolve;
    });
    const cancelObserved = new Promise<void>((resolve) => {
      markCancelObserved = resolve;
    });
    const repository = new MemoryRepository();
    const updateUpload = repository.updateUpload.bind(repository);
    repository.updateUpload = async (id, patch) => {
      if (patch.state === 'ready') {
        markReadyWriteStarted();
        await readyWriteGate;
      }
      return updateUpload(id, patch);
    };
    const getUpload = repository.getUpload.bind(repository);
    let observeCancel = false;
    repository.getUpload = async (id) => {
      const upload = await getUpload(id);
      if (observeCancel && upload?.state === 'extracting') {
        observeCancel = false;
        markCancelObserved();
      }
      return upload;
    };
    const { coordinator } = createCoordinator(repository);
    const bytes = Buffer.from('%PDF-replacement');
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    stageChunks(repository, upload.id, batch.id, bytes);

    await coordinator.finalize(publisher, {
      uploadId: upload.id,
      expectedRevision: upload.revision,
    });
    await readyWriteStarted;
    const extracting = repository.uploads.get(upload.id)!;
    expect(extracting.state).toBe('extracting');

    observeCancel = true;
    const cancellation = coordinator.cancelFile(publisher, {
      uploadId: upload.id,
      expectedRevision: extracting.revision,
    });
    await cancelObserved;
    releaseReadyWrite();
    await cancellation;
    await coordinator.whenIdle();

    expect(repository.uploads.get(upload.id)?.state).toBe('cancelled');
    expect(repository.staged.has(upload.id)).toBe(false);
    expect(repository.stagedCovers.has(upload.id)).toBe(false);
    expect(repository.chunks.has(upload.id)).toBe(false);
    expect(repository.events).toEqual(
      expect.arrayContaining([
        `upload:${upload.id}:ready`,
        `upload:${upload.id}:cancelled`,
        `clear:${upload.id}`,
      ]),
    );
    expect(repository.events.indexOf(`upload:${upload.id}:ready`)).toBeLessThan(
      repository.events.indexOf(`upload:${upload.id}:cancelled`),
    );
  });

  it('rejects stale file and batch cancellation after an upload is published', async () => {
    const { coordinator, repository } = createCoordinator();
    const bytes = Buffer.from('%PDF-test');
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    await repository.updateUpload(upload.id, { state: 'published', revision: 2 });
    await repository.updateBatch(batch.id, { state: 'ready', revision: 2 });

    await expect(
      coordinator.cancelFile(publisher, {
        uploadId: upload.id,
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({ code: 'conflict', currentRevision: 2 });
    await expect(
      coordinator.cancelBatch(publisher, {
        batchId: batch.id,
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({ code: 'conflict', currentRevision: 2 });
    expect(repository.uploads.get(upload.id)?.state).toBe('published');
    expect(repository.batches.get(batch.id)?.state).toBe('ready');
  });

  it('rejects finalize after an upload is published', async () => {
    const { coordinator, repository } = createCoordinator();
    const bytes = Buffer.from('%PDF-test');
    const { upload } = await beginOneFile(coordinator, bytes);
    await repository.updateUpload(upload.id, { state: 'published', revision: 2 });

    await expect(
      coordinator.finalize(publisher, {
        uploadId: upload.id,
        expectedRevision: 2,
      }),
    ).rejects.toMatchObject({ code: 'conflict', currentRevision: 2 });
    expect(repository.uploads.get(upload.id)).toMatchObject({
      state: 'published',
      revision: 2,
    });
  });

  it('cancels a file whose manifest creation was already in flight', async () => {
    let releaseCreate!: () => void;
    let markCreateStarted!: () => void;
    let markCancelObserved!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const createStarted = new Promise<void>((resolve) => {
      markCreateStarted = resolve;
    });
    const cancelObserved = new Promise<void>((resolve) => {
      markCancelObserved = resolve;
    });
    const repository = new MemoryRepository();
    const createUpload = repository.createUpload.bind(repository);
    repository.createUpload = async (record) => {
      markCreateStarted();
      await createGate;
      return createUpload(record);
    };
    const getBatch = repository.getBatch.bind(repository);
    let observeCancel = false;
    repository.getBatch = async (id) => {
      const current = await getBatch(id);
      if (observeCancel) {
        observeCancel = false;
        markCancelObserved();
      }
      return current;
    };
    const { coordinator } = createCoordinator(repository);
    const bytes = Buffer.from('%PDF-race');
    const batch = await coordinator.beginBatch(publisher, {
      requestId: 'batch-race',
      fileCount: 1,
      totalBytes: bytes.byteLength,
    });
    const beginning = coordinator.beginFile(publisher, {
      requestId: 'file-race',
      batchId: batch.id,
      fileName: 'Race.pdf',
      byteSize: bytes.byteLength,
      checksum: checksum(bytes),
      chunkCount: 1,
    });
    await createStarted;

    observeCancel = true;
    const cancellation = coordinator.cancelBatch(publisher, {
      batchId: batch.id,
      expectedRevision: batch.revision,
    });
    await cancelObserved;
    releaseCreate();
    const upload = await beginning;
    await cancellation;

    expect(repository.batches.get(batch.id)?.state).toBe('cancelled');
    expect(repository.uploads.get(upload.id)?.state).toBe('cancelled');
    expect(repository.chunks.has(upload.id)).toBe(false);
  });

  it('waits for the active safe boundary and stops the extractor on dispose', async () => {
    let release!: () => void;
    const extracting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository = new MemoryRepository();
    const stop = vi.fn(async () => undefined);
    const coordinator = new KnowledgeUploadCoordinator({
      repository,
      capacity: { assertBatch: vi.fn(async () => undefined) },
      extractor: {
        extract: vi.fn(async () => {
          await extracting;
          return {
            metadataTitle: null,
            pageCount: 1,
            outline: [],
            outlineSource: 'none' as const,
            coverPng: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
          };
        }),
        stop,
      },
      now: () => NOW,
    });
    const bytes = Buffer.from('%PDF-test');
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    stageChunks(repository, upload.id, batch.id, bytes);
    await coordinator.finalize(publisher, {
      uploadId: upload.id,
      expectedRevision: upload.revision,
    });

    const disposal = coordinator.dispose();
    let disposed = false;
    void disposal.then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    release();
    await disposal;
    expect(stop).toHaveBeenCalledOnce();
    await expect(
      coordinator.beginBatch(publisher, { requestId: 'late', fileCount: 1, totalBytes: 1 }),
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('skips a queued upload that retention cleanup deleted instead of rejecting the worker', async () => {
    const repository = new MemoryRepository();
    const bytes = Buffer.from('%PDF-test');
    const { coordinator } = createCoordinator(repository);
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    stageChunks(repository, upload.id, batch.id, bytes);
    const record = repository.uploads.get(upload.id)!;
    // Retention cleanup hard-deletes expired rows, so recovery can name an upload that is gone by
    // the time the worker reads it.
    repository.uploads.delete(upload.id);
    vi.spyOn(repository, 'listRecoverableUploads').mockResolvedValue([
      { ...record, state: 'assembling' },
    ]);
    const recovered = createCoordinator(repository).coordinator;

    await recovered.start();

    await expect(recovered.whenIdle()).resolves.toBeUndefined();
    expect(repository.uploads.has(upload.id)).toBe(false);
  });

  it('keeps draining the worker after one upload fails to load', async () => {
    const repository = new MemoryRepository();
    const bytes = Buffer.from('%PDF-test');
    const { coordinator } = createCoordinator(repository);
    const { batch, upload } = await beginOneFile(coordinator, bytes);
    stageChunks(repository, upload.id, batch.id, bytes);
    const record = { ...repository.uploads.get(upload.id)!, state: 'assembling' as const };
    repository.uploads.set(upload.id, record);
    // The first id no longer resolves; the second must still be processed.
    vi.spyOn(repository, 'listRecoverableUploads').mockResolvedValue([
      { ...record, id: 'upload-missing' },
      record,
    ]);
    const recovered = createCoordinator(repository).coordinator;

    await recovered.start();
    await recovered.whenIdle();

    expect(repository.uploads.get(upload.id)).toMatchObject({ state: 'ready' });
  });
});
