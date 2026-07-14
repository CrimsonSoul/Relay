import { Worker } from 'node:worker_threads';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KnowledgeExtractionResult } from './knowledgeExtractor';

type WorkerMessage =
  | { id: number; ok: true; result: KnowledgeExtractionResult }
  | { id: number; ok: false; error: string };

type WorkerLike = {
  postMessage(message: { id: number; data: ArrayBuffer }, transferList: ArrayBuffer[]): void;
  on(event: 'message', listener: (message: WorkerMessage) => void): WorkerLike;
  on(event: 'error', listener: (error: Error) => void): WorkerLike;
  on(event: 'exit', listener: (code: number) => void): WorkerLike;
  terminate(): Promise<number>;
};

type ExtractionJob = {
  id: number;
  data: ArrayBuffer;
  resolve: (result: KnowledgeExtractionResult) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout> | null;
};

type KnowledgeExtractorWorkerOptions = {
  createWorker?: (path: string) => WorkerLike;
  timeoutMs?: number;
  workerPath?: string;
};

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_WORKER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'knowledgeExtractorWorker.js',
);

export class KnowledgeExtractorWorker {
  private readonly createWorker: (path: string) => WorkerLike;
  private readonly timeoutMs: number;
  private readonly workerPath: string;
  private readonly queue: ExtractionJob[] = [];
  private worker: WorkerLike | null = null;
  private current: ExtractionJob | null = null;
  private nextId = 1;
  private stopped = false;

  constructor(options: KnowledgeExtractorWorkerOptions = {}) {
    this.createWorker = options.createWorker ?? ((path) => new Worker(path) as WorkerLike);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.workerPath = options.workerPath ?? DEFAULT_WORKER_PATH;
  }

  extract(data: Uint8Array): Promise<KnowledgeExtractionResult> {
    if (this.stopped) return Promise.reject(new Error('extractor-stopped'));
    const copy = data.slice();
    const buffer = copy.buffer.slice(
      copy.byteOffset,
      copy.byteOffset + copy.byteLength,
    ) as ArrayBuffer;

    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, data: buffer, resolve, reject, timeout: null });
      this.pump();
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.rejectAll(new Error('extractor-stopped'));
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }

  private ensureWorker(): WorkerLike {
    if (this.worker) return this.worker;
    const worker = this.createWorker(this.workerPath);
    this.worker = worker;
    worker.on('message', (message) => this.handleMessage(worker, message));
    worker.on('error', () => this.handleWorkerFailure(worker, 'extraction-worker-error'));
    worker.on('exit', (code) => {
      if (code !== 0) this.handleWorkerFailure(worker, 'extraction-worker-exit');
    });
    return worker;
  }

  private pump(): void {
    if (this.stopped || this.current || this.queue.length === 0) return;
    const job = this.queue.shift();
    if (!job) return;
    this.current = job;
    const worker = this.ensureWorker();
    job.timeout = setTimeout(() => {
      if (this.current?.id !== job.id) return;
      this.rejectCurrent(new Error('extraction-timeout'));
      void this.terminateWorker(worker);
      this.pump();
    }, this.timeoutMs);
    worker.postMessage({ id: job.id, data: job.data }, [job.data]);
  }

  private handleMessage(worker: WorkerLike, message: WorkerMessage): void {
    if (worker !== this.worker || message.id !== this.current?.id) return;
    const job = this.takeCurrent();
    if (!job) return;
    if (message.ok) job.resolve(message.result);
    else job.reject(new Error(message.error));
    this.pump();
  }

  private handleWorkerFailure(worker: WorkerLike, reason: string): void {
    if (worker !== this.worker) return;
    this.rejectCurrent(new Error(reason));
    void this.terminateWorker(worker);
    this.pump();
  }

  private takeCurrent(): ExtractionJob | null {
    const job = this.current;
    this.current = null;
    if (job?.timeout) clearTimeout(job.timeout);
    return job;
  }

  private rejectCurrent(error: Error): void {
    this.takeCurrent()?.reject(error);
  }

  private rejectAll(error: Error): void {
    this.rejectCurrent(error);
    for (const job of this.queue.splice(0)) job.reject(error);
  }

  private async terminateWorker(worker: WorkerLike): Promise<void> {
    if (this.worker === worker) this.worker = null;
    await worker.terminate();
  }
}
