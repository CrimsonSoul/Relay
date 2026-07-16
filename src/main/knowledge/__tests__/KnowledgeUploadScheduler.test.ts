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
    const sleep = vi.fn(async () => undefined);
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
    expect(stateCalls(value)).toContainEqual(['paused', null, 0]);

    scheduler.setSessionActive(true);
    await scheduler.whenIdle();
    expect(value.finalize).toHaveBeenCalledOnce();
  });

  it('does not start semaphore-queued chunks while the client is shutting down', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const uploadChunk = vi.fn(async () => gate);
    const value = task({ uploadChunk });
    const scheduler = new KnowledgeUploadScheduler();

    scheduler.enqueue(value);
    await vi.waitFor(() => expect(uploadChunk).toHaveBeenCalledTimes(2));
    const disposing = scheduler.dispose();
    release();
    await disposing;

    expect(uploadChunk).toHaveBeenCalledTimes(2);
    expect(value.finalize).not.toHaveBeenCalled();
    expect(stateCalls(value)).toContainEqual(['paused', null, 0]);
  });
});
