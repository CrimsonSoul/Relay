import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_UPLOAD_BATCHES_COLLECTION,
  KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION,
  KNOWLEDGE_UPLOAD_CHUNK_BYTES,
  type KnowledgeUploadBatchStatusView,
  type KnowledgeUploadBatchView,
  type KnowledgeUploadManifestView,
} from '@shared/knowledge';
import type { KnowledgeUploadQueueState } from '../KnowledgeUploadQueueStore';
import { KnowledgeUploadService } from '../KnowledgeUploadService';

vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }));

const view = {
  state: 'active' as const,
  accountId: 'account-admin',
  username: 'ryan',
  displayName: 'Ryan Bledsoe',
  role: 'admin' as const,
  capabilities: ['knowledge.manage' as const],
  deviceId: 'device-1',
  expiresAt: null,
};

const createdAt = '2026-07-16T01:00:00.000Z';
const expiresAt = '2026-07-23T01:00:00.000Z';

function batch(overrides: Partial<KnowledgeUploadBatchView> = {}): KnowledgeUploadBatchView {
  return {
    id: 'batch-1',
    requestId: 'batch-request-1',
    fileCount: 1,
    totalBytes: 12,
    state: 'active',
    createdAt,
    lastActivityAt: createdAt,
    expiresAt,
    revision: 0,
    ...overrides,
  };
}

function manifest(
  overrides: Partial<KnowledgeUploadManifestView> = {},
): KnowledgeUploadManifestView {
  return {
    id: 'upload-1',
    batchId: 'batch-1',
    fileName: 'First.pdf',
    byteSize: 12,
    checksum: createHash('sha256').update('%PDF-first!!').digest('hex'),
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
    lastActivityAt: createdAt,
    readyAt: null,
    expiresAt,
    revision: 0,
    ...overrides,
  };
}

function queueStore(initial?: KnowledgeUploadQueueState) {
  let value: KnowledgeUploadQueueState = initial ?? {
    version: 2,
    restartRecovery: false,
    entries: [],
  };
  return {
    load: vi.fn(async () => structuredClone(value)),
    save: vi.fn(async (next: KnowledgeUploadQueueState) => {
      value = structuredClone(next);
    }),
    current: () => structuredClone(value),
  };
}

function commandRuntime(statusUploads: KnowledgeUploadManifestView[] = []) {
  const createPrivilegedRecord = vi.fn(async () => ({ id: 'chunk-1' }));
  let beganUpload = statusUploads.length > 0;
  const submitPublicCommand = vi.fn(async (request: { command: string }) => {
    if (request.command === 'knowledge.upload.batch.begin') {
      return { ok: true, requestId: 'request', value: batch() } as const;
    }
    if (request.command === 'knowledge.upload.status') {
      let uploads: KnowledgeUploadManifestView[] = [];
      if (beganUpload) uploads = statusUploads.length > 0 ? statusUploads : [manifest()];
      const value: KnowledgeUploadBatchStatusView = {
        batch: batch(),
        uploads,
      };
      return { ok: true, requestId: 'request', value } as const;
    }
    if (request.command === 'knowledge.upload.file.begin') {
      beganUpload = true;
      return { ok: true, requestId: 'request', value: manifest() } as const;
    }
    if (request.command === 'knowledge.upload.file.finalize') {
      return {
        ok: true,
        requestId: 'request',
        value: manifest({ state: 'assembling', missingChunkIndexes: [], revision: 1 }),
      } as const;
    }
    if (request.command.endsWith('.cancel')) {
      return { ok: true, requestId: 'request', value: undefined } as const;
    }
    throw new Error(`Unexpected command ${request.command}`);
  });
  return {
    runtime: { getView: vi.fn(() => view), createPrivilegedRecord, submitPublicCommand },
    createPrivilegedRecord,
    submitPublicCommand,
  };
}

function candidate(path = '/private/work/First.pdf') {
  return {
    canonicalPath: path,
    fileName: 'First.pdf',
    byteSize: 12,
    modifiedMs: 100,
    device: 1,
    inode: 2,
  };
}

