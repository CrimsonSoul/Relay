import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KNOWLEDGE_UPLOAD_CHUNK_BYTES,
  type KnowledgeUploadBatchStatusView,
  type KnowledgeUploadBatchView,
  type KnowledgeUploadManifestView,
} from '@shared/knowledge';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import type { PrivilegedCommandResult } from '@shared/privilegedCommands';
import type { KnowledgeUploadQueueState } from '../knowledge/KnowledgeUploadQueueStore';
import { KnowledgeUploadService } from '../knowledge/KnowledgeUploadService';

const mocks = vi.hoisted(() => ({
  getPrivilegedRuntime: vi.fn(),
  setPrivilegedRuntime: vi.fn(),
  getPrivilegedHost: vi.fn(),
  setPrivilegedHost: vi.fn(),
  notifyKnowledgeUploadSessionChanged: vi.fn(),
}));

vi.mock('./appState', () => mocks);
vi.mock('electron', () => ({ dialog: { showOpenDialog: vi.fn() } }));

const oldView: PrivilegedSessionView = {
  state: 'active',
  accountId: 'account-admin',
  username: 'ryan',
  displayName: 'Ryan Bledsoe',
  role: 'admin',
  capabilities: ['knowledge.manage'],
  deviceId: 'device-1',
  expiresAt: '2026-08-03T18:00:00.000Z',
};

const newView: PrivilegedSessionView = {
  ...oldView,
  expiresAt: '2026-08-03T19:00:00.000Z',
};

const createdAt = '2026-08-03T15:00:00.000Z';
const checksum = createHash('sha256').update('%PDF-first!!').digest('hex');

function batch(): KnowledgeUploadBatchView {
  return {
    id: 'batch-1',
    requestId: 'batch-request-1',
    fileCount: 1,
    totalBytes: 12,
    state: 'active',
    createdAt,
    lastActivityAt: createdAt,
    expiresAt: '2026-08-10T15:00:00.000Z',
    revision: 0,
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
    checksum,
    chunkSize: KNOWLEDGE_UPLOAD_CHUNK_BYTES,
    chunkCount: 1,
    missingChunkIndexes: [0],
    state: 'uploading',
    proposedTitle: '',
    proposedCategory: '',
    proposedCategoryId: null,
    proposedDocumentType: 'sop',
    pageCount: null,
    outline: [],
    outlineSource: null,
    duplicateDocumentId: null,
    safeError: null,
    lastActivityAt: createdAt,
    readyAt: null,
    expiresAt: '2026-08-10T15:00:00.000Z',
    revision: 0,
    ...overrides,
  };
}

function uploadRuntime(view: PrivilegedSessionView) {
  const createPrivilegedRecord = vi.fn(async () => ({ id: 'chunk-1' }));
  const submitPublicCommand = vi.fn(
    async (request: { command: string }): Promise<PrivilegedCommandResult> => {
      if (request.command === 'knowledge.upload.status') {
        const value: KnowledgeUploadBatchStatusView = { batch: batch(), uploads: [manifest()] };
        return { ok: true, requestId: 'request', value };
      }
      if (request.command === 'knowledge.upload.file.finalize') {
        return {
          ok: true,
          requestId: 'request',
          value: manifest({ state: 'assembling', missingChunkIndexes: [], revision: 1 }),
        };
      }
      throw new Error(`Unexpected command ${request.command}`);
    },
  );
  return {
    runtime: {
      getView: vi.fn(() => view),
      createPrivilegedRecord,
      submitPublicCommand,
      dispose: vi.fn(async () => undefined),
    },
    createPrivilegedRecord,
  };
}

function queueStore(initial: KnowledgeUploadQueueState) {
  let current = structuredClone(initial);
  return {
    load: vi.fn(async () => structuredClone(current)),
    save: vi.fn(async (next: KnowledgeUploadQueueState) => {
      current = structuredClone(next);
    }),
  };
}

