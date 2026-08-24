import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeUploadQueueView } from '@shared/knowledge';
import { useKnowledgeUploadQueue } from '../useKnowledgeUploadQueue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const emptyQueue: KnowledgeUploadQueueView = {
  restartRecovery: false,
  activeBatchId: null,
  totalBytes: 0,
  acknowledgedBytes: 0,
  items: [],
};

const privateQueue: KnowledgeUploadQueueView = {
  restartRecovery: true,
  activeBatchId: 'batch-a',
  totalBytes: 100,
  acknowledgedBytes: 0,
  items: [
    {
      id: 'local-a',
      uploadId: 'upload-a',
      batchId: 'batch-a',
      fileName: 'Private A.pdf',
      byteSize: 100,
      acknowledgedBytes: 0,
      chunkCount: 1,
      acknowledgedChunkCount: 0,
      state: 'paused',
      safeError: null,
      retryCount: 0,
      restartRecovery: true,
      cancelPending: false,
    },
  ],
};

describe('useKnowledgeUploadQueue', () => {
  afterEach(() => {
    delete globalThis.api;
  });

  it('rejects queue responses and events from a superseded management identity', async () => {
    const accountAQueue = deferred<KnowledgeUploadQueueView>();
    const accountBQueue = deferred<KnowledgeUploadQueueView>();
    const listeners: Array<(queue: KnowledgeUploadQueueView) => void> = [];
    globalThis.api = {
      getKnowledgeUploadQueue: vi
        .fn()
        .mockReturnValueOnce(accountAQueue.promise)
        .mockReturnValueOnce(accountBQueue.promise),
      onKnowledgeUploadQueueChanged: vi.fn((listener) => {
        listeners.push(listener);
        return vi.fn();
      }),
    } as never;
    const pollSnapshot = vi.fn(async () => true);
    const { result, rerender } = renderHook(
      ({ identity }) =>
        useKnowledgeUploadQueue({
          canManage: true,
          managementIdentity: identity,
          serverUploads: [],
          pollSnapshot,
        }),
      { initialProps: { identity: 'account-a\0device-1' } },
    );
    await waitFor(() => expect(globalThis.api?.getKnowledgeUploadQueue).toHaveBeenCalledOnce());

    rerender({ identity: 'account-b\0device-1' });
    await waitFor(() => expect(globalThis.api?.getKnowledgeUploadQueue).toHaveBeenCalledTimes(2));
    act(() => listeners[0]?.(privateQueue));
    accountBQueue.resolve(emptyQueue);
    await waitFor(() => expect(result.current.uploadQueue).toEqual(emptyQueue));
    accountAQueue.resolve(privateQueue);
    await act(async () => accountAQueue.promise);

    expect(result.current.uploadQueue).toEqual(emptyQueue);
    expect(JSON.stringify(result.current.uploadQueue)).not.toContain('Private A.pdf');
  });
});
