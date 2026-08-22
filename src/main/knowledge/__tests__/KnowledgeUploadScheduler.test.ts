import { describe, expect, it, vi } from 'vitest';
import type {
  KnowledgeManagementErrorCode,
  KnowledgeUploadQueueItemState,
} from '@shared/knowledge';
import {
  KnowledgeUploadScheduler,
  type KnowledgeUploadSchedulerTask,
} from '../KnowledgeUploadScheduler';

function task(overrides: Partial<KnowledgeUploadSchedulerTask> = {}): KnowledgeUploadSchedulerTask {
  return {
    uploadId: 'upload-1',
    batchId: 'batch-1',
    byteSize: 16,
    getMissingChunkIndexes: vi.fn(async () => [0, 1, 2, 3]),
    readChunk: vi.fn(async (index) => new Uint8Array(4).fill(index)),
    uploadChunk: vi.fn(async () => undefined),
    finalize: vi.fn(async () => undefined),
    isEligible: vi.fn(() => true),
    onAcknowledged: vi.fn(),
    onState: vi.fn(),
    ...overrides,
  };
}

function stateCalls(value: KnowledgeUploadSchedulerTask) {
  return vi.mocked(value.onState).mock.calls as Array<
    [KnowledgeUploadQueueItemState, KnowledgeManagementErrorCode | null, number]
  >;
}

