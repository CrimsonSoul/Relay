import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeExtractorWorker } from './KnowledgeExtractorWorker';

class FakeWorker extends EventEmitter {
  readonly posted: Array<{ id: number; kind: 'metadata' | 'search'; data: ArrayBuffer }> = [];
  readonly terminate = vi.fn(async () => 0);

  postMessage(message: { id: number; kind: 'metadata' | 'search'; data: ArrayBuffer }): void {
    this.posted.push(message);
  }
}

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

  it('routes search pages through FIFO before the next metadata extraction', async () => {
    const worker = new FakeWorker();
    const extractor = new KnowledgeExtractorWorker({ createWorker: () => worker as never });

    const search = extractor.extractSearchPages(new Uint8Array([1]));
    const metadata = extractor.extract(new Uint8Array([2]));

    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]).toMatchObject({ kind: 'search' });
    worker.emit('message', {
      id: worker.posted[0]?.id,
      kind: 'search',
      ok: true,
      result: [{ pageNumber: 1, items: [{ str: 'Recovery', hasEOL: false }] }],
    });
    await expect(search).resolves.toEqual([
      { pageNumber: 1, items: [{ str: 'Recovery', hasEOL: false }] },
    ]);

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

  it('restarts after a timed-out search job before processing metadata work', async () => {
    vi.useFakeTimers();
    const firstWorker = new FakeWorker();
    const replacement = new FakeWorker();
    const workers = [firstWorker, replacement];
    const extractor = new KnowledgeExtractorWorker({
      createWorker: () => workers.shift() as never,
      timeoutMs: 30_000,
    });

    const search = extractor.extractSearchPages(new Uint8Array([1]));
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
});
