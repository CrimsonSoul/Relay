import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeExtractorWorker } from './KnowledgeExtractorWorker';

class FakeWorker extends EventEmitter {
  readonly posted: Array<{ id: number; data: ArrayBuffer }> = [];
  readonly terminate = vi.fn(async () => 0);

  postMessage(message: { id: number; data: ArrayBuffer }): void {
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
      ok: true,
      result: { metadataTitle: null, pageCount: 1, outline: [], outlineSource: 'none' },
    });
    await expect(first).resolves.toMatchObject({ pageCount: 1 });
    expect(worker.posted).toHaveLength(2);

    worker.emit('message', {
      id: worker.posted[1]?.id,
      ok: true,
      result: { metadataTitle: 'Second', pageCount: 2, outline: [], outlineSource: 'none' },
    });
    await expect(second).resolves.toMatchObject({ metadataTitle: 'Second' });
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
