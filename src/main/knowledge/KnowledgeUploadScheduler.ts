import {
  KNOWLEDGE_UPLOAD_CONCURRENCY,
  KNOWLEDGE_UPLOAD_MAX_RETRIES,
  type KnowledgeManagementErrorCode,
  type KnowledgeUploadQueueItemState,
} from '@shared/knowledge';

export type KnowledgeUploadSchedulerTask = {
  uploadId: string;
  batchId: string;
  byteSize: number;
  getMissingChunkIndexes(): Promise<number[]>;
  readChunk(index: number): Promise<Uint8Array>;
  uploadChunk(index: number, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
  finalize(): Promise<void>;
  onAcknowledged(index: number, byteSize: number): void;
  onState(
    state: KnowledgeUploadQueueItemState,
    safeError: KnowledgeManagementErrorCode | null,
    retryCount: number,
  ): void;
};

type KnowledgeUploadSchedulerOptions = {
  concurrency?: number;
  maxRetries?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
};

class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(concurrency: number) {
    this.available = concurrency;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await operation();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter();
    else this.available += 1;
  }
}

class SchedulerTaskError extends Error {
  constructor(
    readonly state: KnowledgeUploadQueueItemState,
    readonly safeError: KnowledgeManagementErrorCode | null,
    readonly retryCount: number,
  ) {
    super(state);
    this.name = 'SchedulerTaskError';
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryableStatus(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false;
  const status = (error as { status?: unknown }).status;
  return (
    status === 0 ||
    status === 408 ||
    status === 429 ||
    (typeof status === 'number' && status >= 500 && status <= 599)
  );
}

function sourceRequired(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'source-required'
  );
}

export class KnowledgeUploadScheduler {
  private readonly semaphore: Semaphore;
  private readonly maxRetries: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly tasks = new Map<string, KnowledgeUploadSchedulerTask>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, Set<AbortController>>();
  private readonly pausedBatches = new Set<string>();
  private readonly completed = new Set<string>();
  private sessionActive = true;
  private disposed = false;