describe('privileged runtime lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setPrivilegedRuntime.mockImplementation((runtime) => {
      mocks.getPrivilegedRuntime.mockReturnValue(runtime);
    });
    mocks.setPrivilegedHost.mockImplementation((host) => {
      mocks.getPrivilegedHost.mockReturnValue(host);
    });
    mocks.notifyKnowledgeUploadSessionChanged.mockImplementation(() => undefined);
  });

  it('publishes signed-out before disposal and the active view after same-identity replacement', async () => {
    const events = [`notify:${oldView.state}:${oldView.expiresAt}`];
    const oldRuntime = {
      dispose: vi.fn(async () => {
        events.push('dispose:old-runtime');
      }),
    };
    const nextRuntime = {
      getView: vi.fn(() => newView),
      dispose: vi.fn(),
    };
    mocks.getPrivilegedRuntime.mockReturnValue(oldRuntime);
    mocks.getPrivilegedHost.mockReturnValue(null);
    mocks.setPrivilegedRuntime.mockImplementation((runtime) => {
      events.push(runtime ? 'install:runtime' : 'clear:runtime');
      mocks.getPrivilegedRuntime.mockReturnValue(runtime);
    });
    mocks.setPrivilegedHost.mockImplementation((host) => {
      events.push(host ? 'install:host' : 'clear:host');
      mocks.getPrivilegedHost.mockReturnValue(host);
    });
    mocks.notifyKnowledgeUploadSessionChanged.mockImplementation((view: PrivilegedSessionView) => {
      events.push(`notify:${view.state}:${view.expiresAt}`);
    });
    const { replacePrivilegedRuntime } = await import('./privilegedRuntimeLifecycle');

    await replacePrivilegedRuntime(async () => {
      events.push('factory:next');
      return { host: null, runtime: nextRuntime as never };
    });

    expect(events).toEqual([
      'notify:active:2026-08-03T18:00:00.000Z',
      'clear:runtime',
      'clear:host',
      'notify:signed-out:null',
      'dispose:old-runtime',
      'factory:next',
      'clear:host',
      'install:runtime',
      'notify:active:2026-08-03T19:00:00.000Z',
    ]);
  });

  it('disposes the host instead of separately disposing its owned runtime', async () => {
    const runtime = { dispose: vi.fn() };
    const host = { dispose: vi.fn(async () => undefined) };
    mocks.getPrivilegedRuntime.mockReturnValue(runtime);
    mocks.getPrivilegedHost.mockReturnValue(host);
    const { stopPrivilegedRuntime } = await import('./privilegedRuntimeLifecycle');

    await stopPrivilegedRuntime();

    expect(host.dispose).toHaveBeenCalledOnce();
    expect(runtime.dispose).not.toHaveBeenCalled();
  });

  it('remains signed out when replacement construction fails', async () => {
    const runtime = { dispose: vi.fn() };
    mocks.getPrivilegedRuntime.mockReturnValue(runtime);
    mocks.getPrivilegedHost.mockReturnValue(null);
    const { replacePrivilegedRuntime } = await import('./privilegedRuntimeLifecycle');

    await expect(
      replacePrivilegedRuntime(async () => {
        throw new Error('factory-failed');
      }),
    ).rejects.toThrow('factory-failed');

    expect(mocks.setPrivilegedRuntime).toHaveBeenCalledWith(null);
    expect(mocks.setPrivilegedHost).toHaveBeenCalledWith(null);
    expect(mocks.notifyKnowledgeUploadSessionChanged).toHaveBeenCalledOnce();
  });

  it('resumes interrupted upload preparation when the replacement has the same identity', async () => {
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
          accountId: oldView.accountId!,
          deviceId: oldView.deviceId!,
          source: {
            canonicalPath: '/private/work/First.pdf',
            fileName: 'First.pdf',
            byteSize: 12,
            modifiedMs: 100,
            device: 1,
            inode: 2,
            checksum,
            chunkCount: 1,
          },
          acknowledgedChunkIndexes: [],
          state: 'paused-network',
          safeError: 'offline',
          retryCount: 1,
        },
      ],
    });
    const interrupted = uploadRuntime(oldView);
    let rejectInterrupted!: (reason: unknown) => void;
    interrupted.createPrivilegedRecord.mockImplementationOnce(
      async () =>
        new Promise<never>((_resolve, reject) => {
          rejectInterrupted = reject;
        }),
    );
    interrupted.runtime.dispose.mockImplementationOnce(async () => {
      rejectInterrupted(Object.assign(new Error('old-session-closed'), { status: 400 }));
    });
    const resumed = uploadRuntime(newView);
    mocks.getPrivilegedRuntime.mockReturnValue(interrupted.runtime);
    mocks.getPrivilegedHost.mockReturnValue(null);
    const service = new KnowledgeUploadService({
      getRuntime: () => mocks.getPrivilegedRuntime() as never,
      store,
      revalidateSource: vi.fn(async () => true),
      readChunk: vi.fn(async () => new TextEncoder().encode('%PDF-first!!')),
    });
    mocks.notifyKnowledgeUploadSessionChanged.mockImplementation((view: PrivilegedSessionView) => {
      service.handleSessionChanged(view);
    });
    await service.start();
    service.retryUpload('local-1');
    await vi.waitFor(() => expect(interrupted.createPrivilegedRecord).toHaveBeenCalledOnce());
    const { replacePrivilegedRuntime } = await import('./privilegedRuntimeLifecycle');

    await replacePrivilegedRuntime(async () => ({ host: null, runtime: resumed.runtime as never }));
    await service.whenIdle();

    expect(resumed.createPrivilegedRecord).toHaveBeenCalledOnce();
    expect(service.snapshot().items[0]).toMatchObject({
      state: 'assembling',
      acknowledgedChunkCount: 1,
    });
  });
});
