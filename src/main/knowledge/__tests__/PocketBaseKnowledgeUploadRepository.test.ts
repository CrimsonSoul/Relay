import { describe, expect, it, vi } from 'vitest';
import type {
  KnowledgeUploadBatchRecord,
  KnowledgeUploadChunkRecord,
  KnowledgeUploadManifestRecord,
} from '../KnowledgeUploadCoordinator';
import { PocketBaseKnowledgeUploadRepository } from '../PocketBaseKnowledgeUploadRepository';

const upload: KnowledgeUploadManifestRecord = {
  id: 'upload-1',
  requestId: 'request-1',
  batchId: 'batch-1',
  accountId: 'account-1',
  deviceId: 'device-1',
  actorDisplayName: 'Ryan Bledsoe',
  operatorId: 'operator-1',
  operatorName: 'Ryan Bledsoe',
  fileName: 'Runbook.pdf',
  byteSize: 9,
  checksum: 'a'.repeat(64),
  chunkSize: 4 * 1024 * 1024,
  chunkCount: 1,
  state: 'assembling',
  pdf: null,
  cover: null,
  pageCount: null,
  outline: [],
  outlineSource: null,
  proposedTitle: '',
  proposedCategory: '',
  proposedCategoryId: null,
  proposedDocumentType: 'sop',
  replacementDocumentId: null,
  duplicateDocumentId: null,
  safeError: null,
  lastActivityAt: '2026-07-15T20:00:00.000Z',
  readyAt: null,
  expiresAt: '2026-07-22T20:00:00.000Z',
  revision: 1,
};

const batch: KnowledgeUploadBatchRecord = {
  id: 'batch-1',
  requestId: 'batch-request-1',
  accountId: 'account-1',
  deviceId: 'device-1',
  actorDisplayName: '',
  operatorId: 'legacy-account',
  operatorName: 'Legacy Publisher',
  fileCount: 1,
  totalBytes: 9,
  state: 'active',
  createdAt: '2026-07-15T20:00:00.000Z',
  lastActivityAt: '2026-07-15T20:00:00.000Z',
  expiresAt: '2026-07-22T20:00:00.000Z',
  revision: 1,
};