describe('KnowledgeUploadService', () => {
  it('queues server-staged paths with an isolated local source identity', async () => {
    const store = queueStore();
    const { runtime } = commandRuntime();
    runtime.getView.mockReturnValue({ ...view, deviceId: null });
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      inspectCandidate: vi.fn(async () => candidate('/managed/web/First.pdf')),
      planSource: vi.fn(async () => ({
        ...candidate('/managed/web/First.pdf'),
        checksum: manifest().checksum,
        chunkCount: 1,
      })),
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-1'),
    });

    const result = await service.queuePaths(['/managed/web/First.pdf'], 'web-session-a');

    expect(result).toMatchObject({ ok: true, uploads: [{ fileName: 'First.pdf' }] });
    expect(store.current().entries[0]).toMatchObject({
      localSourceId: 'web-session-a',
      deviceId: 'server-local',
      source: { canonicalPath: '/managed/web/First.pdf' },
    });
    await service.whenIdle();
  });

  it('persists an explicit replacement target and sends it with the file manifest', async () => {
    const store = queueStore();
    const { runtime, submitPublicCommand } = commandRuntime();
    const selectFiles = vi.fn(async () => ['/private/work/Differently Named.pdf']);
    const replacementCandidate = candidate('/private/work/Differently Named.pdf');
    replacementCandidate.fileName = 'Differently Named.pdf';
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      selectFiles,
      inspectCandidate: vi.fn(async () => replacementCandidate),
      planSource: vi.fn(async () => ({
        ...replacementCandidate,
        checksum: manifest().checksum,
        chunkCount: 1,
      })),
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-1'),
    });

    await service.start();
    await service.selectAndQueue(undefined, 'document-1');
    await service.whenIdle();

    expect(selectFiles).toHaveBeenCalledWith(undefined, true);
    expect(store.current().entries[0]).toMatchObject({
      replacementDocumentId: 'document-1',
      source: { fileName: 'Differently Named.pdf' },
    });
    expect(
      submitPublicCommand.mock.calls.find(
        ([request]) => request.command === 'knowledge.upload.file.begin',
      )?.[0],
    ).toMatchObject({
      payload: { replacementDocumentId: 'document-1' },
    });
  });

  it('returns a safe queue immediately and hashes/uploads in the background', async () => {
    let releasePlan!: () => void;
    const planning = new Promise<void>((resolve) => {
      releasePlan = resolve;
    });
    const store = queueStore();
    const { runtime, createPrivilegedRecord, submitPublicCommand } = commandRuntime();
    const emitSnapshot = vi.fn();
    const checksum = manifest().checksum;
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      selectFiles: vi.fn(async () => ['/private/work/First.pdf']),
      inspectCandidate: vi.fn(async () => candidate()),
      planSource: vi.fn(async () => {
        await planning;
        return { ...candidate(), checksum, chunkCount: 1 };
      }),
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
      revalidateSource: vi.fn(async () => true),
      emitSnapshot,
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-1'),
    });

    await service.start();
    const result = await service.selectAndQueue();

    expect(result).toMatchObject({
      ok: true,
      uploads: [{ id: 'local-1', uploadId: null, fileName: 'First.pdf', state: 'planning' }],
    });
    expect(submitPublicCommand).not.toHaveBeenCalled();
    const exposed = JSON.stringify({ result, snapshots: emitSnapshot.mock.calls });
    expect(exposed).not.toContain('/private/work');
    expect(exposed).not.toContain('%PDF-');
    expect(store.current().entries[0]?.source.canonicalPath).toBe('/private/work/First.pdf');

    service.handleSessionChanged(view);
    service.handleSessionChanged(view);

    releasePlan();
    await service.whenIdle();

    expect(createPrivilegedRecord).toHaveBeenCalledWith(
      KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION,
      expect.any(FormData),
    );
    expect(submitPublicCommand.mock.calls.map(([request]) => request.command)).toEqual([
      'knowledge.upload.batch.begin',
      'knowledge.upload.status',
      'knowledge.upload.file.begin',
      'knowledge.upload.file.finalize',
    ]);
    expect(
      submitPublicCommand.mock.calls.find(
        ([request]) => request.command === 'knowledge.upload.file.finalize',
      )?.[0],
    ).toMatchObject({
      payload: { uploadId: 'upload-1', expectedRevision: 0 },
      expectedRevision: null,
    });
    expect(service.snapshot().items[0]).toMatchObject({
      uploadId: 'upload-1',
      acknowledgedBytes: 12,
      state: 'assembling',
    });
  });

  it('waits for planning and authoritatively cancels the resulting replacement upload', async () => {
    let releasePlan!: () => void;
    let markPlanStarted!: () => void;
    const planning = new Promise<void>((resolve) => {
      releasePlan = resolve;
    });
    const planStarted = new Promise<void>((resolve) => {
      markPlanStarted = resolve;
    });
    const store = queueStore();
    const { runtime, submitPublicCommand } = commandRuntime();
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      inspectCandidate: vi.fn(async () => candidate('/private/work/Replacement.pdf')),
      planSource: vi.fn(async () => {
        markPlanStarted();
        await planning;
        return {
          ...candidate('/private/work/Replacement.pdf'),
          checksum: manifest().checksum,
          chunkCount: 1,
        };
      }),
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-1'),
    });

    await service.queuePaths(['/private/work/Replacement.pdf'], view.deviceId, 'document-existing');
    await planStarted;
    const cancellation = service.cancelUpload('local-1');
    let cancelled = false;
    void cancellation.then(() => {
      cancelled = true;
    });
    await Promise.resolve();
    expect(cancelled).toBe(false);

    releasePlan();
    await cancellation;
    await service.whenIdle();

    const commands = submitPublicCommand.mock.calls.map(([request]) => request.command);
    expect(commands).toContain('knowledge.upload.file.begin');
    expect(commands).toContain('knowledge.upload.file.cancel');
    expect(commands.indexOf('knowledge.upload.file.begin')).toBeLessThan(
      commands.indexOf('knowledge.upload.file.cancel'),
    );
    expect(service.snapshot().items[0]).toMatchObject({
      uploadId: 'upload-1',
      state: 'cancelled',
    });
  });

  it('keeps the local upload non-terminal when authoritative file cancellation fails', async () => {
    const store = queueStore();
    const { runtime, submitPublicCommand } = commandRuntime();
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      inspectCandidate: vi.fn(async () => candidate()),
      planSource: vi.fn(async () => ({
        ...candidate(),
        checksum: manifest().checksum,
        chunkCount: 1,
      })),
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-1'),
    });

    await service.queuePaths(['/private/work/First.pdf'], view.deviceId);
    await service.whenIdle();
    submitPublicCommand.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));

    await expect(service.cancelUpload('local-1')).rejects.toThrow('offline');
    expect(service.snapshot().items[0]?.state).not.toBe('cancelled');
  });

  it('keeps a batch non-terminal when authoritative batch cancellation fails', async () => {
    const store = queueStore();
    const { runtime, submitPublicCommand } = commandRuntime();
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      inspectCandidate: vi.fn(async () => candidate()),
      planSource: vi.fn(async () => ({
        ...candidate(),
        checksum: manifest().checksum,
        chunkCount: 1,
      })),
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-1'),
    });

    await service.queuePaths(['/private/work/First.pdf'], view.deviceId);
    await service.whenIdle();
    submitPublicCommand.mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }));

    await expect(service.cancelBatch('batch-1')).rejects.toThrow('offline');
    expect(service.snapshot().items[0]?.state).not.toBe('cancelled');
  });

  it('cancels the server batch when file preparation failed after batch creation', async () => {
    const store = queueStore();
    const { runtime, submitPublicCommand } = commandRuntime();
    const submit = submitPublicCommand.getMockImplementation()!;
    submitPublicCommand.mockImplementation(async (request) => {
      if (request.command === 'knowledge.upload.file.begin') {
        throw Object.assign(new Error('offline'), { status: 0 });
      }
      return submit(request);
    });
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      inspectCandidate: vi.fn(async () => candidate()),
      planSource: vi.fn(async () => ({
        ...candidate(),
        checksum: manifest().checksum,
        chunkCount: 1,
      })),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-1'),
    });

    await service.queuePaths(['/private/work/First.pdf'], view.deviceId);
    await service.whenIdle();
    expect(service.snapshot().items[0]).toMatchObject({
      batchId: 'batch-1',
      uploadId: null,
      state: 'paused-network',
    });

    await service.cancelUpload('local-1');

    expect(submitPublicCommand.mock.calls.map(([request]) => request.command)).toContain(
      'knowledge.upload.batch.cancel',
    );
    expect(service.snapshot().items[0]?.state).toBe('cancelled');
  });

  it('refreshes a multi-file batch revision before fallback cancellation', async () => {
    const store = queueStore();
    let batchRevision = 0;
    let firstUpload: KnowledgeUploadManifestView | null = null;
    const submitPublicCommand = vi.fn(
      async (request: { command: string; payload?: Record<string, unknown> }) => {
        if (request.command === 'knowledge.upload.batch.begin') {
          return {
            ok: true,
            requestId: 'batch-begin',
            value: batch({ fileCount: 2, totalBytes: 24, revision: batchRevision }),
          } as const;
        }
        if (request.command === 'knowledge.upload.status') {
          return {
            ok: true,
            requestId: 'status',
            value: {
              batch: batch({ fileCount: 2, totalBytes: 24, revision: batchRevision }),
              uploads: firstUpload ? [firstUpload] : [],
            },
          } as const;
        }
        if (request.command === 'knowledge.upload.file.begin') {
          if (request.payload?.fileName === 'Second.pdf') {
            throw Object.assign(new Error('offline'), { status: 0 });
          }
          batchRevision = 1;
          firstUpload = manifest({ id: 'upload-first', fileName: 'First.pdf' });
          return { ok: true, requestId: 'file-begin', value: firstUpload } as const;
        }
        if (request.command === 'knowledge.upload.batch.cancel') {
          expect(request.payload).toMatchObject({ batchId: 'batch-1', expectedRevision: 1 });
          return { ok: true, requestId: 'batch-cancel', value: undefined } as const;
        }
        throw new Error(`Unexpected command ${request.command}`);
      },
    );
    const runtime = {
      getView: vi.fn(() => view),
      createPrivilegedRecord: vi.fn(),
      submitPublicCommand,
    };
    const scheduler = {
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      cancelUpload: vi.fn(),
      cancelBatch: vi.fn(),
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
      inspectCandidate: vi.fn(async (path: string) => {
        const value = candidate(path);
        value.fileName = path.includes('Second') ? 'Second.pdf' : 'First.pdf';
        return value;
      }),
      planSource: vi.fn(async (value) => ({
        ...value,
        checksum: manifest().checksum,
        chunkCount: 1,
      })),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-1')
        .mockReturnValueOnce('local-2'),
    });

    await service.queuePaths(
      ['/private/work/First.pdf', '/private/work/Second.pdf'],
      view.deviceId,
    );
    await service.whenIdle();
    expect(service.snapshot().items[1]).toMatchObject({
      id: 'local-2',
      batchId: 'batch-1',
      uploadId: null,
      state: 'paused-network',
    });

    await service.cancelUpload('local-2');

    expect(scheduler.cancelBatch).toHaveBeenCalledWith('batch-1');
    expect(service.snapshot().items.map(({ state }) => state)).toEqual(['cancelled', 'cancelled']);
  });

  it('restores an encrypted queue and uploads only server-declared missing chunks', async () => {
    const checksum = manifest({ byteSize: KNOWLEDGE_UPLOAD_CHUNK_BYTES + 2 }).checksum;
    const restoredManifest = manifest({
      byteSize: KNOWLEDGE_UPLOAD_CHUNK_BYTES + 2,
      checksum,
      chunkCount: 2,
      missingChunkIndexes: [1],
    });
    const store = queueStore({
      version: 2,
      restartRecovery: true,
      entries: [
        {
          localId: 'local-1',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 0,
          uploadId: 'upload-1',
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          source: {
            ...candidate(),
            byteSize: KNOWLEDGE_UPLOAD_CHUNK_BYTES + 2,
            checksum,
            chunkCount: 2,
          },
          acknowledgedChunkIndexes: [0],
          state: 'paused-network',
          safeError: 'offline',
          retryCount: 8,
        },
      ],
    });
    const { runtime, createPrivilegedRecord } = commandRuntime([restoredManifest]);
    const readChunk = vi.fn(async (plan: unknown, index: number) => {
      expect(plan).toMatchObject({ checksum });
      return new Uint8Array(index === 1 ? 2 : KNOWLEDGE_UPLOAD_CHUNK_BYTES);
    });
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      revalidateSource: vi.fn(async () => true),
      readChunk,
    });

    await service.start();
    await service.whenIdle();

    expect(readChunk).toHaveBeenCalledOnce();
    expect(readChunk).toHaveBeenCalledWith(expect.any(Object), 1);
    expect(createPrivilegedRecord).toHaveBeenCalledOnce();
    expect(service.snapshot().restartRecovery).toBe(true);
  });

  it('requires the unchanged source after restart and never uploads stale bytes', async () => {
    const checksum = manifest().checksum;
    const store = queueStore({
      version: 2,
      restartRecovery: true,
      entries: [
        {
          localId: 'local-1',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 0,
          uploadId: 'upload-1',
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'paused-network',
          safeError: 'offline',
          retryCount: 8,
        },
      ],
    });
    const { runtime, createPrivilegedRecord } = commandRuntime([manifest()]);
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      revalidateSource: vi.fn(async () => false),
    });

    await service.start();
    await service.whenIdle();

    expect(createPrivilegedRecord).not.toHaveBeenCalled();
    expect(service.snapshot().items[0]).toMatchObject({
      state: 'source-required',
      safeError: 'source-required',
    });
  });

  it('reconciles a published server upload before accepting the next batch', async () => {
    const checksum = manifest().checksum;
    const store = queueStore({
      version: 2,
      restartRecovery: true,
      entries: [
        {
          localId: 'local-1',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 0,
          uploadId: 'upload-1',
          uploadRevision: 1,
          accountId: view.accountId,
          deviceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [0],
          state: 'assembling',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const published = manifest({
      state: 'published',
      missingChunkIndexes: [],
      revision: 2,
    });
    const { runtime, createPrivilegedRecord, submitPublicCommand } = commandRuntime([published]);
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      selectFiles: vi.fn(async () => []),
      revalidateSource: vi.fn(async () => true),
    });

    await service.start();
    await service.whenIdle();

    expect(service.snapshot().items[0]?.state).toBe('published');
    expect(createPrivilegedRecord).not.toHaveBeenCalled();
    expect(
      submitPublicCommand.mock.calls.some(
        ([request]) => request.command === 'knowledge.upload.file.finalize',
      ),
    ).toBe(false);
  });

  it('reconciles a locally ready upload after the server publishes it', async () => {
    const checksum = manifest().checksum;
    const store = queueStore({
      version: 2,
      restartRecovery: false,
      entries: [
        {
          localId: 'local-1',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 1,
          uploadId: 'upload-1',
          uploadRevision: 1,
          accountId: view.accountId,
          deviceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [0],
          state: 'ready',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const { runtime, submitPublicCommand } = commandRuntime([
      manifest({ state: 'published', missingChunkIndexes: [], revision: 2 }),
    ]);
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
    });

    await service.start();
    await service.refresh();

    expect(service.snapshot().items[0]?.state).toBe('published');
    expect(submitPublicCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'knowledge.upload.status' }),
    );
  });

  it('does not persist or emit an unchanged server status during queue polling', async () => {
    const checksum = manifest().checksum;
    const store = queueStore({
      version: 2,
      restartRecovery: false,
      entries: [
        {
          localId: 'local-1',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 0,
          uploadId: 'upload-1',
          uploadRevision: 1,
          accountId: view.accountId,
          deviceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [0],
          state: 'ready',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const ready = manifest({
      state: 'ready',
      missingChunkIndexes: [],
      revision: 1,
    });
    const { runtime } = commandRuntime([ready]);
    const emitSnapshot = vi.fn();
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      emitSnapshot,
    });

    await service.start();
    store.save.mockClear();
    emitSnapshot.mockClear();
    await service.refresh();

    expect(store.save).not.toHaveBeenCalled();
    expect(emitSnapshot).not.toHaveBeenCalled();
  });

  it('bounds cancellation and authorization failures before queueing paths', async () => {
    const store = queueStore();
    const { runtime } = commandRuntime();
    const selectFiles = vi.fn(async () => []);
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      selectFiles,
    });
    await expect(service.selectAndQueue()).resolves.toEqual({ ok: false, error: 'cancelled' });

    runtime.getView.mockReturnValueOnce({ ...view, capabilities: [] });
    await expect(service.selectAndQueue()).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
    expect(store.save).not.toHaveBeenCalled();
  });

  it('creates chunk records without placing the assembled PDF in an upload record', async () => {
    const store = queueStore();
    const { runtime, createPrivilegedRecord } = commandRuntime();
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      selectFiles: vi.fn(async () => ['/private/work/First.pdf']),
      inspectCandidate: vi.fn(async () => candidate()),
      planSource: vi.fn(async () => ({
        ...candidate(),
        checksum: manifest().checksum,
        chunkCount: 1,
      })),
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-1'),
    });

    await service.selectAndQueue();
    await service.whenIdle();

    expect(createPrivilegedRecord).toHaveBeenCalledOnce();
    expect(createPrivilegedRecord).toHaveBeenCalledWith(
      KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION,
      expect.any(FormData),
    );
    expect(createPrivilegedRecord).not.toHaveBeenCalledWith(
      KNOWLEDGE_UPLOAD_BATCHES_COLLECTION,
      expect.anything(),
    );
  });
});