  constructor(options: KnowledgeUploadSchedulerOptions = {}) {
    this.semaphore = new Semaphore(options.concurrency ?? KNOWLEDGE_UPLOAD_CONCURRENCY);
    this.maxRetries = options.maxRetries ?? KNOWLEDGE_UPLOAD_MAX_RETRIES;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  enqueue(task: KnowledgeUploadSchedulerTask): void {
    if (this.disposed) return;
    this.tasks.set(task.uploadId, task);
    this.completed.delete(task.uploadId);
    this.schedule(task);
  }

  pauseBatch(batchId: string): void {
    this.pausedBatches.add(batchId);
    for (const task of this.tasks.values()) {
      if (task.batchId !== batchId || this.completed.has(task.uploadId)) continue;
      this.abort(task.uploadId);
      task.onState('paused', null, 0);
    }
  }

  resumeBatch(batchId: string): void {
    this.pausedBatches.delete(batchId);
    for (const task of this.tasks.values()) {
      if (task.batchId === batchId && !this.completed.has(task.uploadId)) this.schedule(task);
    }
  }

  retryUpload(uploadId: string): void {
    const task = this.tasks.get(uploadId);
    if (!task) return;
    this.completed.delete(uploadId);
    this.schedule(task);
  }

  cancelUpload(uploadId: string): void {
    this.abort(uploadId);
    this.completed.add(uploadId);
    const task = this.tasks.get(uploadId);
    task?.onState('cancelled', null, 0);
    this.tasks.delete(uploadId);
  }

  cancelBatch(batchId: string): void {
    for (const task of [...this.tasks.values()]) {
      if (task.batchId === batchId) this.cancelUpload(task.uploadId);
    }
    this.pausedBatches.delete(batchId);
  }

  setSessionActive(active: boolean): void {
    this.sessionActive = active;
    if (!active) {
      for (const task of this.tasks.values()) {
        if (this.completed.has(task.uploadId)) continue;
        this.abort(task.uploadId);
        task.onState('paused', null, 0);
      }
      return;
    }
    for (const task of this.tasks.values()) {
      if (!this.completed.has(task.uploadId)) this.schedule(task);
    }
  }

  async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight.values()]);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.sessionActive = false;
    for (const uploadId of this.tasks.keys()) this.abort(uploadId);
    await this.whenIdle();
    this.tasks.clear();
  }

  private schedule(task: KnowledgeUploadSchedulerTask): void {
    if (
      this.disposed ||
      !this.sessionActive ||
      this.pausedBatches.has(task.batchId) ||
      this.inFlight.has(task.uploadId) ||
      this.completed.has(task.uploadId)
    ) {
      if (!this.sessionActive || this.pausedBatches.has(task.batchId)) {
        task.onState('paused', null, 0);
      }
      return;
    }
    const operation = this.runTask(task).finally(() => this.inFlight.delete(task.uploadId));
    this.inFlight.set(task.uploadId, operation);
  }

  private async runTask(task: KnowledgeUploadSchedulerTask): Promise<void> {
    task.onState('uploading', null, 0);
    try {
      const missing = await task.getMissingChunkIndexes();
      const results = await Promise.allSettled(
        missing.map((index) => this.semaphore.run(() => this.uploadOne(task, index))),
      );
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected',
      );
      if (failed) throw failed.reason;
      if (!this.sessionActive || this.pausedBatches.has(task.batchId)) {
        throw new SchedulerTaskError('paused', null, 0);
      }
      await task.finalize();
      this.completed.add(task.uploadId);
      task.onState('assembling', null, 0);
    } catch (error) {
      if (error instanceof SchedulerTaskError) {
        task.onState(error.state, error.safeError, error.retryCount);
      } else if (sourceRequired(error)) {
        task.onState('source-required', 'source-required', 0);
      } else {
        task.onState('failed', 'upload-failed', 1);
      }
    }
  }

  private async uploadOne(task: KnowledgeUploadSchedulerTask, index: number): Promise<void> {
    const bytes = await task.readChunk(index);
    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      this.assertRunnable(task);
      const controller = this.addController(task.uploadId);
      try {
        await task.uploadChunk(index, bytes, controller.signal);
        task.onAcknowledged(index, bytes.byteLength);
        return;
      } catch (error) {
        if (
          await this.handleAttemptFailure(task, index, bytes.byteLength, attempt, controller, error)
        ) {
          return;
        }
      } finally {
        this.removeController(task.uploadId, controller);
      }
    }
  }

  private assertRunnable(task: KnowledgeUploadSchedulerTask): void {
    if (!this.sessionActive || this.pausedBatches.has(task.batchId)) {
      throw new SchedulerTaskError('paused', null, 0);
    }
  }

  private async handleAttemptFailure(
    task: KnowledgeUploadSchedulerTask,
    index: number,
    byteLength: number,
    attempt: number,
    controller: AbortController,
    error: unknown,
  ): Promise<boolean> {
    if (controller.signal.aborted) throw new SchedulerTaskError('paused', null, 0);
    if (await this.serverAcknowledged(task, index)) {
      task.onAcknowledged(index, byteLength);
      return true;
    }
    if (!retryableStatus(error)) {
      throw new SchedulerTaskError('failed', 'upload-failed', attempt);
    }
    if (attempt >= this.maxRetries) {
      throw new SchedulerTaskError('paused-network', 'offline', attempt);
    }
    task.onState('uploading', 'offline', attempt);
    await this.sleep(this.retryDelay(attempt));
    return false;
  }

  private async serverAcknowledged(
    task: KnowledgeUploadSchedulerTask,
    index: number,
  ): Promise<boolean> {
    try {
      return !(await task.getMissingChunkIndexes()).includes(index);
    } catch {
      return false;
    }
  }

  private retryDelay(attempt: number): number {
    const base = Math.min(30_000, 1_000 * 2 ** (attempt - 1));
    return Math.round(base * (0.75 + this.random() * 0.5));
  }

  private addController(uploadId: string): AbortController {
    const controller = new AbortController();
    const controllers = this.controllers.get(uploadId) ?? new Set<AbortController>();
    controllers.add(controller);
    this.controllers.set(uploadId, controllers);
    return controller;
  }

  private removeController(uploadId: string, controller: AbortController): void {
    const controllers = this.controllers.get(uploadId);
    controllers?.delete(controller);
    if (controllers?.size === 0) this.controllers.delete(uploadId);
  }

  private abort(uploadId: string): void {
    for (const controller of this.controllers.get(uploadId) ?? []) controller.abort();
    this.controllers.delete(uploadId);
  }
}
