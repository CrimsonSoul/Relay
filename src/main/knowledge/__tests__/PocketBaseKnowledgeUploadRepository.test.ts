import { describe, expect, it, vi } from 'vitest';
import type {
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
  operatorId: 'operator-1',
  operatorName: 'Ryan Bledsoe',
  fileName: 'Runbook.pdf',
  byteSize: 9,
  checksum: 'a'.repeat(64),
  chunkSize: 4 * 1024 * 1024,
  chunkCount: 1,
  state: 'assembling',
  pdf: null,
  pageCount: null,
  outline: [],
  outlineSource: null,
  proposedTitle: '',
  proposedCategory: '',
  duplicateDocumentId: null,
  safeError: null,
  lastActivityAt: '2026-07-15T20:00:00.000Z',
  readyAt: null,
  expiresAt: '2026-07-22T20:00:00.000Z',
  revision: 1,
};

describe('PocketBaseKnowledgeUploadRepository', () => {
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
