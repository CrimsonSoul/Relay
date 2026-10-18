import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeExtractorWorker } from './KnowledgeExtractorWorker';

const workerConstruction = vi.hoisted(() => vi.fn());

vi.mock('node:worker_threads', () => ({
  Worker: class {
    constructor(path: string, options: unknown) {
      workerConstruction(path, options);
    }
    on() {
      return this;
    }
    postMessage() {}
    async terminate() {
      return 0;
    }
  },
}));

type PostedJob = { id: number; kind: 'metadata' | 'passages'; data: ArrayBuffer };

class FakeWorker extends EventEmitter {
  readonly posted: PostedJob[] = [];
  readonly terminate = vi.fn(async () => 0);

  postMessage(message: PostedJob): void {
    this.posted.push(message);
  }
}

const passage = {
  pageNumber: 1,
  passageNumber: 1,
  headingId: null,
  heading: null,
  text: 'Recovery',
  normalizedText: 'recovery',
  normalizedStart: 0,
  normalizedEnd: 8,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('KnowledgeExtractorWorker', () => {
  it('processes extraction jobs FIFO with concurrency one', async () => {
    const worker = new FakeWorker();
    const extractor = new KnowledgeExtractorWorker({ createWorker: () => worker as never });

    const first = extractor.extract(new Uint8Array([1]));
    const second = extractor.extract(new Uint8Array([2]));

    expect(worker.posted).toHaveLength(1);
    worker.emit('message', {
      id: worker.posted[0]?.id,
      kind: 'metadata',
      ok: true,
      result: {
        metadataTitle: null,
        pageCount: 1,
        outline: [],
        outlineSource: 'none',
        coverPng: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      },
    });
    await expect(first).resolves.toMatchObject({ pageCount: 1 });
    expect(worker.posted).toHaveLength(2);

    worker.emit('message', {
      id: worker.posted[1]?.id,
      kind: 'metadata',
      ok: true,
      result: {
        metadataTitle: 'Second',
        pageCount: 2,
        outline: [],
        outlineSource: 'none',
        coverPng: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      },
    });
    await expect(second).resolves.toMatchObject({ metadataTitle: 'Second' });
    await extractor.stop();
  });

  it('routes search passages through FIFO before the next metadata extraction', async () => {
    const worker = new FakeWorker();
    const extractor = new KnowledgeExtractorWorker({ createWorker: () => worker as never });

    const search = extractor.extractSearchPassages(new Uint8Array([1]), []);
    const metadata = extractor.extract(new Uint8Array([2]));

    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]).toMatchObject({ kind: 'passages' });
    worker.emit('message', {
      id: worker.posted[0]?.id,
      kind: 'passages',
      ok: true,
      result: [passage],
    });
    await expect(search).resolves.toEqual([passage]);

    expect(worker.posted[1]).toMatchObject({ kind: 'metadata' });
    worker.emit('message', {
      id: worker.posted[1]?.id,
      kind: 'metadata',
      ok: true,
      result: {
        metadataTitle: 'Second',
        pageCount: 2,
        outline: [],
        outlineSource: 'none',
        coverPng: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      },
    });
    await expect(metadata).resolves.toMatchObject({ metadataTitle: 'Second' });
    await extractor.stop();
  });

  it('terminates a timed-out worker and returns a bounded error', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const extractor = new KnowledgeExtractorWorker({
      createWorker: () => worker as never,
      timeoutMs: 30_000,
    });

    const result = extractor.extract(new Uint8Array([1]));
    const rejection = expect(result).rejects.toThrow('extraction-timeout');
    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('restarts after a timed-out passages job before processing metadata work', async () => {
    vi.useFakeTimers();
    const firstWorker = new FakeWorker();
    const replacement = new FakeWorker();
    const workers = [firstWorker, replacement];
    const extractor = new KnowledgeExtractorWorker({
      createWorker: () => workers.shift() as never,
      timeoutMs: 30_000,
    });

    const search = extractor.extractSearchPassages(new Uint8Array([1]), []);
    const metadata = extractor.extract(new Uint8Array([2]));
    const rejection = expect(search).rejects.toThrow('extraction-timeout');
    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(replacement.posted).toHaveLength(1);
    expect(replacement.posted[0]).toMatchObject({ kind: 'metadata' });
    replacement.emit('message', {
      id: replacement.posted[0]?.id,
      kind: 'metadata',
      ok: true,
      result: {
        metadataTitle: null,
        pageCount: 1,
        outline: [],
        outlineSource: 'none',
        coverPng: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      },
    });
    await expect(metadata).resolves.toMatchObject({ pageCount: 1 });
    await extractor.stop();
  });

  it('caps the heap of every parsing worker, including ones created without a limit', async () => {
    const unbounded = new KnowledgeExtractorWorker({ workerPath: 'extractor.js' });
    const indexing = new KnowledgeExtractorWorker({ workerPath: 'indexer.js', memoryLimitMb: 256 });

    void unbounded.extract(new Uint8Array([1])).catch(() => undefined);
    void indexing.extract(new Uint8Array([1])).catch(() => undefined);

    expect(workerConstruction).toHaveBeenCalledWith('extractor.js', {
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    expect(workerConstruction).toHaveBeenCalledWith('indexer.js', {
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    await unbounded.stop();
    await indexing.stop();
  });

  it('rejects active and queued work when stopped', async () => {
    const worker = new FakeWorker();
    const extractor = new KnowledgeExtractorWorker({ createWorker: () => worker as never });

    const first = extractor.extract(new Uint8Array([1]));
    const second = extractor.extract(new Uint8Array([2]));
    await extractor.stop();

    await expect(first).rejects.toThrow('extractor-stopped');
    await expect(second).rejects.toThrow('extractor-stopped');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('spawns a fresh worker when the idle worker exits cleanly', async () => {
    vi.useFakeTimers();
    const firstWorker = new FakeWorker();
    const replacement = new FakeWorker();
    const workers = [firstWorker, replacement];
    const extractor = new KnowledgeExtractorWorker({
      createWorker: () => workers.shift() as never,
      timeoutMs: 30_000,
    });

    const first = extractor.extract(new Uint8Array([1]));
    firstWorker.emit('message', {
      id: firstWorker.posted[0]?.id,
      kind: 'metadata',
      ok: true,
      result: {
        metadataTitle: null,
        pageCount: 1,
        outline: [],
        outlineSource: 'none',
        coverPng: null,
      },
    });
    await expect(first).resolves.toMatchObject({ pageCount: 1 });
    firstWorker.emit('exit', 0);

    const second = extractor.extract(new Uint8Array([2]));
    expect(firstWorker.posted).toHaveLength(1);
    expect(replacement.posted).toHaveLength(1);
    replacement.emit('message', {
      id: replacement.posted[0]?.id,
      kind: 'metadata',
      ok: true,
      result: {
        metadataTitle: null,
        pageCount: 2,
        outline: [],
        outlineSource: 'none',
        coverPng: null,
      },
    });
    await expect(second).resolves.toMatchObject({ pageCount: 2 });
    await extractor.stop();
  });
});

it('keeps passage construction in the timed worker job', async () => {
  vi.useFakeTimers();
  const worker = new FakeWorker();
  const extractor = new KnowledgeExtractorWorker({
    createWorker: () => worker as never,
    timeoutMs: 10,
  });
  const pending = extractor.extractSearchPassages(new Uint8Array([1]), []);
  const rejection = expect(pending).rejects.toThrow('extraction-timeout');
  expect(worker.posted[0]).toMatchObject({ kind: 'passages', outline: [] });
  await vi.advanceTimersByTimeAsync(10);
  await rejection;
  expect(worker.terminate).toHaveBeenCalled();
  await extractor.stop();
});
