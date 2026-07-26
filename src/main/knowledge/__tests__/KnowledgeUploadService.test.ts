import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_UPLOAD_BATCHES_COLLECTION,
  KNOWLEDGE_UPLOAD_CHUNKS_COLLECTION,
  KNOWLEDGE_UPLOAD_CHUNK_BYTES,
  KNOWLEDGE_UPLOAD_MAX_FILES,
  type KnowledgeUploadBatchStatusView,
  type KnowledgeUploadBatchView,
  type KnowledgeUploadManifestView,
} from '@shared/knowledge';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import type { KnowledgeUploadQueueState } from '../KnowledgeUploadQueueStore';
import {
  KnowledgeUploadScheduler,
  type KnowledgeUploadSchedulerTask,
} from '../KnowledgeUploadScheduler';
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

  it('does not overwrite an authoritative ready finalize response with assembling', async () => {
    const store = queueStore();
    const { runtime, submitPublicCommand } = commandRuntime();
    const submit = submitPublicCommand.getMockImplementation()!;
    submitPublicCommand.mockImplementation(async (request) => {
      if (request.command === 'knowledge.upload.file.finalize') {
        return {
          ok: true,
          requestId: 'finalize-ready',
          value: manifest({ state: 'ready', missingChunkIndexes: [], revision: 1 }),
        } as const;
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
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-1'),
    });

    await service.queuePaths(['/private/work/First.pdf'], view.deviceId);
    await service.whenIdle();

    expect(service.snapshot().items[0]).toMatchObject({
      state: 'ready',
      acknowledgedChunkCount: 1,
    });
  });

  it('persists cancellation during planning before declaring and cancelling its server upload', async () => {
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

    expect(submitPublicCommand.mock.calls.map(([request]) => request.command)).toEqual([
      'knowledge.upload.batch.begin',
      'knowledge.upload.status',
      'knowledge.upload.file.begin',
      'knowledge.upload.file.cancel',
    ]);
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

  it('converges locally when an ambiguous file cancellation is authoritatively cancelled', async () => {
    const authoritativeUploads = [manifest()];
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
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          source: { ...candidate(), checksum: manifest().checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'uploading',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const { runtime, submitPublicCommand } = commandRuntime(authoritativeUploads);
    const submit = submitPublicCommand.getMockImplementation()!;
    submitPublicCommand.mockImplementation(async (request) => {
      if (request.command === 'knowledge.upload.file.cancel') {
        authoritativeUploads[0] = manifest({
          state: 'cancelled',
          missingChunkIndexes: [],
          revision: 1,
        });
        return {
          ok: false,
          requestId: 'ambiguous-cancel',
          error: 'server-error',
        } as const;
      }
      return submit(request);
    });
    const scheduler = {
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceUpload: vi.fn(async () => undefined),
      retireUpload: vi.fn(),
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
      revalidateSource: vi.fn(async () => true),
    });

    await service.start();
    await service.whenIdle();
    await service.cancelUpload('local-1');

    expect(scheduler.retireUpload).toHaveBeenCalledWith('upload-1');
    expect(service.snapshot().items[0]).toMatchObject({
      uploadId: 'upload-1',
      state: 'cancelled',
    });
    expect(
      submitPublicCommand.mock.calls.filter(
        ([request]) => request.command === 'knowledge.upload.status',
      ),
    ).toHaveLength(4);
  });

  it('preserves a genuine file cancellation error when status does not confirm cancellation', async () => {
    const authoritativeUploads = [manifest()];
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
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          source: { ...candidate(), checksum: manifest().checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'uploading',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const { runtime, submitPublicCommand } = commandRuntime(authoritativeUploads);
    const submit = submitPublicCommand.getMockImplementation()!;
    submitPublicCommand.mockImplementation(async (request) => {
      if (request.command === 'knowledge.upload.file.cancel') {
        return {
          ok: false,
          requestId: 'failed-cancel',
          error: 'server-error',
        } as const;
      }
      return submit(request);
    });
    const scheduler = {
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceUpload: vi.fn(async () => undefined),
      retireUpload: vi.fn(),
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
      revalidateSource: vi.fn(async () => true),
    });

    await service.start();
    await service.whenIdle();

    await expect(service.cancelUpload('local-1')).rejects.toThrow('server-error');
    expect(scheduler.retireUpload).not.toHaveBeenCalled();
    expect(service.snapshot().items[0]?.state).not.toBe('cancelled');
    expect(
      submitPublicCommand.mock.calls.filter(
        ([request]) => request.command === 'knowledge.upload.status',
      ),
    ).toHaveLength(5);
  });

  it('persists cancellation intent and quiesces transfer before sending the server command', async () => {
    let releaseChunk!: () => void;
    const chunkGate = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
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
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'uploading',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const { runtime, createPrivilegedRecord, submitPublicCommand } = commandRuntime([manifest()]);
    createPrivilegedRecord.mockImplementation(async () => {
      await chunkGate;
      return { id: 'chunk-1' };
    });
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      revalidateSource: vi.fn(async () => true),
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
    });

    await service.start();
    await vi.waitFor(() => expect(createPrivilegedRecord).toHaveBeenCalledOnce());
    const cancellation = service.cancelUpload('local-1');

    await vi.waitFor(() =>
      expect(store.current().entries[0]).toMatchObject({ cancelRequested: true }),
    );
    expect(
      submitPublicCommand.mock.calls.filter(
        ([request]) => request.command === 'knowledge.upload.file.cancel',
      ),
    ).toHaveLength(0);

    releaseChunk();
    await cancellation;
    await service.whenIdle();

    const commands = submitPublicCommand.mock.calls.map(([request]) => request.command);
    expect(commands).toContain('knowledge.upload.file.cancel');
    expect(commands).not.toContain('knowledge.upload.file.finalize');
    expect(store.current().entries[0]).not.toHaveProperty('cancelRequested');
    expect(service.snapshot().items[0]?.state).toBe('cancelled');
  });

  it('reconciles a cancellation conflict and retries once with the authoritative revision', async () => {
    let serverRevision = 0;
    const attempts: number[] = [];
    const commandOrder: string[] = [];
    const submitPublicCommand = vi.fn(
      async (request: { command: string; payload?: Record<string, unknown> }) => {
        if (request.command === 'knowledge.upload.status') {
          return {
            ok: true,
            requestId: 'status',
            value: {
              batch: batch({ revision: serverRevision }),
              uploads: [manifest({ revision: serverRevision })],
            },
          } as const;
        }
        if (request.command === 'knowledge.upload.file.cancel') {
          commandOrder.push('command');
          const expectedRevision = Number(request.payload?.expectedRevision);
          attempts.push(expectedRevision);
          if (attempts.length === 1) {
            serverRevision = 2;
            return { ok: false, requestId: 'conflict', error: 'conflict' } as const;
          }
          return { ok: true, requestId: 'cancelled', value: undefined } as const;
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
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceUpload: vi.fn(async () => {
        commandOrder.push('quiesce');
      }),
      retireUpload: vi.fn(),
    };
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
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum: manifest().checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'uploading',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
      revalidateSource: vi.fn(async () => true),
    });

    await service.start();
    await service.whenIdle();
    await service.cancelUpload('local-1');

    expect(commandOrder.slice(-3)).toEqual(['quiesce', 'command', 'command']);
    expect(attempts).toEqual([0, 2]);
    expect(scheduler.retireUpload).toHaveBeenCalledWith('upload-1');
    expect(service.snapshot().items[0]?.state).toBe('cancelled');
  });

  it('resumes a persisted cancellation request after restart instead of resuming transfer', async () => {
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
          localSourceId: view.deviceId,
          cancelRequested: true,
          source: { ...candidate(), checksum: manifest().checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'uploading',
          safeError: 'offline',
          retryCount: 0,
        },
      ],
    });
    const { runtime, submitPublicCommand } = commandRuntime([manifest()]);
    const scheduler = {
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceUpload: vi.fn(async () => undefined),
      retireUpload: vi.fn(),
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
      revalidateSource: vi.fn(async () => true),
    });

    await service.start();
    await service.whenIdle();

    expect(scheduler.enqueue).not.toHaveBeenCalled();
    expect(
      submitPublicCommand.mock.calls.filter(
        ([request]) => request.command === 'knowledge.upload.file.cancel',
      ),
    ).toHaveLength(1);
    expect(store.current().entries[0]).not.toHaveProperty('cancelRequested');
    expect(service.snapshot().items[0]?.state).toBe('cancelled');
  });

  it('keeps durable cancellation intent when the server remains offline', async () => {
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
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum: manifest().checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'uploading',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const { runtime, submitPublicCommand } = commandRuntime([manifest()]);
    submitPublicCommand.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }));
    const scheduler = {
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceUpload: vi.fn(async () => undefined),
      retireUpload: vi.fn(),
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
    });

    await service.start();
    await service.whenIdle();
    await expect(service.cancelUpload('local-1')).rejects.toThrow('offline');

    expect(store.current().entries[0]).toMatchObject({
      cancelRequested: true,
      state: 'paused',
      safeError: 'offline',
    });
    expect(scheduler.retireUpload).not.toHaveBeenCalled();
  });

  it('retries an authoritative failed upload with complete chunks by finalizing its current revision', async () => {
    const checksum = manifest().checksum;
    const failed = manifest({
      state: 'failed',
      safeError: 'upload-failed',
      missingChunkIndexes: [],
      revision: 2,
    });
    const store = queueStore({
      version: 2,
      restartRecovery: true,
      entries: [
        {
          localId: 'local-1',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 2,
          uploadId: 'upload-1',
          uploadRevision: 2,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [0],
          state: 'failed',
          safeError: 'upload-failed',
          retryCount: 1,
        },
      ],
    });
    const { runtime, submitPublicCommand } = commandRuntime([failed]);
    const submit = submitPublicCommand.getMockImplementation()!;
    submitPublicCommand.mockImplementation(async (request) => {
      if (request.command === 'knowledge.upload.file.finalize') {
        return {
          ok: true,
          requestId: 'retry-finalize',
          value: manifest({ state: 'assembling', missingChunkIndexes: [], revision: 3 }),
        } as const;
      }
      return submit(request);
    });
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
    });

    await service.start();
    await service.whenIdle();
    service.retryUpload('local-1');
    await service.whenIdle();

    expect(submitPublicCommand).toHaveBeenCalledWith({
      command: 'knowledge.upload.file.finalize',
      payload: { uploadId: 'upload-1', expectedRevision: 2 },
      expectedRevision: null,
    });
    expect(service.snapshot().items[0]?.state).toBe('assembling');
  });

  it('records a deferred batch begin response before cancelling the created server work', async () => {
    let resolveBatch!: (value: {
      ok: true;
      requestId: string;
      value: KnowledgeUploadBatchView;
    }) => void;
    let markBatchStarted!: () => void;
    const batchStarted = new Promise<void>((resolve) => {
      markBatchStarted = resolve;
    });
    const commands: string[] = [];
    let uploadCreated = false;
    const submitPublicCommand = vi.fn(async (request: { command: string }) => {
      commands.push(request.command);
      if (request.command === 'knowledge.upload.batch.begin') {
        markBatchStarted();
        return new Promise<{
          ok: true;
          requestId: string;
          value: KnowledgeUploadBatchView;
        }>((resolve) => {
          resolveBatch = resolve;
        });
      }
      if (request.command === 'knowledge.upload.status') {
        return {
          ok: true,
          requestId: 'status',
          value: {
            batch: batch(),
            uploads: uploadCreated ? [manifest()] : [],
          },
        } as const;
      }
      if (request.command === 'knowledge.upload.file.begin') {
        uploadCreated = true;
        return { ok: true, requestId: 'file-begin', value: manifest() } as const;
      }
      if (request.command === 'knowledge.upload.file.cancel') {
        return { ok: true, requestId: 'cancel', value: undefined } as const;
      }
      throw new Error(`Unexpected command ${request.command}`);
    });
    const runtime = {
      getView: vi.fn(() => view),
      createPrivilegedRecord: vi.fn(),
      submitPublicCommand,
    };
    const store = queueStore();
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
    await batchStarted;
    const cancellation = service.cancelUpload('local-1');
    resolveBatch({ ok: true, requestId: 'batch-begin', value: batch() });
    await cancellation;
    await service.whenIdle();

    expect(commands).toEqual([
      'knowledge.upload.batch.begin',
      'knowledge.upload.status',
      'knowledge.upload.file.begin',
      'knowledge.upload.file.cancel',
    ]);
    expect(store.current().entries[0]).toMatchObject({
      batchId: 'batch-1',
      uploadId: 'upload-1',
      state: 'cancelled',
    });
  });

  it('records a deferred file begin response before cancelling without creating it twice', async () => {
    let resolveUpload!: (value: {
      ok: true;
      requestId: string;
      value: KnowledgeUploadManifestView;
    }) => void;
    let markUploadStarted!: () => void;
    const uploadStarted = new Promise<void>((resolve) => {
      markUploadStarted = resolve;
    });
    const commands: string[] = [];
    let beganUpload = false;
    const submitPublicCommand = vi.fn(async (request: { command: string }) => {
      commands.push(request.command);
      if (request.command === 'knowledge.upload.batch.begin') {
        return { ok: true, requestId: 'batch-begin', value: batch() } as const;
      }
      if (request.command === 'knowledge.upload.status') {
        return {
          ok: true,
          requestId: 'status',
          value: {
            batch: batch(),
            uploads: [],
          },
        } as const;
      }
      if (request.command === 'knowledge.upload.file.begin') {
        if (beganUpload) {
          throw new Error('file begin was issued twice');
        }
        beganUpload = true;
        markUploadStarted();
        return new Promise<{
          ok: true;
          requestId: string;
          value: KnowledgeUploadManifestView;
        }>((resolve) => {
          resolveUpload = resolve;
        });
      }
      if (request.command === 'knowledge.upload.file.cancel') {
        return { ok: true, requestId: 'cancel', value: undefined } as const;
      }
      throw new Error(`Unexpected command ${request.command}`);
    });
    const runtime = {
      getView: vi.fn(() => view),
      createPrivilegedRecord: vi.fn(),
      submitPublicCommand,
    };
    const store = queueStore();
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
    await uploadStarted;
    const cancellation = service.cancelUpload('local-1');
    resolveUpload({ ok: true, requestId: 'file-begin', value: manifest() });
    await cancellation;
    await service.whenIdle();

    expect(commands.filter((command) => command === 'knowledge.upload.file.begin')).toHaveLength(1);
    expect(commands.at(-1)).toBe('knowledge.upload.file.cancel');
    expect(store.current().entries[0]).toMatchObject({
      uploadId: 'upload-1',
      state: 'cancelled',
    });
  });

  it('plans and cancels one sibling whose batch id arrived before its source plan', async () => {
    let releaseSecondPlan!: () => void;
    let markSecondPlanning!: () => void;
    const secondPlanGate = new Promise<void>((resolve) => {
      releaseSecondPlan = resolve;
    });
    const secondPlanning = new Promise<void>((resolve) => {
      markSecondPlanning = resolve;
    });
    const uploads: KnowledgeUploadManifestView[] = [];
    const submitPublicCommand = vi.fn(
      async (request: { command: string; payload?: Record<string, unknown> }) => {
        if (request.command === 'knowledge.upload.batch.begin') {
          return {
            ok: true,
            requestId: 'batch-begin',
            value: batch({ fileCount: 2, totalBytes: 24 }),
          } as const;
        }
        if (request.command === 'knowledge.upload.status') {
          return {
            ok: true,
            requestId: 'status',
            value: {
              batch: batch({ fileCount: 2, totalBytes: 24 }),
              uploads,
            },
          } as const;
        }
        if (request.command === 'knowledge.upload.file.begin') {
          const fileName = String(request.payload?.fileName);
          const upload = manifest({
            id: fileName === 'Second.pdf' ? 'upload-second' : 'upload-first',
            fileName,
          });
          uploads.push(upload);
          return { ok: true, requestId: `begin-${fileName}`, value: upload } as const;
        }
        if (request.command === 'knowledge.upload.file.cancel') {
          return { ok: true, requestId: 'cancel-second', value: undefined } as const;
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
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceUpload: vi.fn(async () => undefined),
      retireUpload: vi.fn(),
    };
    const store = queueStore();
    const planCalls = new Map<string, number>();
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
      inspectCandidate: vi.fn(async (path: string) => {
        const value = candidate(path);
        value.fileName = path.includes('Second') ? 'Second.pdf' : 'First.pdf';
        return value;
      }),
      planSource: vi.fn(async (value) => {
        const calls = (planCalls.get(value.fileName) ?? 0) + 1;
        planCalls.set(value.fileName, calls);
        if (value.fileName === 'Second.pdf' && calls === 1) {
          markSecondPlanning();
          await secondPlanGate;
        }
        return { ...value, checksum: manifest().checksum, chunkCount: 1 };
      }),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-first')
        .mockReturnValueOnce('local-second'),
    });

    await service.queuePaths(
      ['/private/work/First.pdf', '/private/work/Second.pdf'],
      view.deviceId,
    );
    await secondPlanning;
    const cancellation = service.cancelUpload('local-second');
    releaseSecondPlan();
    await cancellation;
    await service.whenIdle();

    expect(planCalls.get('Second.pdf')).toBe(2);
    expect(
      submitPublicCommand.mock.calls.find(
        ([request]) => request.command === 'knowledge.upload.file.cancel',
      )?.[0],
    ).toMatchObject({ payload: { uploadId: 'upload-second' } });
    expect(service.snapshot().items.find(({ id }) => id === 'local-first')?.state).not.toBe(
      'cancelled',
    );
    expect(service.snapshot().items.find(({ id }) => id === 'local-second')?.state).toBe(
      'cancelled',
    );
  });

  it('keeps ready and uploading siblings cancellation-pending when batch cancel stays offline', async () => {
    const checksum = manifest().checksum;
    const store = queueStore({
      version: 2,
      restartRecovery: false,
      entries: [
        {
          localId: 'local-ready',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 0,
          uploadId: 'upload-ready',
          uploadRevision: 1,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: { ...candidate('/private/work/Ready.pdf'), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [0],
          state: 'ready',
          safeError: null,
          retryCount: 0,
        },
        {
          localId: 'local-uploading',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 0,
          uploadId: 'upload-uploading',
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: { ...candidate('/private/work/Uploading.pdf'), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'uploading',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const submitPublicCommand = vi.fn(async (request: { command: string }) => {
      if (request.command === 'knowledge.upload.status') {
        return {
          ok: true,
          requestId: 'status',
          value: { batch: batch({ fileCount: 2, totalBytes: 24 }), uploads: [] },
        } as const;
      }
      throw Object.assign(new Error('offline'), { status: 0 });
    });
    const scheduler = {
      setSessionActive: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceBatch: vi.fn(async () => undefined),
      retireBatch: vi.fn(),
    };
    const runtime = {
      getView: vi.fn(() => view),
      createPrivilegedRecord: vi.fn(),
      submitPublicCommand,
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
    });
    await service.start();
    await service.whenIdle();

    await expect(service.cancelBatch('batch-1')).rejects.toThrow('offline');

    expect(store.current().entries).toEqual([
      expect.objectContaining({
        localId: 'local-ready',
        cancelRequested: true,
        state: 'paused',
        safeError: 'offline',
      }),
      expect.objectContaining({
        localId: 'local-uploading',
        cancelRequested: true,
        state: 'paused',
        safeError: 'offline',
      }),
    ]);
  });

  it('retries a durable cancellation during refresh after network recovery', async () => {
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
          localSourceId: view.deviceId,
          cancelRequested: true,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'paused',
          safeError: 'offline',
          retryCount: 0,
        },
      ],
    });
    let online = false;
    const onlineRuntime = commandRuntime([manifest()]);
    const submitPublicCommand = vi.fn(async (request) => {
      if (!online) throw Object.assign(new Error('offline'), { status: 0 });
      return onlineRuntime.submitPublicCommand(request);
    });
    const runtime = {
      getView: vi.fn(() => view),
      createPrivilegedRecord: vi.fn(),
      submitPublicCommand,
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
    });

    await service.start();
    await service.whenIdle();
    expect(store.current().entries[0]).toMatchObject({
      cancelRequested: true,
      state: 'paused',
    });

    online = true;
    await service.refresh();
    await service.whenIdle();

    expect(store.current().entries[0]).not.toHaveProperty('cancelRequested');
    expect(service.snapshot().items[0]?.state).toBe('cancelled');
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

  it('keeps file cancellation pending without cancelling siblings when manifest creation is offline', async () => {
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

    await expect(service.cancelUpload('local-1')).rejects.toThrow('offline');

    expect(submitPublicCommand.mock.calls.map(([request]) => request.command)).not.toContain(
      'knowledge.upload.batch.cancel',
    );
    expect(store.current().entries[0]).toMatchObject({
      cancelRequested: true,
      state: 'paused',
      safeError: 'offline',
    });
  });

  it('never cancels a multi-file batch when one missing manifest cannot be created', async () => {
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
      quiesceUpload: vi.fn(async () => undefined),
      retireUpload: vi.fn(),
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

    await expect(service.cancelUpload('local-2')).rejects.toThrow('offline');

    expect(submitPublicCommand.mock.calls.map(([request]) => request.command)).not.toContain(
      'knowledge.upload.batch.cancel',
    );
    expect(service.snapshot().items[0]?.state).not.toBe('cancelled');
    expect(store.current().entries[1]).toMatchObject({
      cancelRequested: true,
      state: 'paused',
      safeError: 'offline',
    });
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
    expect(readChunk).not.toHaveBeenCalled();

    service.retryUpload('local-1');
    await service.whenIdle();

    expect(readChunk).toHaveBeenCalledOnce();
    expect(readChunk).toHaveBeenCalledWith(expect.any(Object), 1);
    expect(createPrivilegedRecord).toHaveBeenCalledOnce();
    expect(service.snapshot().restartRecovery).toBe(true);
  });

  it('preserves an explicit pause across restart and refresh until the user resumes it', async () => {
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
          state: 'paused',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const { runtime, createPrivilegedRecord } = commandRuntime([manifest()]);
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      revalidateSource: vi.fn(async () => true),
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
    });

    await service.start();
    await service.whenIdle();
    await service.refresh();

    expect(service.snapshot().items[0]).toMatchObject({
      state: 'paused',
      acknowledgedChunkCount: 0,
    });
    expect(createPrivilegedRecord).not.toHaveBeenCalled();

    service.resumeBatch('batch-1');
    await service.whenIdle();

    expect(createPrivilegedRecord).toHaveBeenCalledOnce();
    expect(service.snapshot().items[0]).toMatchObject({
      state: 'assembling',
      acknowledgedChunkCount: 1,
    });
  });

  it('accepts an authoritative failed state for an explicitly paused upload', async () => {
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
          state: 'paused',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const failedUpload = manifest({
      state: 'failed',
      safeError: 'upload-failed',
      revision: 1,
    });
    const { runtime } = commandRuntime([failedUpload]);
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
    });

    await service.start();
    await service.refresh();

    expect(service.snapshot().items[0]).toMatchObject({
      state: 'failed',
      safeError: 'upload-failed',
    });
  });

  it('keeps an explicitly paused in-flight upload paused when the session becomes inactive', async () => {
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
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
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'queued',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const { runtime, createPrivilegedRecord } = commandRuntime([manifest()]);
    createPrivilegedRecord.mockImplementation(async () => {
      await uploadGate;
      return { id: 'chunk-1' };
    });
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      revalidateSource: vi.fn(async () => true),
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
    });

    await service.start();
    await vi.waitFor(() => expect(createPrivilegedRecord).toHaveBeenCalledOnce());

    service.pauseBatch('batch-1');
    service.handleSessionChanged({
      ...view,
      state: 'signed-out',
      accountId: null,
      username: null,
      displayName: null,
      role: null,
      capabilities: [],
      deviceId: null,
    });
    releaseUpload();
    await service.whenIdle();

    expect(service.snapshot().items[0]).toMatchObject({
      state: 'paused',
      acknowledgedChunkCount: 0,
    });
  });

  it('resumes every missing chunk when reactivated before production-shaped requests settle', async () => {
    const byteSize = KNOWLEDGE_UPLOAD_CHUNK_BYTES * 4 + 12;
    const checksum = manifest({ byteSize }).checksum;
    const restoredManifest = manifest({
      byteSize,
      checksum,
      chunkCount: 5,
      missingChunkIndexes: [2, 3, 4],
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
            byteSize,
            checksum,
            chunkCount: 5,
          },
          acknowledgedChunkIndexes: [0, 1],
          state: 'paused-network',
          safeError: 'offline',
          retryCount: 8,
        },
      ],
    });
    const interruptedRuntime = commandRuntime([restoredManifest]);
    const rejectInterruptedRequests: Array<(reason: unknown) => void> = [];
    interruptedRuntime.createPrivilegedRecord.mockImplementation(
      async () =>
        new Promise<never>((_resolve, reject) => {
          rejectInterruptedRequests.push(reject);
        }),
    );
    const resumedRuntime = commandRuntime([restoredManifest]);
    let runtime = interruptedRuntime.runtime;
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      revalidateSource: vi.fn(async () => true),
      readChunk: vi.fn(async (_plan: unknown, index: number) => {
        const remaining = byteSize - index * KNOWLEDGE_UPLOAD_CHUNK_BYTES;
        return new Uint8Array(Math.min(KNOWLEDGE_UPLOAD_CHUNK_BYTES, remaining));
      }),
    });

    await service.start();
    service.retryUpload('local-1');
    await vi.waitFor(() =>
      expect(interruptedRuntime.createPrivilegedRecord).toHaveBeenCalledTimes(2),
    );

    service.handleSessionChanged({
      ...view,
      state: 'signed-out',
      accountId: null,
      username: null,
      displayName: null,
      role: null,
      capabilities: [],
      deviceId: null,
    });
    runtime = resumedRuntime.runtime;
    service.handleSessionChanged(view);
    for (const reject of rejectInterruptedRequests) {
      reject(Object.assign(new Error('old-session-closed'), { status: 400 }));
    }
    await service.whenIdle();

    const resumedChunkIndexes = resumedRuntime.createPrivilegedRecord.mock.calls.map(([, data]) =>
      Number((data as FormData).get('index')),
    );
    expect(new Set(resumedChunkIndexes)).toEqual(new Set([2, 3, 4]));
    expect(resumedChunkIndexes).not.toContain(0);
    expect(resumedChunkIndexes).not.toContain(1);
    expect(service.snapshot().items[0]).toMatchObject({
      state: 'assembling',
      acknowledgedChunkCount: 5,
    });
  });

  it('never sends account A chunks through account B and resumes them when A returns', async () => {
    let rejectAccountAUpload!: (reason: unknown) => void;
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
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'queued',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const accountA = commandRuntime([manifest()]);
    accountA.createPrivilegedRecord.mockImplementation(
      async () =>
        new Promise<never>((_resolve, reject) => {
          rejectAccountAUpload = reject;
        }),
    );
    const accountBView = {
      ...view,
      accountId: 'account-b',
      username: 'account-b',
      displayName: 'Account B',
      deviceId: 'device-b',
    };
    const accountB = commandRuntime([manifest()]);
    accountB.runtime.getView.mockReturnValue(accountBView);
    const resumedAccountA = commandRuntime([manifest()]);
    let runtime = accountA.runtime;
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      revalidateSource: vi.fn(async () => true),
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
    });

    await service.start();
    await vi.waitFor(() => expect(accountA.createPrivilegedRecord).toHaveBeenCalledOnce());

    runtime = accountB.runtime;
    service.handleSessionChanged(accountBView);
    rejectAccountAUpload(Object.assign(new Error('old-session-closed'), { status: 400 }));
    await service.whenIdle();

    expect(accountB.createPrivilegedRecord).not.toHaveBeenCalled();
    expect(service.snapshot().items).toEqual([]);

    runtime = resumedAccountA.runtime;
    service.handleSessionChanged(view);
    await service.whenIdle();

    expect(resumedAccountA.createPrivilegedRecord).toHaveBeenCalledOnce();
    expect(service.snapshot().items[0]).toMatchObject({
      state: 'assembling',
      acknowledgedChunkCount: 1,
    });
  });

  it('discards account A planning that settles after switching to account B', async () => {
    let releasePlanning!: () => void;
    let markPlanningStarted!: () => void;
    const planningGate = new Promise<void>((resolve) => {
      releasePlanning = resolve;
    });
    const planningStarted = new Promise<void>((resolve) => {
      markPlanningStarted = resolve;
    });
    const store = queueStore({
      version: 2,
      restartRecovery: true,
      entries: [
        {
          localId: 'local-1',
          batchRequestId: 'batch-request-1',
          batchId: null,
          batchRevision: 0,
          uploadId: null,
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          source: { ...candidate(), checksum: null, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'planning',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const accountA = commandRuntime();
    const accountBView = {
      ...view,
      accountId: 'account-b',
      username: 'account-b',
      displayName: 'Account B',
      deviceId: 'device-b',
    };
    const accountB = commandRuntime();
    accountB.runtime.getView.mockReturnValue(accountBView);
    let runtime = accountA.runtime;
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      planSource: vi.fn(async () => {
        markPlanningStarted();
        await planningGate;
        return { ...candidate(), checksum: manifest().checksum, chunkCount: 1 };
      }),
    });

    await service.start();
    await planningStarted;

    runtime = accountB.runtime;
    service.handleSessionChanged(accountBView);
    releasePlanning();
    await service.whenIdle();

    expect(accountA.submitPublicCommand).not.toHaveBeenCalled();
    expect(accountB.submitPublicCommand).not.toHaveBeenCalled();
    expect(accountB.createPrivilegedRecord).not.toHaveBeenCalled();
    expect(store.current().entries[0]).toMatchObject({
      state: 'planning',
      safeError: null,
      source: { checksum: null },
    });
    expect(service.snapshot().items).toEqual([]);
  });

  it('discards planning that settles after the user explicitly pauses it', async () => {
    let releasePlanning!: () => void;
    let markPlanningStarted!: () => void;
    const planningGate = new Promise<void>((resolve) => {
      releasePlanning = resolve;
    });
    const planningStarted = new Promise<void>((resolve) => {
      markPlanningStarted = resolve;
    });
    const store = queueStore({
      version: 2,
      restartRecovery: true,
      entries: [
        {
          localId: 'local-1',
          batchRequestId: 'batch-request-1',
          batchId: null,
          batchRevision: 0,
          uploadId: null,
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          source: { ...candidate(), checksum: null, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'planning',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const { runtime, submitPublicCommand, createPrivilegedRecord } = commandRuntime();
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      planSource: vi.fn(async () => {
        markPlanningStarted();
        await planningGate;
        return { ...candidate(), checksum: manifest().checksum, chunkCount: 1 };
      }),
    });

    await service.start();
    await planningStarted;

    service.pauseBatch('batch-request-1');
    releasePlanning();
    await service.whenIdle();

    expect(submitPublicCommand).not.toHaveBeenCalled();
    expect(createPrivilegedRecord).not.toHaveBeenCalled();
    expect(store.current().entries[0]?.source.checksum).toBeNull();
    expect(service.snapshot().items[0]).toMatchObject({
      state: 'paused',
      acknowledgedChunkCount: 0,
    });
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
    service.retryUpload('local-1');
    await service.whenIdle();

    expect(createPrivilegedRecord).not.toHaveBeenCalled();
    expect(service.snapshot().items[0]).toMatchObject({
      state: 'source-required',
      safeError: 'source-required',
    });
  });

  it('accepts authoritative ready state on restart before revalidating the local source', async () => {
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
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [0],
          state: 'paused-network',
          safeError: 'offline',
          retryCount: 8,
        },
      ],
    });
    const ready = manifest({
      state: 'ready',
      missingChunkIndexes: [],
      revision: 2,
    });
    const { runtime, createPrivilegedRecord, submitPublicCommand } = commandRuntime([ready]);
    const revalidateSource = vi.fn(async () => false);
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      revalidateSource,
    });

    await service.start();
    await service.whenIdle();

    expect(submitPublicCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'knowledge.upload.status' }),
    );
    expect(revalidateSource).not.toHaveBeenCalled();
    expect(createPrivilegedRecord).not.toHaveBeenCalled();
    expect(service.snapshot().items[0]).toMatchObject({
      state: 'ready',
      acknowledgedChunkCount: 1,
    });
  });

  it('keeps authoritative assembling state on restart without reopening the local source', async () => {
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
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [0],
          state: 'paused-network',
          safeError: 'offline',
          retryCount: 8,
        },
      ],
    });
    const { runtime, createPrivilegedRecord } = commandRuntime([
      manifest({ state: 'assembling', missingChunkIndexes: [], revision: 1 }),
    ]);
    const revalidateSource = vi.fn(async () => false);
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      revalidateSource,
    });

    await service.start();
    await service.whenIdle();

    expect(revalidateSource).not.toHaveBeenCalled();
    expect(createPrivilegedRecord).not.toHaveBeenCalled();
    expect(service.snapshot().items[0]?.state).toBe('assembling');
  });

  it('ignores late scheduler acknowledgment and failure callbacks after authoritative processing begins', async () => {
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
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'uploading',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const { runtime } = commandRuntime([manifest()]);
    let scheduled!: KnowledgeUploadSchedulerTask;
    const scheduler = {
      setSessionActive: vi.fn(),
      enqueue: vi.fn((task: KnowledgeUploadSchedulerTask) => {
        scheduled = task;
      }),
      whenIdle: vi.fn(async () => undefined),
      retireUpload: vi.fn(),
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
      revalidateSource: vi.fn(async () => true),
    });

    await service.start();
    await service.whenIdle();
    await scheduled.finalize();
    scheduled.onAcknowledged(0, 12);
    scheduled.onState('failed', 'upload-failed', 1);
    await service.whenIdle();

    expect(service.snapshot().items[0]).toMatchObject({
      state: 'assembling',
      acknowledgedChunkCount: 0,
      safeError: null,
    });
    expect(scheduler.retireUpload).toHaveBeenCalledWith('upload-1');
  });

  it('keeps the highest authoritative revision when concurrent refreshes resolve out of order', async () => {
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
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [0],
          state: 'ready',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const pending: Array<
      (value: { ok: true; requestId: string; value: KnowledgeUploadBatchStatusView }) => void
    > = [];
    const submitPublicCommand = vi.fn(
      async () =>
        new Promise<{
          ok: true;
          requestId: string;
          value: KnowledgeUploadBatchStatusView;
        }>((resolve) => pending.push(resolve)),
    );
    const runtime = {
      getView: vi.fn(() => view),
      createPrivilegedRecord: vi.fn(),
      submitPublicCommand,
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
    });
    await service.start();

    const first = service.refresh();
    const second = service.refresh();
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[1]!({
      ok: true,
      requestId: 'newer',
      value: {
        batch: batch({ revision: 2 }),
        uploads: [
          manifest({
            state: 'published',
            missingChunkIndexes: [],
            revision: 2,
          }),
        ],
      },
    });
    await second;
    pending[0]!({
      ok: true,
      requestId: 'older',
      value: {
        batch: batch({ revision: 1 }),
        uploads: [manifest({ state: 'ready', missingChunkIndexes: [], revision: 1 })],
      },
    });
    await first;

    expect(service.snapshot().items[0]?.state).toBe('published');
    expect(store.current().entries[0]).toMatchObject({
      uploadRevision: 2,
      batchRevision: 2,
      state: 'published',
    });
  });

  it('discards an account A refresh response after switching to account B', async () => {
    let releaseStatus!: (value: {
      ok: true;
      requestId: string;
      value: KnowledgeUploadBatchStatusView;
    }) => void;
    let markStatusStarted!: () => void;
    const statusStarted = new Promise<void>((resolve) => {
      markStatusStarted = resolve;
    });
    const checksum = manifest().checksum;
    const store = queueStore({
      version: 2,
      restartRecovery: false,
      entries: [
        {
          localId: 'local-a',
          batchRequestId: 'batch-request-a',
          batchId: 'batch-1',
          batchRevision: 1,
          uploadId: 'upload-1',
          uploadRevision: 1,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [0],
          state: 'ready',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const accountA = commandRuntime();
    accountA.submitPublicCommand.mockImplementation(
      async () =>
        new Promise<{
          ok: true;
          requestId: string;
          value: KnowledgeUploadBatchStatusView;
        }>((resolve) => {
          releaseStatus = resolve;
          markStatusStarted();
        }),
    );
    const accountBView = {
      ...view,
      accountId: 'account-b',
      username: 'account-b',
      displayName: 'Account B',
      deviceId: 'device-b',
    };
    const accountB = commandRuntime();
    accountB.runtime.getView.mockReturnValue(accountBView);
    let runtime = accountA.runtime;
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
    });

    await service.start();
    const refresh = service.refresh();
    await statusStarted;
    runtime = accountB.runtime;
    service.handleSessionChanged(accountBView);
    releaseStatus({
      ok: true,
      requestId: 'stale-status',
      value: {
        batch: batch({ revision: 2 }),
        uploads: [
          manifest({
            state: 'published',
            missingChunkIndexes: [],
            revision: 2,
          }),
        ],
      },
    });
    await refresh;

    expect(accountA.submitPublicCommand).toHaveBeenCalledOnce();
    expect(accountB.submitPublicCommand).not.toHaveBeenCalled();
    expect(store.current().entries[0]).toMatchObject({
      batchRevision: 1,
      uploadRevision: 1,
      state: 'ready',
      safeError: null,
    });
    expect(service.snapshot().items).toEqual([]);
  });

  it('rejects a stale desktop picker result after the initiating account changes', async () => {
    let releasePicker!: (paths: string[]) => void;
    const picker = new Promise<string[]>((resolve) => {
      releasePicker = resolve;
    });
    const accountA = commandRuntime();
    const accountBView = {
      ...view,
      accountId: 'account-b',
      username: 'account-b',
      displayName: 'Account B',
      deviceId: 'device-b',
    };
    const accountB = commandRuntime();
    accountB.runtime.getView.mockReturnValue(accountBView);
    let runtime = accountA.runtime;
    const store = queueStore();
    const inspectCandidate = vi.fn(async () => candidate());
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      selectFiles: vi.fn(async () => picker),
      inspectCandidate,
    });
    await service.start();

    const selection = service.selectAndQueue();
    runtime = accountB.runtime;
    releasePicker(['/private/work/First.pdf']);

    await expect(selection).resolves.toEqual({ ok: false, error: 'unauthorized' });
    expect(inspectCandidate).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
    expect(accountA.submitPublicCommand).not.toHaveBeenCalled();
    expect(accountB.submitPublicCommand).not.toHaveBeenCalled();
  });

  it('does not let an unauthorized direct queue attempt poison the next local source', async () => {
    const signedOutView = {
      ...view,
      state: 'signed-out' as const,
      accountId: null,
      username: null,
      displayName: null,
      role: null,
      capabilities: [],
      deviceId: null,
    };
    const accountBView = {
      ...view,
      accountId: 'account-b',
      username: 'account-b',
      displayName: 'Account B',
      deviceId: null,
    };
    const runtime = commandRuntime().runtime;
    runtime.getView.mockReturnValue(signedOutView);
    const store = queueStore();
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
    });

    await expect(service.queuePaths(['/managed/web/First.pdf'], 'web-a')).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
    });
    runtime.getView.mockReturnValue(accountBView);
    await expect(service.queuePaths(['/managed/web/First.pdf'], 'web-b')).resolves.toMatchObject({
      ok: true,
    });
    await service.whenIdle();

    expect(store.current().entries[0]).toMatchObject({
      accountId: 'account-b',
      localSourceId: 'web-b',
    });
  });

  it('restores an account web-source queue after another account uses the same browser session', async () => {
    const accountAView = { ...view, deviceId: null };
    const accountBView = {
      ...accountAView,
      accountId: 'account-b',
      username: 'account-b',
      displayName: 'Account B',
    };
    let currentView = accountAView;
    const batches = new Map<string, KnowledgeUploadBatchView>();
    const uploads = new Map<string, KnowledgeUploadManifestView[]>();
    const submitPublicCommand = vi.fn(
      async (request: { command: string; payload?: Record<string, unknown> }) => {
        if (request.command === 'knowledge.upload.batch.begin') {
          const requestId = String(request.payload?.requestId);
          const created = batch({
            id: `server-${requestId}`,
            requestId,
            fileCount: Number(request.payload?.fileCount),
            totalBytes: Number(request.payload?.totalBytes),
          });
          batches.set(created.id, created);
          uploads.set(created.id, []);
          return { ok: true, requestId: `begin-${requestId}`, value: created } as const;
        }
        if (request.command === 'knowledge.upload.status') {
          const batchId = String(request.payload?.batchId);
          return {
            ok: true,
            requestId: `status-${batchId}`,
            value: {
              batch: batches.get(batchId),
              uploads: uploads.get(batchId) ?? [],
            },
          } as const;
        }
        if (request.command === 'knowledge.upload.file.begin') {
          const batchId = String(request.payload?.batchId);
          const created = manifest({
            id: `upload-${batchId}`,
            batchId,
            fileName: String(request.payload?.fileName),
            byteSize: Number(request.payload?.byteSize),
            checksum: String(request.payload?.checksum),
          });
          uploads.get(batchId)?.push(created);
          return { ok: true, requestId: `file-${batchId}`, value: created } as const;
        }
        if (request.command === 'knowledge.upload.file.cancel') {
          return { ok: true, requestId: 'cancel', value: undefined } as const;
        }
        throw new Error(`Unexpected command ${request.command}`);
      },
    );
    const runtime = {
      getView: vi.fn(() => currentView),
      createPrivilegedRecord: vi.fn(),
      submitPublicCommand,
    };
    const scheduler = {
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceUpload: vi.fn(async () => undefined),
      retireUpload: vi.fn(),
    };
    const store = queueStore();
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
      inspectCandidate: vi.fn(async (path: string) => {
        const value = candidate(path);
        value.fileName = path.includes('Account-B') ? 'Account-B.pdf' : 'Account-A.pdf';
        return value;
      }),
      planSource: vi.fn(async (value) => ({
        ...value,
        checksum: manifest().checksum,
        chunkCount: 1,
      })),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-a')
        .mockReturnValueOnce('local-a')
        .mockReturnValueOnce('batch-request-b')
        .mockReturnValueOnce('local-b'),
    });

    await service.start();
    await service.queuePaths(['/managed/web/Account-A.pdf'], 'web-session');
    await service.whenIdle();

    currentView = accountBView;
    service.handleSessionChanged(accountBView);
    await service.queuePaths(['/managed/web/Account-B.pdf'], 'web-session');
    await service.whenIdle();
    expect(service.snapshot().items).toEqual([
      expect.objectContaining({ id: 'local-b', fileName: 'Account-B.pdf' }),
    ]);

    currentView = accountAView;
    service.handleSessionChanged(accountAView);
    await service.whenIdle();
    expect(service.snapshot().items).toEqual([
      expect.objectContaining({ id: 'local-a', fileName: 'Account-A.pdf' }),
    ]);

    await service.cancelUpload('local-a');
    expect(service.snapshot().items).toEqual([
      expect.objectContaining({ id: 'local-a', state: 'cancelled' }),
    ]);
    expect(
      submitPublicCommand.mock.calls.find(
        ([request]) =>
          request.command === 'knowledge.upload.file.cancel' &&
          request.payload?.uploadId === 'upload-server-batch-request-a',
      ),
    ).toBeDefined();

    currentView = accountBView;
    service.handleSessionChanged(accountBView);
    expect(service.snapshot().items).toEqual([
      expect.objectContaining({ id: 'local-b', state: 'uploading' }),
    ]);
    expect(store.current().entries).toHaveLength(2);
  });

  it('does not overwrite a ready queue item while its durable cancellation is pending', async () => {
    const checksum = manifest().checksum;
    const signedOutView = {
      ...view,
      state: 'signed-out' as const,
      accountId: null,
      username: null,
      displayName: null,
      role: null,
      capabilities: [],
      deviceId: null,
    };
    const store = queueStore({
      version: 2,
      restartRecovery: true,
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
          localSourceId: view.deviceId,
          cancelRequested: true,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [0],
          state: 'ready',
          safeError: 'offline',
          retryCount: 0,
        },
      ],
    });
    const { runtime } = commandRuntime([
      manifest({ state: 'ready', missingChunkIndexes: [], revision: 1 }),
    ]);
    runtime.getView.mockReturnValue(signedOutView);
    const inspectCandidate = vi.fn(async () => candidate('/private/work/Second.pdf'));
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      inspectCandidate,
    });
    await service.start();
    runtime.getView.mockReturnValue(view);

    await expect(service.queuePaths(['/private/work/Second.pdf'], view.deviceId)).resolves.toEqual({
      ok: false,
      error: 'upload-failed',
    });

    expect(inspectCandidate).not.toHaveBeenCalled();
    expect(store.current().entries[0]).toMatchObject({
      cancelRequested: true,
      state: 'ready',
    });
  });

  it('rejects queueing when the initiating account changes during PDF inspection', async () => {
    let releaseInspection!: () => void;
    let inspectionStarted!: () => void;
    const inspectionGate = new Promise<void>((resolve) => {
      releaseInspection = resolve;
    });
    const started = new Promise<void>((resolve) => {
      inspectionStarted = resolve;
    });
    const accountA = commandRuntime();
    const accountBView = {
      ...view,
      accountId: 'account-b',
      username: 'account-b',
      displayName: 'Account B',
      deviceId: 'device-b',
    };
    const accountB = commandRuntime();
    accountB.runtime.getView.mockReturnValue(accountBView);
    let runtime = accountA.runtime;
    const store = queueStore();
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      inspectCandidate: vi.fn(async () => {
        inspectionStarted();
        await inspectionGate;
        return candidate();
      }),
    });

    const selection = service.queuePaths(['/private/work/First.pdf'], view.deviceId);
    await started;
    runtime = accountB.runtime;
    releaseInspection();

    await expect(selection).resolves.toEqual({ ok: false, error: 'unauthorized' });
    expect(store.save).not.toHaveBeenCalled();
    expect(accountA.submitPublicCommand).not.toHaveBeenCalled();
    expect(accountB.submitPublicCommand).not.toHaveBeenCalled();

    await expect(
      service.queuePaths(['/private/work/First.pdf'], accountBView.deviceId),
    ).resolves.toMatchObject({ ok: true });
    await service.whenIdle();
    expect(store.current().entries[0]).toMatchObject({
      accountId: 'account-b',
      localSourceId: 'device-b',
    });
  });

  it('rejects a stale picker result when the same account moves to another device', async () => {
    let releasePicker!: (paths: string[]) => void;
    const picker = new Promise<string[]>((resolve) => {
      releasePicker = resolve;
    });
    const runtime = commandRuntime().runtime;
    const store = queueStore();
    const inspectCandidate = vi.fn(async () => candidate());
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      selectFiles: vi.fn(async () => picker),
      inspectCandidate,
    });
    await service.start();

    const selection = service.selectAndQueue();
    runtime.getView.mockReturnValue({ ...view, deviceId: 'device-2' });
    releasePicker(['/private/work/First.pdf']);

    await expect(selection).resolves.toEqual({ ok: false, error: 'unauthorized' });
    expect(inspectCandidate).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it('revalidates session and paused state before accepting a reselected source', async () => {
    let releasePlanning!: () => void;
    let planningStarted!: () => void;
    const planningGate = new Promise<void>((resolve) => {
      releasePlanning = resolve;
    });
    const started = new Promise<void>((resolve) => {
      planningStarted = resolve;
    });
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
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'paused',
          safeError: 'source-required',
          retryCount: 0,
        },
      ],
    });
    const replacement = candidate('/private/work/First.pdf');
    const { runtime } = commandRuntime([manifest()]);
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      selectFiles: vi.fn(async () => ['/private/work/First.pdf']),
      inspectCandidate: vi.fn(async () => replacement),
      planSource: vi.fn(async () => {
        planningStarted();
        await planningGate;
        return { ...replacement, checksum, chunkCount: 1 };
      }),
    });
    await service.start();

    const reselection = service.reselectSource('local-1');
    await started;
    service.pauseBatch('batch-1');
    releasePlanning();

    await expect(reselection).resolves.toBe(false);
    expect(service.snapshot().items[0]?.state).toBe('paused');
    expect(store.current().entries[0]?.source.canonicalPath).toBe('/private/work/First.pdf');
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

  it('keeps another account upload private and rejects its queue controls', async () => {
    let currentView = view;
    const checksum = manifest().checksum;
    const store = queueStore({
      version: 2,
      restartRecovery: true,
      entries: [
        {
          localId: 'local-a',
          batchRequestId: 'batch-request-a',
          batchId: 'batch-a',
          batchRevision: 1,
          uploadId: 'upload-a',
          uploadRevision: 1,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: { ...candidate('/private/work/Private A.pdf'), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [0],
          state: 'ready',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const { runtime, submitPublicCommand } = commandRuntime();
    runtime.getView.mockImplementation(() => currentView);
    const selectFiles = vi.fn(async () => ['/private/work/Private A.pdf']);
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      selectFiles,
    });

    await service.start();
    expect(service.snapshot().items).toHaveLength(1);

    currentView = { ...view, accountId: 'account-b', username: 'other' };
    service.handleSessionChanged(currentView);
    expect(service.snapshot()).toMatchObject({ activeBatchId: null, items: [] });

    service.pauseBatch('batch-a');
    service.resumeBatch('batch-a');
    service.retryUpload('upload-a');
    await expect(service.reselectSource('upload-a')).resolves.toBe(false);
    await service.cancelUpload('upload-a');
    await service.cancelBatch('batch-a');
    await service.whenIdle();

    expect(selectFiles).not.toHaveBeenCalled();
    expect(submitPublicCommand).not.toHaveBeenCalled();
    expect(store.current().entries[0]).toMatchObject({
      state: 'ready',
      safeError: null,
    });
    expect(store.current().entries[0]).not.toHaveProperty('cancelRequested');

    currentView = view;
    service.handleSessionChanged(currentView);
    expect(service.snapshot().items[0]).toMatchObject({
      id: 'local-a',
      fileName: 'First.pdf',
      state: 'ready',
    });
  });

  it('makes an old device queue inert after the same account is re-paired', async () => {
    let currentView = view;
    let scheduledTask: KnowledgeUploadSchedulerTask | null = null;
    let releaseRead!: () => void;
    let markReadStarted!: () => void;
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve;
    });
    const { runtime, submitPublicCommand } = commandRuntime();
    runtime.getView.mockImplementation(() => currentView);
    const readChunk = vi.fn(async () => {
      markReadStarted();
      await readGate;
      return new TextEncoder().encode('%PDF-first!!');
    });
    const store = queueStore();
    const scheduler = {
      setSessionActive: vi.fn(),
      enqueue: vi.fn((task: KnowledgeUploadSchedulerTask) => {
        scheduledTask = task;
      }),
      whenIdle: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
      inspectCandidate: vi.fn(async () => candidate()),
      planSource: vi.fn(async () => ({
        ...candidate(),
        checksum: manifest().checksum,
        chunkCount: 1,
      })),
      readChunk,
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-1'),
    });

    await service.start();
    await service.queuePaths(['/private/work/First.pdf'], view.deviceId);
    await service.whenIdle();
    expect(scheduledTask?.isEligible()).toBe(true);
    const oldTask = scheduledTask;
    if (!oldTask) throw new Error('scheduler task was not captured');
    const inFlightRead = oldTask.readChunk(0);
    await readStarted;
    const persistedBeforeSwitch = store.current();
    const commandsBeforeSwitch = submitPublicCommand.mock.calls.length;

    currentView = { ...view, deviceId: 'device-2' };
    service.handleSessionChanged(currentView);
    releaseRead();

    expect(scheduledTask?.isEligible()).toBe(false);
    expect(service.snapshot().items).toEqual([]);
    await expect(inFlightRead).rejects.toThrow('upload-session-changed');
    await expect(oldTask.readChunk(0)).rejects.toThrow('upload-session-changed');
    await expect(oldTask.finalize()).rejects.toThrow('upload-session-changed');
    oldTask.onState('queued', null, 0);
    await Promise.resolve();

    expect(readChunk).toHaveBeenCalledOnce();
    expect(submitPublicCommand).toHaveBeenCalledTimes(commandsBeforeSwitch);
    expect(store.current()).toEqual(persistedBeforeSwitch);
  });

  it.each([
    ['another account', { ...view, accountId: 'account-b', username: 'other' }],
    ['a re-paired device', { ...view, deviceId: 'device-2' }],
  ] as const)(
    'does not open an upload source after cancellation switches to %s',
    async (_label, nextView) => {
      let currentView = view;
      let releaseStatus!: () => void;
      let markStatusStarted!: () => void;
      const statusGate = new Promise<void>((resolve) => {
        releaseStatus = resolve;
      });
      const statusStarted = new Promise<void>((resolve) => {
        markStatusStarted = resolve;
      });
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
            uploadId: null,
            uploadRevision: 0,
            accountId: view.accountId,
            deviceId: view.deviceId,
            localSourceId: view.deviceId,
            source: { ...candidate(), checksum: null, chunkCount: 1 },
            acknowledgedChunkIndexes: [],
            state: 'paused',
            safeError: null,
            retryCount: 0,
          },
        ],
      });
      const { runtime, submitPublicCommand } = commandRuntime();
      runtime.getView.mockImplementation(() => currentView);
      submitPublicCommand.mockImplementation(async (request) => {
        if (request.command === 'knowledge.upload.status') {
          markStatusStarted();
          await statusGate;
          return {
            ok: true,
            requestId: 'status',
            value: { batch: batch(), uploads: [] },
          } as const;
        }
        throw new Error(`Unexpected command ${request.command}`);
      });
      const planSource = vi.fn(async () => ({
        ...candidate(),
        checksum,
        chunkCount: 1,
      }));
      const service = new KnowledgeUploadService({
        getRuntime: () => runtime as never,
        store,
        planSource,
      });

      await service.start();
      await service.whenIdle();
      const cancellation = service.cancelUpload('local-1');
      await statusStarted;

      currentView = nextView;
      service.handleSessionChanged(nextView);
      releaseStatus();

      await expect(cancellation).rejects.toThrow('upload-session-changed');
      expect(planSource).not.toHaveBeenCalled();
      expect(store.current().entries[0]).toMatchObject({
        cancelRequested: true,
        state: 'paused',
        safeError: null,
      });
      expect(service.snapshot().items).toEqual([]);
    },
  );

  it('does not send a deferred account A batch cancellation through account B', async () => {
    let releaseStatus!: () => void;
    let markStatusStarted!: () => void;
    const statusGate = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    const statusStarted = new Promise<void>((resolve) => {
      markStatusStarted = resolve;
    });
    const checksum = manifest().checksum;
    const store = queueStore({
      version: 2,
      restartRecovery: true,
      entries: [
        {
          localId: 'local-a',
          batchRequestId: 'batch-request-a',
          batchId: 'batch-1',
          batchRevision: 2,
          uploadId: 'upload-1',
          uploadRevision: 1,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [0],
          state: 'ready',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const accountA = commandRuntime();
    accountA.submitPublicCommand.mockImplementation(async (request) => {
      if (request.command === 'knowledge.upload.status') {
        markStatusStarted();
        await statusGate;
        return {
          ok: true,
          requestId: 'status-a',
          value: { batch: batch({ revision: 2 }), uploads: [] },
        } as const;
      }
      throw new Error(`Unexpected account A command ${request.command}`);
    });
    const accountBView = {
      ...view,
      accountId: 'account-b',
      username: 'account-b',
      displayName: 'Account B',
      deviceId: 'device-b',
    };
    const accountB = commandRuntime();
    accountB.runtime.getView.mockReturnValue(accountBView);
    let runtime = accountA.runtime;
    const scheduler = {
      setSessionActive: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceBatch: vi.fn(async () => undefined),
      retireBatch: vi.fn(),
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
    });

    await service.start();
    const cancellation = service.cancelBatch('batch-1');
    await statusStarted;
    runtime = accountB.runtime;
    service.handleSessionChanged(accountBView);
    releaseStatus();

    await expect(cancellation).rejects.toThrow('upload-session-changed');
    expect(accountA.submitPublicCommand).toHaveBeenCalledOnce();
    expect(accountB.submitPublicCommand).not.toHaveBeenCalled();
    expect(store.current().entries[0]).toMatchObject({
      cancelRequested: true,
      state: 'paused',
      safeError: null,
    });
    expect(service.snapshot().items).toEqual([]);
  });

  it('preserves paused-network through stale status and completes after retry', async () => {
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
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'paused-network',
          safeError: 'offline',
          retryCount: 8,
        },
      ],
    });
    const { runtime } = commandRuntime([manifest()]);
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
      revalidateSource: vi.fn(async () => true),
    });

    await service.start();
    await service.whenIdle();
    await service.refresh();
    expect(service.snapshot().items[0]).toMatchObject({
      state: 'paused-network',
      safeError: 'offline',
    });

    service.retryUpload('local-1');
    await service.whenIdle();
    expect(service.snapshot().items[0]).toMatchObject({
      state: 'assembling',
      acknowledgedChunkCount: 1,
    });
  });

  it('does not auto-resume an exhausted upload after a session cycle until retry', async () => {
    let currentView: PrivilegedSessionView = view;
    let failUpload = true;
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
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'queued',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const { runtime, createPrivilegedRecord } = commandRuntime([manifest()]);
    runtime.getView.mockImplementation(() => currentView as typeof view);
    createPrivilegedRecord.mockImplementation(async () => {
      if (failUpload) {
        throw Object.assign(new Error('offline'), { status: 0, code: 'offline' });
      }
      return { id: 'chunk-1' };
    });
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: new KnowledgeUploadScheduler({
        maxRetries: 1,
        sleep: vi.fn(async () => undefined),
      }),
      revalidateSource: vi.fn(async () => true),
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
    });

    await service.start();
    await service.whenIdle();
    expect(createPrivilegedRecord).toHaveBeenCalledOnce();
    expect(service.snapshot().items[0]).toMatchObject({
      state: 'paused-network',
      safeError: 'offline',
    });

    currentView = {
      ...view,
      state: 'signed-out',
      accountId: null,
      username: null,
      displayName: null,
      role: null,
      capabilities: [],
      deviceId: null,
    };
    service.handleSessionChanged(currentView);
    currentView = view;
    service.handleSessionChanged(currentView);
    await service.whenIdle();

    expect(createPrivilegedRecord).toHaveBeenCalledOnce();
    expect(service.snapshot().items[0]).toMatchObject({
      state: 'paused-network',
      safeError: 'offline',
    });

    failUpload = false;
    service.retryUpload('local-1');
    await service.whenIdle();

    expect(createPrivilegedRecord).toHaveBeenCalledTimes(2);
    expect(service.snapshot().items[0]).toMatchObject({
      state: 'assembling',
      acknowledgedChunkCount: 1,
    });
  });

  it.each([
    ['source-required', 'source-required'],
    ['failed', 'upload-failed'],
  ] as const)(
    'preserves local %s while the server still reports uploading',
    async (state, safeError) => {
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
            localSourceId: view.deviceId,
            source: { ...candidate(), checksum, chunkCount: 1 },
            acknowledgedChunkIndexes: [],
            state,
            safeError,
            retryCount: 0,
          },
        ],
      });
      const { runtime } = commandRuntime([manifest()]);
      const revalidateSource = vi.fn(async () => true);
      const service = new KnowledgeUploadService({
        getRuntime: () => runtime as never,
        store,
        revalidateSource,
      });

      await service.start();
      await service.whenIdle();
      await service.refresh();

      expect(service.snapshot().items[0]).toMatchObject({ state, safeError });
      expect(revalidateSource).not.toHaveBeenCalled();
    },
  );

  it('replays a lost batch begin before cancelling the file it created', async () => {
    let rejectFirstBegin!: (error: Error) => void;
    let markFirstBegin!: () => void;
    const firstBegin = new Promise<void>((resolve) => {
      markFirstBegin = resolve;
    });
    const beginPayloads: Record<string, unknown>[] = [];
    let beginCalls = 0;
    let upload: KnowledgeUploadManifestView | null = null;
    const submitPublicCommand = vi.fn(
      async (request: { command: string; payload?: Record<string, unknown> }) => {
        if (request.command === 'knowledge.upload.batch.begin') {
          beginCalls += 1;
          beginPayloads.push(structuredClone(request.payload ?? {}));
          if (beginCalls === 1) {
            markFirstBegin();
            return new Promise<never>((_resolve, reject) => {
              rejectFirstBegin = reject;
            });
          }
          return { ok: true, requestId: 'batch-replay', value: batch() } as const;
        }
        if (request.command === 'knowledge.upload.status') {
          return {
            ok: true,
            requestId: 'status',
            value: { batch: batch(), uploads: upload ? [upload] : [] },
          } as const;
        }
        if (request.command === 'knowledge.upload.file.begin') {
          upload = manifest();
          return { ok: true, requestId: 'file-begin', value: upload } as const;
        }
        if (request.command === 'knowledge.upload.file.cancel') {
          return { ok: true, requestId: 'file-cancel', value: undefined } as const;
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
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceUpload: vi.fn(async () => undefined),
      retireUpload: vi.fn(),
    };
    const store = queueStore();
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
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
    await firstBegin;
    const cancellation = service.cancelUpload('local-1');
    await Promise.resolve();
    expect(store.current().entries[0]).toMatchObject({
      cancelRequested: true,
      state: 'paused',
    });
    rejectFirstBegin(Object.assign(new Error('offline'), { status: 0, code: 'offline' }));
    await cancellation;
    await service.whenIdle();

    expect(beginPayloads).toEqual([
      { requestId: 'batch-request-1', fileCount: 1, totalBytes: 12 },
      { requestId: 'batch-request-1', fileCount: 1, totalBytes: 12 },
    ]);
    expect(submitPublicCommand.mock.calls.map(([request]) => request.command)).toEqual([
      'knowledge.upload.batch.begin',
      'knowledge.upload.batch.begin',
      'knowledge.upload.status',
      'knowledge.upload.file.begin',
      'knowledge.upload.file.cancel',
    ]);
    expect(store.current().entries[0]).toMatchObject({
      batchId: 'batch-1',
      uploadId: 'upload-1',
      state: 'cancelled',
    });
  });

  it('replays a lost batch begin before cancelling the whole batch', async () => {
    let rejectFirstBegin!: (error: Error) => void;
    let markFirstBegin!: () => void;
    const firstBegin = new Promise<void>((resolve) => {
      markFirstBegin = resolve;
    });
    const beginPayloads: Record<string, unknown>[] = [];
    let beginCalls = 0;
    const submitPublicCommand = vi.fn(
      async (request: { command: string; payload?: Record<string, unknown> }) => {
        if (request.command === 'knowledge.upload.batch.begin') {
          beginCalls += 1;
          beginPayloads.push(structuredClone(request.payload ?? {}));
          if (beginCalls === 1) {
            markFirstBegin();
            return new Promise<never>((_resolve, reject) => {
              rejectFirstBegin = reject;
            });
          }
          return {
            ok: true,
            requestId: 'batch-replay',
            value: batch({ fileCount: 2, totalBytes: 24 }),
          } as const;
        }
        if (request.command === 'knowledge.upload.status') {
          return {
            ok: true,
            requestId: 'status',
            value: {
              batch: batch({ fileCount: 2, totalBytes: 24 }),
              uploads: [],
            },
          } as const;
        }
        if (request.command === 'knowledge.upload.batch.cancel') {
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
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceBatch: vi.fn(async () => undefined),
      retireBatch: vi.fn(),
    };
    const store = queueStore();
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
        .mockReturnValueOnce('local-first')
        .mockReturnValueOnce('local-second'),
    });

    await service.queuePaths(
      ['/private/work/First.pdf', '/private/work/Second.pdf'],
      view.deviceId,
    );
    await firstBegin;
    const cancellation = service.cancelBatch('batch-request-1');
    await Promise.resolve();
    expect(store.current().entries).toEqual([
      expect.objectContaining({ cancelRequested: true, state: 'paused' }),
      expect.objectContaining({ cancelRequested: true, state: 'paused' }),
    ]);
    rejectFirstBegin(Object.assign(new Error('offline'), { status: 0, code: 'offline' }));
    await cancellation;
    await service.whenIdle();

    expect(beginPayloads).toEqual([
      { requestId: 'batch-request-1', fileCount: 2, totalBytes: 24 },
      { requestId: 'batch-request-1', fileCount: 2, totalBytes: 24 },
    ]);
    expect(submitPublicCommand.mock.calls.map(([request]) => request.command)).toEqual([
      'knowledge.upload.batch.begin',
      'knowledge.upload.batch.begin',
      'knowledge.upload.status',
      'knowledge.upload.batch.cancel',
    ]);
    expect(store.current().entries).toEqual([
      expect.objectContaining({ batchId: 'batch-1', state: 'cancelled' }),
      expect.objectContaining({ batchId: 'batch-1', state: 'cancelled' }),
    ]);
  });

  it('materializes an early-cancelled first sibling in the original batch declaration', async () => {
    let releaseFirstPlan!: () => void;
    let markFirstPlan!: () => void;
    let releaseSecondPlan!: () => void;
    let markSecondPlan!: () => void;
    const firstPlanStarted = new Promise<void>((resolve) => {
      markFirstPlan = resolve;
    });
    const firstPlanGate = new Promise<void>((resolve) => {
      releaseFirstPlan = resolve;
    });
    const secondPlanStarted = new Promise<void>((resolve) => {
      markSecondPlan = resolve;
    });
    const secondPlanGate = new Promise<void>((resolve) => {
      releaseSecondPlan = resolve;
    });
    const commands: Array<{ command: string; fileName?: string }> = [];
    let uploadRevision = 0;
    const uploads: KnowledgeUploadManifestView[] = [];
    const submitPublicCommand = vi.fn(
      async (request: { command: string; payload?: Record<string, unknown> }) => {
        commands.push({
          command: request.command,
          ...(request.payload?.fileName ? { fileName: String(request.payload.fileName) } : {}),
        });
        if (request.command === 'knowledge.upload.batch.begin') {
          return {
            ok: true,
            requestId: 'batch-begin',
            value: batch({ fileCount: 2, totalBytes: 24 }),
          } as const;
        }
        if (request.command === 'knowledge.upload.status') {
          return {
            ok: true,
            requestId: 'status',
            value: {
              batch: batch({ fileCount: 2, totalBytes: 24 }),
              uploads,
            },
          } as const;
        }
        if (request.command === 'knowledge.upload.file.begin') {
          const fileName = String(request.payload?.fileName);
          const created = manifest({
            id: fileName === 'First.pdf' ? 'upload-first' : 'upload-second',
            fileName,
            revision: uploadRevision,
          });
          uploads.push(created);
          return { ok: true, requestId: `begin-${fileName}`, value: created } as const;
        }
        if (request.command === 'knowledge.upload.file.cancel') {
          const target = uploads.find(({ id }) => id === String(request.payload?.uploadId));
          if (target) {
            uploadRevision += 1;
            Object.assign(target, {
              state: 'cancelled',
              revision: uploadRevision,
            });
          }
          return { ok: true, requestId: 'file-cancel', value: undefined } as const;
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
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceUpload: vi.fn(async () => undefined),
      retireUpload: vi.fn(),
    };
    const planCalls = new Map<string, number>();
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store: queueStore(),
      scheduler: scheduler as never,
      inspectCandidate: vi.fn(async (path: string) => {
        const value = candidate(path);
        value.fileName = path.includes('Second') ? 'Second.pdf' : 'First.pdf';
        return value;
      }),
      planSource: vi.fn(async (value) => {
        const call = (planCalls.get(value.fileName) ?? 0) + 1;
        planCalls.set(value.fileName, call);
        if (value.fileName === 'First.pdf' && call === 1) {
          markFirstPlan();
          await firstPlanGate;
        }
        if (value.fileName === 'Second.pdf') {
          markSecondPlan();
          await secondPlanGate;
        }
        return { ...value, checksum: manifest().checksum, chunkCount: 1 };
      }),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-first')
        .mockReturnValueOnce('local-second'),
    });

    await service.queuePaths(
      ['/private/work/First.pdf', '/private/work/Second.pdf'],
      view.deviceId,
    );
    await firstPlanStarted;
    const cancellation = service.cancelUpload('local-first');
    releaseFirstPlan();
    await secondPlanStarted;
    await cancellation;

    expect(commands).toEqual([
      { command: 'knowledge.upload.batch.begin' },
      { command: 'knowledge.upload.status' },
      { command: 'knowledge.upload.file.begin', fileName: 'First.pdf' },
      { command: 'knowledge.upload.file.cancel' },
    ]);
    expect(uploads).toEqual([expect.objectContaining({ id: 'upload-first', state: 'cancelled' })]);

    releaseSecondPlan();
    await service.whenIdle();

    expect(commands).toEqual([
      { command: 'knowledge.upload.batch.begin' },
      { command: 'knowledge.upload.status' },
      { command: 'knowledge.upload.file.begin', fileName: 'First.pdf' },
      { command: 'knowledge.upload.file.cancel' },
      { command: 'knowledge.upload.status' },
      { command: 'knowledge.upload.file.begin', fileName: 'Second.pdf' },
    ]);
    expect(uploads).toEqual([
      expect.objectContaining({ id: 'upload-first', state: 'cancelled' }),
      expect.objectContaining({ id: 'upload-second', state: 'uploading' }),
    ]);
    expect(service.snapshot().items).toEqual([
      expect.objectContaining({ id: 'local-first', state: 'cancelled' }),
      expect.objectContaining({ id: 'local-second', state: 'uploading' }),
    ]);
    expect(
      submitPublicCommand.mock.calls.some(
        ([request]) => request.command === 'knowledge.upload.batch.cancel',
      ),
    ).toBe(false);
  });

  it('queues with the new device source and restores it after re-pairing', async () => {
    const checksum = manifest().checksum;
    const repairedView = { ...view, deviceId: 'device-2' };
    const store = queueStore({
      version: 2,
      restartRecovery: true,
      entries: [
        {
          localId: 'local-old',
          batchRequestId: 'batch-request-old',
          batchId: 'batch-old',
          batchRevision: 0,
          uploadId: 'upload-old',
          uploadRevision: 0,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: { ...candidate('/private/work/Old.pdf'), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'paused',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const firstRuntime = commandRuntime();
    firstRuntime.runtime.getView.mockReturnValue(repairedView);
    const firstScheduler = {
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => firstRuntime.runtime as never,
      store,
      scheduler: firstScheduler as never,
      inspectCandidate: vi.fn(async () => candidate('/private/work/New.pdf')),
      planSource: vi.fn(async () => ({
        ...candidate('/private/work/New.pdf'),
        checksum,
        chunkCount: 1,
      })),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-new'),
    });

    await service.start();
    expect(service.snapshot().items).toEqual([]);
    await expect(
      service.queuePaths(['/private/work/New.pdf'], repairedView.deviceId),
    ).resolves.toMatchObject({ ok: true });
    await service.whenIdle();

    expect(store.current().entries).toEqual([
      expect.objectContaining({
        localId: 'local-old',
        deviceId: 'device-1',
        localSourceId: 'device-1',
        state: 'paused',
      }),
      expect.objectContaining({
        localId: 'local-new',
        deviceId: 'device-2',
        localSourceId: 'device-2',
        state: 'uploading',
      }),
    ]);
    expect(service.snapshot().items).toEqual([
      expect.objectContaining({ id: 'local-new', state: 'uploading' }),
    ]);
    await service.dispose();

    const restoredRuntime = commandRuntime([manifest()]);
    restoredRuntime.runtime.getView.mockReturnValue(repairedView);
    const restoredScheduler = {
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      dispose: vi.fn(async () => undefined),
    };
    const restored = new KnowledgeUploadService({
      getRuntime: () => restoredRuntime.runtime as never,
      store,
      scheduler: restoredScheduler as never,
      revalidateSource: vi.fn(async () => true),
    });

    await restored.start();
    await restored.whenIdle();

    expect(restored.snapshot().items).toEqual([
      expect.objectContaining({ id: 'local-new', state: 'uploading' }),
    ]);
    expect(store.current().entries.find(({ localId }) => localId === 'local-new')).toMatchObject({
      deviceId: 'device-2',
      localSourceId: 'device-2',
    });
  });

  it('allows a new device batch while preserving a full foreign-device batch', async () => {
    const checksum = manifest().checksum;
    const repairedView = { ...view, deviceId: 'device-2' };
    const foreignEntries: KnowledgeUploadQueueState['entries'] = Array.from(
      { length: KNOWLEDGE_UPLOAD_MAX_FILES },
      (_, index) => ({
        localId: `local-old-${index}`,
        batchRequestId: 'batch-request-old',
        batchId: 'batch-old',
        batchRevision: 0,
        uploadId: `upload-old-${index}`,
        uploadRevision: 0,
        accountId: view.accountId,
        deviceId: view.deviceId,
        localSourceId: view.deviceId,
        source: {
          ...candidate(`/private/work/Old-${index}.pdf`),
          fileName: `Old-${index}.pdf`,
          checksum,
          chunkCount: 1,
        },
        acknowledgedChunkIndexes: [],
        state: 'paused',
        safeError: null,
        retryCount: 0,
      }),
    );
    const store = queueStore({
      version: 2,
      restartRecovery: true,
      entries: foreignEntries,
    });
    const { runtime } = commandRuntime();
    runtime.getView.mockReturnValue(repairedView);
    const scheduler = {
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
      inspectCandidate: vi.fn(async () => candidate('/private/work/New.pdf')),
      planSource: vi.fn(async () => ({
        ...candidate('/private/work/New.pdf'),
        checksum,
        chunkCount: 1,
      })),
      createId: vi
        .fn<() => string>()
        .mockReturnValueOnce('batch-request-1')
        .mockReturnValueOnce('local-new'),
    });

    await service.start();
    await expect(
      service.queuePaths(['/private/work/New.pdf'], repairedView.deviceId),
    ).resolves.toMatchObject({ ok: true });
    await service.whenIdle();

    expect(store.current().entries).toHaveLength(KNOWLEDGE_UPLOAD_MAX_FILES + 1);
    expect(store.current().entries.slice(0, KNOWLEDGE_UPLOAD_MAX_FILES)).toEqual(foreignEntries);
    expect(store.current().entries.at(-1)).toMatchObject({
      localId: 'local-new',
      deviceId: 'device-2',
      localSourceId: 'device-2',
    });
  });

  it('admits only one overlapping queue selection for the same session', async () => {
    let releaseFirstInspection!: () => void;
    let markFirstInspection!: () => void;
    const firstInspectionGate = new Promise<void>((resolve) => {
      releaseFirstInspection = resolve;
    });
    const firstInspectionStarted = new Promise<void>((resolve) => {
      markFirstInspection = resolve;
    });
    const { runtime, submitPublicCommand } = commandRuntime();
    const scheduler = {
      setSessionActive: vi.fn(),
      enqueue: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
    };
    const store = queueStore();
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
      inspectCandidate: vi.fn(async (path: string) => {
        const value = candidate(path);
        value.fileName = path.includes('Second') ? 'Second.pdf' : 'First.pdf';
        if (value.fileName === 'First.pdf') {
          markFirstInspection();
          await firstInspectionGate;
        }
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
        .mockReturnValueOnce('local-second'),
    });

    const first = service.queuePaths(['/private/work/First.pdf'], view.deviceId);
    await firstInspectionStarted;
    const second = service.queuePaths(['/private/work/Second.pdf'], view.deviceId);
    await expect(second).resolves.toMatchObject({
      ok: true,
      uploads: [expect.objectContaining({ id: 'local-second', fileName: 'Second.pdf' })],
    });
    releaseFirstInspection();
    await expect(first).resolves.toEqual({ ok: false, error: 'upload-failed' });
    await service.whenIdle();

    expect(store.current().entries).toEqual([
      expect.objectContaining({
        localId: 'local-second',
        source: expect.objectContaining({ fileName: 'Second.pdf' }),
      }),
    ]);
    expect(
      submitPublicCommand.mock.calls.filter(
        ([request]) => request.command === 'knowledge.upload.batch.begin',
      ),
    ).toHaveLength(1);
  });

  it('uses an active sibling to cancel a batch whose first sibling is already cancelled', async () => {
    const checksum = manifest().checksum;
    const store = queueStore({
      version: 2,
      restartRecovery: true,
      entries: [
        {
          localId: 'local-cancelled',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 2,
          uploadId: 'upload-cancelled',
          uploadRevision: 2,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: {
            ...candidate('/private/work/Cancelled.pdf'),
            fileName: 'Cancelled.pdf',
            checksum,
            chunkCount: 1,
          },
          acknowledgedChunkIndexes: [0],
          state: 'cancelled',
          safeError: null,
          retryCount: 0,
        },
        {
          localId: 'local-active',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 2,
          uploadId: 'upload-active',
          uploadRevision: 1,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: {
            ...candidate('/private/work/Active.pdf'),
            fileName: 'Active.pdf',
            checksum,
            chunkCount: 1,
          },
          acknowledgedChunkIndexes: [],
          state: 'paused',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const { runtime, submitPublicCommand } = commandRuntime();
    submitPublicCommand.mockImplementation(async (request) => {
      if (request.command === 'knowledge.upload.status') {
        return {
          ok: true,
          requestId: 'status',
          value: { batch: batch({ revision: 2 }), uploads: [] },
        } as const;
      }
      if (request.command === 'knowledge.upload.batch.cancel') {
        return { ok: true, requestId: 'cancel-batch', value: undefined } as const;
      }
      throw new Error(`Unexpected command ${request.command}`);
    });
    const scheduler = {
      setSessionActive: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceBatch: vi.fn(async () => undefined),
      retireBatch: vi.fn(),
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
    });

    await service.start();
    await service.whenIdle();
    await service.cancelBatch('batch-1');

    expect(store.current().entries).toEqual([
      expect.objectContaining({
        localId: 'local-cancelled',
        state: 'cancelled',
        uploadRevision: 2,
      }),
      expect.objectContaining({
        localId: 'local-active',
        state: 'cancelled',
      }),
    ]);
    expect(store.current().entries[0]).not.toHaveProperty('cancelRequested');
    expect(store.current().entries[1]).not.toHaveProperty('cancelRequested');
    expect(submitPublicCommand).toHaveBeenCalledWith({
      command: 'knowledge.upload.batch.cancel',
      payload: { batchId: 'batch-1', expectedRevision: 2 },
      expectedRevision: null,
    });
  });

  it('cancels remaining files individually when a batch already has a published sibling', async () => {
    const checksum = manifest().checksum;
    const store = queueStore({
      version: 2,
      restartRecovery: true,
      entries: [
        {
          localId: 'local-published',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 2,
          uploadId: 'upload-published',
          uploadRevision: 2,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: {
            ...candidate('/private/work/Published.pdf'),
            fileName: 'Published.pdf',
            checksum,
            chunkCount: 1,
          },
          acknowledgedChunkIndexes: [0],
          state: 'published',
          safeError: null,
          retryCount: 0,
        },
        {
          localId: 'local-active',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 2,
          uploadId: 'upload-active',
          uploadRevision: 1,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: {
            ...candidate('/private/work/Active.pdf'),
            fileName: 'Active.pdf',
            checksum,
            chunkCount: 1,
          },
          acknowledgedChunkIndexes: [],
          state: 'paused',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const { runtime, submitPublicCommand } = commandRuntime();
    submitPublicCommand.mockImplementation(async (request) => {
      if (request.command === 'knowledge.upload.status') {
        return {
          ok: true,
          requestId: 'status',
          value: { batch: batch({ revision: 2 }), uploads: [] },
        } as const;
      }
      if (request.command === 'knowledge.upload.file.cancel') {
        return { ok: true, requestId: 'cancel-file', value: undefined } as const;
      }
      throw new Error(`Unexpected command ${request.command}`);
    });
    const scheduler = {
      setSessionActive: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceUpload: vi.fn(async () => undefined),
      retireUpload: vi.fn(),
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
    });

    await service.start();
    await service.whenIdle();
    await service.cancelBatch('batch-1');

    expect(store.current().entries).toEqual([
      expect.objectContaining({
        localId: 'local-published',
        state: 'published',
        uploadRevision: 2,
      }),
      expect.objectContaining({
        localId: 'local-active',
        state: 'cancelled',
      }),
    ]);
    expect(store.current().entries[0]).not.toHaveProperty('cancelRequested');
    expect(store.current().entries[1]).not.toHaveProperty('cancelRequested');
    expect(submitPublicCommand).toHaveBeenCalledWith({
      command: 'knowledge.upload.file.cancel',
      payload: { uploadId: 'upload-active', expectedRevision: 1 },
      expectedRevision: null,
    });
    expect(
      submitPublicCommand.mock.calls.some(
        ([request]) => request.command === 'knowledge.upload.batch.cancel',
      ),
    ).toBe(false);
  });

  it('falls back to file cancellation when batch status reveals a newly published sibling', async () => {
    const checksum = manifest().checksum;
    const secondCandidate = candidate('/private/work/Second.pdf');
    secondCandidate.fileName = 'Second.pdf';
    const store = queueStore({
      version: 2,
      restartRecovery: true,
      entries: [
        {
          localId: 'local-first',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 2,
          uploadId: 'upload-first',
          uploadRevision: 1,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: { ...candidate(), checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [0],
          state: 'ready',
          safeError: null,
          retryCount: 0,
        },
        {
          localId: 'local-second',
          batchRequestId: 'batch-request-1',
          batchId: 'batch-1',
          batchRevision: 2,
          uploadId: 'upload-second',
          uploadRevision: 1,
          accountId: view.accountId,
          deviceId: view.deviceId,
          localSourceId: view.deviceId,
          source: { ...secondCandidate, checksum, chunkCount: 1 },
          acknowledgedChunkIndexes: [],
          state: 'ready',
          safeError: null,
          retryCount: 0,
        },
      ],
    });
    const authoritativeUploads = [
      manifest({
        id: 'upload-first',
        state: 'published',
        missingChunkIndexes: [],
        revision: 2,
      }),
      manifest({
        id: 'upload-second',
        fileName: 'Second.pdf',
        state: 'uploading',
        revision: 2,
      }),
    ];
    const { runtime, submitPublicCommand } = commandRuntime();
    submitPublicCommand.mockImplementation(async (request) => {
      if (request.command === 'knowledge.upload.status') {
        return {
          ok: true,
          requestId: 'status',
          value: {
            batch: batch({ fileCount: 2, totalBytes: 24, revision: 3 }),
            uploads: authoritativeUploads,
          },
        } as const;
      }
      if (request.command === 'knowledge.upload.file.cancel') {
        return { ok: true, requestId: 'cancel-file', value: undefined } as const;
      }
      throw new Error(`Unexpected command ${request.command}`);
    });
    const scheduler = {
      setSessionActive: vi.fn(),
      whenIdle: vi.fn(async () => undefined),
      quiesceBatch: vi.fn(async () => undefined),
      retireBatch: vi.fn(),
      quiesceUpload: vi.fn(async () => undefined),
      retireUpload: vi.fn(),
    };
    const service = new KnowledgeUploadService({
      getRuntime: () => runtime as never,
      store,
      scheduler: scheduler as never,
    });

    await service.start();
    await service.cancelBatch('batch-1');

    expect(store.current().entries).toEqual([
      expect.objectContaining({ localId: 'local-first', state: 'published' }),
      expect.objectContaining({ localId: 'local-second', state: 'cancelled' }),
    ]);
    expect(submitPublicCommand).toHaveBeenCalledWith({
      command: 'knowledge.upload.file.cancel',
      payload: { uploadId: 'upload-second', expectedRevision: 2 },
      expectedRevision: null,
    });
    expect(
      submitPublicCommand.mock.calls.some(
        ([request]) => request.command === 'knowledge.upload.batch.cancel',
      ),
    ).toBe(false);
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