describe('KnowledgeUploadScheduler', () => {
  it('uses at most two chunk requests across a task and reports acknowledged bytes', async () => {
    let active = 0;
    let maximum = 0;
    const releases: Array<() => void> = [];
    const uploadChunk = vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    });
    const value = task({ uploadChunk });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(uploadChunk).toHaveBeenCalledTimes(2));
    releases.splice(0).forEach((release) => release());
    await vi.waitFor(() => expect(uploadChunk).toHaveBeenCalledTimes(4));
    releases.splice(0).forEach((release) => release());
    await scheduler.whenIdle();

    expect(maximum).toBe(2);
    expect(value.onAcknowledged).toHaveBeenCalledTimes(4);
    expect(value.onAcknowledged).toHaveBeenLastCalledWith(expect.any(Number), 4);
    expect(value.finalize).toHaveBeenCalledOnce();
  });

  it('uses bounded jittered backoff and pauses after eight transient failures', async () => {
    const sleep = vi.fn(async (_milliseconds: number) => undefined);
    const error = Object.assign(new Error('VPN unavailable'), { status: 0 });
    const uploadChunk = vi.fn(async () => Promise.reject(error));
    const value = task({
      getMissingChunkIndexes: vi.fn(async () => [0]),
      readChunk: vi.fn(async () => new Uint8Array(4)),
      uploadChunk,
    });
    const scheduler = new KnowledgeUploadScheduler({ random: () => 0.5, sleep });

    scheduler.enqueue(value);
    await scheduler.whenIdle();

    expect(uploadChunk).toHaveBeenCalledTimes(8);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000,
    ]);
    expect(stateCalls(value)).toContainEqual(['paused-network', 'offline', 8]);
    expect(value.finalize).not.toHaveBeenCalled();
  });

  it('reconciles an ambiguous response against authoritative server indexes before retrying', async () => {
    const uploadChunk = vi.fn(async () => {
      throw Object.assign(new Error('response lost'), { status: 0 });
    });
    const getMissingChunkIndexes = vi
      .fn<() => Promise<number[]>>()
      .mockResolvedValueOnce([0])
      .mockResolvedValueOnce([]);
    const value = task({
      getMissingChunkIndexes,
      readChunk: vi.fn(async () => new Uint8Array(4)),
      uploadChunk,
    });
    const scheduler = new KnowledgeUploadScheduler({ sleep: vi.fn() });

    scheduler.enqueue(value);
    await scheduler.whenIdle();

    expect(uploadChunk).toHaveBeenCalledOnce();
    expect(value.onAcknowledged).toHaveBeenCalledWith(0, 4);
    expect(value.finalize).toHaveBeenCalledOnce();
  });

  it('does not retry authorization or validation failures', async () => {
    const sleep = vi.fn();
    const value = task({
      getMissingChunkIndexes: vi.fn(async () => [0]),
      uploadChunk: vi.fn(async () => {
        throw Object.assign(new Error('forbidden'), { status: 403 });
      }),
    });
    const scheduler = new KnowledgeUploadScheduler({ sleep });

    scheduler.enqueue(value);
    await scheduler.whenIdle();

    expect(value.uploadChunk).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
    expect(stateCalls(value)).toContainEqual(['failed', 'upload-failed', 1]);
  });

  it('surfaces a moved source as source-required without sending bytes', async () => {
    const value = task({
      getMissingChunkIndexes: vi.fn(async () => [0]),
      readChunk: vi.fn(async () => {
        throw Object.assign(new Error('source moved'), { code: 'source-required' });
      }),
    });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await scheduler.whenIdle();

    expect(value.uploadChunk).not.toHaveBeenCalled();
    expect(stateCalls(value)).toContainEqual(['source-required', 'source-required', 0]);
  });

  it('uses only server-declared missing indexes on process restore', async () => {
    const value = task({ getMissingChunkIndexes: vi.fn(async () => [1, 3]) });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await scheduler.whenIdle();

    expect(value.readChunk).toHaveBeenCalledTimes(2);
    expect(value.readChunk).toHaveBeenNthCalledWith(1, 1);
    expect(value.readChunk).toHaveBeenNthCalledWith(2, 3);
  });

  it('holds restored work while the session is locked and resumes on activation', async () => {
    const value = task({ getMissingChunkIndexes: vi.fn(async () => [0]) });
    const scheduler = new KnowledgeUploadScheduler();
    scheduler.setSessionActive(false);

    scheduler.enqueue(value);
    await Promise.resolve();
    expect(value.getMissingChunkIndexes).not.toHaveBeenCalled();
    expect(stateCalls(value)).toContainEqual(['queued', null, 0]);

    scheduler.setSessionActive(true);
    await scheduler.whenIdle();
    expect(value.finalize).toHaveBeenCalledOnce();
  });

  it('keeps ineligible work queued without touching its source or the network', async () => {
    let eligible = false;
    const value = task({
      getMissingChunkIndexes: vi.fn(async () => [0]),
      isEligible: vi.fn(() => eligible),
    });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await Promise.resolve();

    expect(stateCalls(value).at(-1)).toEqual(['queued', null, 0]);
    expect(value.getMissingChunkIndexes).not.toHaveBeenCalled();
    expect(value.readChunk).not.toHaveBeenCalled();
    expect(value.uploadChunk).not.toHaveBeenCalled();
    expect(value.finalize).not.toHaveBeenCalled();

    eligible = true;
    scheduler.setSessionActive(false);
    scheduler.setSessionActive(true);
    await scheduler.whenIdle();

    expect(value.getMissingChunkIndexes).toHaveBeenCalledOnce();
    expect(value.readChunk).toHaveBeenCalledOnce();
    expect(value.uploadChunk).toHaveBeenCalledOnce();
    expect(value.finalize).toHaveBeenCalledOnce();
  });

  it('fails eligibility checks closed without touching the source or network', async () => {
    const value = task({
      isEligible: vi.fn(() => {
        throw new Error('session lookup failed');
      }),
    });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await Promise.resolve();

    expect(stateCalls(value).at(-1)).toEqual(['queued', null, 0]);
    expect(value.getMissingChunkIndexes).not.toHaveBeenCalled();
    expect(value.readChunk).not.toHaveBeenCalled();
    expect(value.uploadChunk).not.toHaveBeenCalled();
    expect(value.finalize).not.toHaveBeenCalled();
  });

  it('stops acknowledgment and finalization when eligibility changes during upload', async () => {
    let eligible = true;
    const value = task({
      getMissingChunkIndexes: vi.fn(async () => [0]),
      isEligible: vi.fn(() => eligible),
      uploadChunk: vi.fn(async () => {
        eligible = false;
      }),
    });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await scheduler.whenIdle();

    expect(value.uploadChunk).toHaveBeenCalledOnce();
    expect(value.onAcknowledged).not.toHaveBeenCalled();
    expect(value.finalize).not.toHaveBeenCalled();
    expect(stateCalls(value).at(-1)).toEqual(['queued', null, 0]);
  });

  it('settles an automatically suspended in-flight upload as queued', async () => {
    const uploadChunk = vi.fn(
      async (_index: number, _bytes: Uint8Array, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          if (signal.aborted) {
            reject(Object.assign(new Error('aborted'), { status: 0 }));
            return;
          }
          signal.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('aborted'), { status: 0 })),
            { once: true },
          );
        }),
    );
    const value = task({
      getMissingChunkIndexes: vi.fn(async () => [0]),
      uploadChunk,
    });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(uploadChunk).toHaveBeenCalledOnce());
    scheduler.setSessionActive(false);
    await scheduler.whenIdle();

    expect(stateCalls(value).at(-1)).toEqual(['queued', null, 0]);
    expect(stateCalls(value)).not.toContainEqual(['paused', null, 0]);
  });

  it('keeps an explicitly paused batch paused while the session becomes inactive', async () => {
    const uploadChunk = vi.fn(
      async (_index: number, _bytes: Uint8Array, signal: AbortSignal) =>
        new Promise<void>((resolve, reject) => {
          if (signal.aborted) {
            reject(Object.assign(new Error('aborted'), { status: 0 }));
            return;
          }
          signal.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('aborted'), { status: 0 })),
            { once: true },
          );
        }),
    );
    const value = task({
      getMissingChunkIndexes: vi.fn(async () => [0]),
      uploadChunk,
    });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(uploadChunk).toHaveBeenCalledOnce());
    scheduler.pauseBatch(value.batchId);
    scheduler.setSessionActive(false);
    await scheduler.whenIdle();

    expect(stateCalls(value).at(-1)).toEqual(['paused', null, 0]);
    expect(stateCalls(value)).not.toContainEqual(['queued', null, 0]);
  });

  it('keeps a deferred missing-index rejection paused after an explicit pause', async () => {
    let rejectMissing!: (error: Error) => void;
    const missing = new Promise<number[]>((_resolve, reject) => {
      rejectMissing = reject;
    });
    const value = task({ getMissingChunkIndexes: vi.fn(async () => missing) });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(value.getMissingChunkIndexes).toHaveBeenCalledOnce());
    scheduler.pauseBatch(value.batchId);
    rejectMissing(new Error('late status rejection'));
    await scheduler.whenIdle();

    expect(stateCalls(value).at(-1)).toEqual(['paused', null, 0]);
    expect(stateCalls(value)).not.toContainEqual(['failed', 'upload-failed', 1]);
  });

  it('keeps a deferred finalize rejection queued after the session becomes inactive', async () => {
    let rejectFinalize!: (error: Error) => void;
    const finalizing = new Promise<void>((_resolve, reject) => {
      rejectFinalize = reject;
    });
    const value = task({
      getMissingChunkIndexes: vi.fn(async () => []),
      finalize: vi.fn(async () => finalizing),
    });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(value.finalize).toHaveBeenCalledOnce());
    scheduler.setSessionActive(false);
    rejectFinalize(new Error('late finalize rejection'));
    await scheduler.whenIdle();

    expect(stateCalls(value).at(-1)).toEqual(['queued', null, 0]);
    expect(stateCalls(value)).not.toContainEqual(['failed', 'upload-failed', 1]);
  });

  it('suppresses a deferred rejection after the scheduler retires an authoritative terminal upload', async () => {
    let rejectMissing!: (error: Error) => void;
    const missing = new Promise<number[]>((_resolve, reject) => {
      rejectMissing = reject;
    });
    const value = task({ getMissingChunkIndexes: vi.fn(async () => missing) });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(value.getMissingChunkIndexes).toHaveBeenCalledOnce());
    scheduler.retireUpload(value.uploadId);
    rejectMissing(new Error('late status rejection'));
    await scheduler.whenIdle();

    expect(stateCalls(value)).not.toContainEqual(['queued', null, 0]);
    expect(stateCalls(value)).not.toContainEqual(['failed', 'upload-failed', 1]);
  });

  it('quiesces one upload before cancellation without marking it cancelled', async () => {
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const value = task({
      getMissingChunkIndexes: vi.fn(async () => [0]),
      uploadChunk: vi.fn(async () => uploadGate),
    });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(value.uploadChunk).toHaveBeenCalledOnce());
    const quiescing = scheduler.quiesceUpload(value.uploadId);
    let quiesced = false;
    void quiescing.then(() => {
      quiesced = true;
    });
    await Promise.resolve();

    expect(quiesced).toBe(false);
    expect(stateCalls(value).at(-1)).toEqual(['uploading', null, 0]);
    expect(stateCalls(value)).not.toContainEqual(['cancelled', null, 0]);

    releaseUpload();
    await quiescing;

    expect(value.onAcknowledged).not.toHaveBeenCalled();
    expect(value.finalize).not.toHaveBeenCalled();
    expect(stateCalls(value).at(-1)).toEqual(['uploading', null, 0]);
    expect(stateCalls(value)).not.toContainEqual(['failed', 'upload-failed', 1]);
  });

  it('does not emit failure when dispose wins a deferred rejection', async () => {
    let rejectMissing!: (error: Error) => void;
    const missing = new Promise<number[]>((_resolve, reject) => {
      rejectMissing = reject;
    });
    const value = task({ getMissingChunkIndexes: vi.fn(async () => missing) });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(value.getMissingChunkIndexes).toHaveBeenCalledOnce());
    const disposing = scheduler.dispose();
    rejectMissing(new Error('late shutdown rejection'));
    await disposing;

    expect(stateCalls(value)).not.toContainEqual(['failed', 'upload-failed', 1]);
  });

  it('reschedules an interrupted upload when the session reactivates before abort settles', async () => {
    let attempts = 0;
    const uploadChunk = vi.fn(async (_index: number, _bytes: Uint8Array, signal: AbortSignal) => {
      attempts += 1;
      if (attempts > 1) return;
      return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
          reject(Object.assign(new Error('aborted'), { status: 0 }));
          return;
        }
        signal.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), { status: 0 })),
          { once: true },
        );
      });
    });
    const value = task({
      getMissingChunkIndexes: vi.fn(async () => [0]),
      uploadChunk,
    });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(uploadChunk).toHaveBeenCalledOnce());
    scheduler.setSessionActive(false);
    scheduler.setSessionActive(true);
    await scheduler.whenIdle();

    expect(uploadChunk).toHaveBeenCalledTimes(2);
    expect(value.finalize).toHaveBeenCalledOnce();
  });

  it('does not run a replacement task after the in-flight task completes successfully', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = task({
      getMissingChunkIndexes: vi.fn(async () => [0]),
      uploadChunk: vi.fn(async () => gate),
    });
    const replacement = task({
      getMissingChunkIndexes: vi.fn(async () => [0]),
    });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(original);
    await vi.waitFor(() => expect(original.uploadChunk).toHaveBeenCalledOnce());
    scheduler.enqueue(replacement);
    release();
    await scheduler.whenIdle();

    expect(original.finalize).toHaveBeenCalledOnce();
    expect(replacement.uploadChunk).not.toHaveBeenCalled();
    expect(replacement.finalize).not.toHaveBeenCalled();
  });

  it('does not start semaphore-queued chunks while the client is shutting down', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const uploadChunk = vi.fn(async () => gate);
    const value = task({ uploadChunk });
    const replacement = task({ uploadId: value.uploadId });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(uploadChunk).toHaveBeenCalledTimes(2));
    scheduler.enqueue(replacement);
    const disposing = scheduler.dispose();
    release();
    await disposing;

    expect(uploadChunk).toHaveBeenCalledTimes(2);
    expect(replacement.uploadChunk).not.toHaveBeenCalled();
    expect(value.finalize).not.toHaveBeenCalled();
    expect(stateCalls(value)).toContainEqual(['queued', null, 0]);
  });

  it('does not let an in-flight chunk completion revive a cancelled upload', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const uploadChunk = vi.fn(async () => gate);
    const value = task({
      getMissingChunkIndexes: vi.fn(async () => [0]),
      uploadChunk,
    });
    const replacement = task({ uploadId: value.uploadId });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(uploadChunk).toHaveBeenCalledOnce());
    scheduler.enqueue(replacement);
    scheduler.cancelUpload(value.uploadId);
    release();
    await scheduler.whenIdle();

    expect(value.onAcknowledged).not.toHaveBeenCalled();
    expect(value.finalize).not.toHaveBeenCalled();
    expect(replacement.uploadChunk).not.toHaveBeenCalled();
    expect(stateCalls(value).at(-1)).toEqual(['cancelled', null, 0]);
  });

  it('does not let a late finalize rejection overwrite cancellation', async () => {
    let rejectFinalize!: (error: Error) => void;
    const finalizing = new Promise<void>((_resolve, reject) => {
      rejectFinalize = reject;
    });
    const value = task({
      getMissingChunkIndexes: vi.fn(async () => []),
      finalize: vi.fn(async () => finalizing),
    });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(value.finalize).toHaveBeenCalledOnce());
    scheduler.cancelUpload(value.uploadId);
    rejectFinalize(new Error('cancel won the server race'));
    await scheduler.whenIdle();

    expect(stateCalls(value).at(-1)).toEqual(['cancelled', null, 0]);
    expect(stateCalls(value)).not.toContainEqual(['failed', 'upload-failed', 1]);
  });

  it('does not let a late successful finalize revive a cancelled upload', async () => {
    let resolveFinalize!: () => void;
    const finalizing = new Promise<void>((resolve) => {
      resolveFinalize = resolve;
    });
    const value = task({
      getMissingChunkIndexes: vi.fn(async () => []),
      finalize: vi.fn(async () => finalizing),
    });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(value.finalize).toHaveBeenCalledOnce());
    scheduler.cancelUpload(value.uploadId);
    resolveFinalize();
    await scheduler.whenIdle();

    expect(stateCalls(value).at(-1)).toEqual(['cancelled', null, 0]);
    expect(stateCalls(value)).not.toContainEqual(['assembling', null, 0]);
  });

  it('does not cancel same-batch uploads enqueued re-entrantly during cancellation', async () => {
    const scheduler = new KnowledgeUploadScheduler();
    const reentrantTask = task({ uploadId: 'upload-2' });
    const originalTask = task({
      onState: vi.fn((state) => {
        if (state === 'cancelled') scheduler.enqueue(reentrantTask);
      }),
    });

    scheduler.enqueue(originalTask);
    scheduler.cancelBatch(originalTask.batchId);
    await scheduler.whenIdle();

    expect(stateCalls(originalTask)).toContainEqual(['cancelled', null, 0]);
    expect(stateCalls(reentrantTask)).not.toContainEqual(['cancelled', null, 0]);
    expect(reentrantTask.finalize).toHaveBeenCalledOnce();
  });
});