describe('PocketBaseKnowledgeUploadRepository', () => {
  it('normalizes historical batch actor snapshots without rewriting their rows', async () => {
    const getOne = vi.fn(async () => batch);
    const pb = {
      collection: vi.fn(() => ({ getOne })),
      files: { getToken: vi.fn(), getURL: vi.fn() },
    };
    const repository = new PocketBaseKnowledgeUploadRepository({ pb: pb as never });

    await expect(repository.getBatch('batch-1')).resolves.toMatchObject({
      accountId: 'account-1',
      actorDisplayName: 'Legacy Publisher',
    });
  });

  it('normalizes upload actor snapshots new-field-first with legacy fallback', async () => {
    const getOne = vi.fn(async (id: string) =>
      id === 'current'
        ? {
            ...upload,
            id,
            actorDisplayName: 'Current Publisher',
            operatorId: 'legacy-should-not-win',
            operatorName: 'Legacy Should Not Win',
          }
        : {
            ...upload,
            id,
            actorDisplayName: '',
            operatorId: 'legacy-account',
            operatorName: 'Legacy Publisher',
          },
    );
    const pb = {
      collection: vi.fn(() => ({ getOne })),
      files: { getToken: vi.fn(), getURL: vi.fn() },
    };
    const repository = new PocketBaseKnowledgeUploadRepository({ pb: pb as never });

    await expect(repository.getUpload('current')).resolves.toMatchObject({
      accountId: 'account-1',
      actorDisplayName: 'Current Publisher',
    });
    await expect(repository.getUpload('legacy')).resolves.toMatchObject({
      accountId: 'account-1',
      actorDisplayName: 'Legacy Publisher',
    });
  });

  it('stores the assembled PDF as a protected PocketBase file form without a path', async () => {
    const update = vi.fn(async (_id: string, data: FormData) => ({
      ...upload,
      pdf: 'runbook.pdf',
      revision: 2,
      received: data,
    }));
    const pb = {
      collection: vi.fn(() => ({ update })),
      files: { getToken: vi.fn(), getURL: vi.fn() },
    };
    const repository = new PocketBaseKnowledgeUploadRepository({ pb: pb as never });
    const bytes = Buffer.from('%PDF-test');

    await expect(repository.storeStagedPdf(upload, bytes)).resolves.toMatchObject({
      id: 'upload-1',
      pdf: 'runbook.pdf',
    });
    const form = update.mock.calls[0]?.[1];
    const file = form?.get('pdf');
    expect(file).toBeInstanceOf(Blob);
    expect(file).toMatchObject({ size: bytes.byteLength, type: 'application/pdf' });
    expect(form?.has('path')).toBe(false);
    expect(form?.has('accountId')).toBe(false);
  });

  it('stores the rendered cover as a bounded protected PNG form', async () => {
    const update = vi.fn(async (_id: string, data: FormData) => ({
      ...upload,
      cover: 'cover.png',
      revision: 2,
      received: data,
    }));
    const pb = {
      collection: vi.fn(() => ({ update })),
      files: { getToken: vi.fn(), getURL: vi.fn() },
    };
    const repository = new PocketBaseKnowledgeUploadRepository({ pb: pb as never });
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    await expect(repository.storeStagedCover(upload, bytes)).resolves.toMatchObject({
      id: 'upload-1',
      cover: 'cover.png',
    });
    const file = update.mock.calls[0]?.[1].get('cover');
    expect(file).toBeInstanceOf(Blob);
    expect(file).toMatchObject({ size: bytes.byteLength, type: 'image/png' });
  });

  it('downloads a protected chunk through a short-lived PocketBase file token', async () => {
    const bytes = Buffer.from('chunk-data');
    const getToken = vi.fn(async () => 'short-lived-token');
    const getURL = vi.fn(() => 'https://relay.invalid/api/files/chunk');
    const fetch = vi.fn(async () => new Response(bytes, { status: 200 }));
    const pb = { collection: vi.fn(), files: { getToken, getURL } };
    const repository = new PocketBaseKnowledgeUploadRepository({
      pb: pb as never,
      fetch: fetch as typeof globalThis.fetch,
    });
    const chunk: KnowledgeUploadChunkRecord = {
      id: 'chunk-1',
      uploadId: 'upload-1',
      batchId: 'batch-1',
      accountId: 'account-1',
      deviceId: 'device-1',
      index: 0,
      byteSize: bytes.byteLength,
      checksum: 'a'.repeat(64),
      fileName: 'chunk.bin',
    };

    await expect(repository.readChunk(chunk)).resolves.toEqual(Uint8Array.from(bytes));
    expect(getToken).toHaveBeenCalledWith({ requestKey: null });
    expect(getURL).toHaveBeenCalledWith(chunk, 'chunk.bin', { token: 'short-lived-token' });
    expect(fetch).toHaveBeenCalledWith('https://relay.invalid/api/files/chunk', {
      redirect: 'error',
    });
  });

  it('rejects a declared protected chunk larger than the four MiB bound', async () => {
    const getToken = vi.fn(async () => 'short-lived-token');
    const getURL = vi.fn(() => 'https://relay.invalid/api/files/chunk');
    const fetch = vi.fn(
      async () =>
        new Response('small', {
          status: 200,
          headers: { 'content-length': String(4 * 1024 * 1024 + 1) },
        }),
    );
    const repository = new PocketBaseKnowledgeUploadRepository({
      pb: { collection: vi.fn(), files: { getToken, getURL } } as never,
      fetch: fetch as typeof globalThis.fetch,
    });

    await expect(
      repository.readChunk({
        id: 'chunk-1',
        uploadId: 'upload-1',
        batchId: 'batch-1',
        accountId: 'account-1',
        deviceId: 'device-1',
        index: 0,
        byteSize: 1,
        checksum: 'a'.repeat(64),
        fileName: 'chunk.bin',
      }),
    ).rejects.toThrow(/too-large/i);
  });
});
