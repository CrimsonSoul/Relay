import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDocument } from 'pdfjs-dist/build/pdf.mjs';
import { useKnowledgePdfSession } from '../useKnowledgePdfSession';

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf-worker.js' }));
vi.mock('pdfjs-dist/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
}));

const getDocumentMock = vi.mocked(getDocument);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useKnowledgePdfSession', () => {
  const getKnowledgePdf = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    getKnowledgePdf.mockResolvedValue({
      ok: true,
      data: new Uint8Array([1, 2, 3]).buffer,
      checksum: 'a'.repeat(64),
      source: 'server',
    });
    globalThis.api = { getKnowledgePdf } as never;
  });

  afterEach(() => {
    delete globalThis.api;
  });

  it('publishes only the current generation and disposes a superseded load', async () => {
    const staleLoad = deferred<{ numPages: number }>();
    const currentPdf = { numPages: 4 };
    const stalePdf = { numPages: 2 };
    const staleDestroy = vi.fn(async () => undefined);
    const currentDestroy = vi.fn(async () => undefined);
    getDocumentMock
      .mockReturnValueOnce({ promise: staleLoad.promise, destroy: staleDestroy } as never)
      .mockReturnValueOnce({
        promise: Promise.resolve(currentPdf),
        destroy: currentDestroy,
      } as never);
    const onSessionChange = vi.fn();
    const onLoadStart = vi.fn();
    const { result, rerender } = renderHook(
      ({ checksum }) =>
        useKnowledgePdfSession({
          active: true,
          documentId: 'doc-1',
          checksum,
          onSessionChange,
          onLoadStart,
        }),
      { initialProps: { checksum: 'a'.repeat(64) } },
    );
    await waitFor(() => expect(getDocumentMock).toHaveBeenCalledOnce());

    rerender({ checksum: 'b'.repeat(64) });
    await waitFor(() => expect(result.current.session?.pdf).toBe(currentPdf));
    expect(result.current.session).toMatchObject({
      documentId: 'doc-1',
      checksum: 'b'.repeat(64),
      generation: 2,
    });

    await act(async () => {
      staleLoad.resolve(stalePdf);
      await staleLoad.promise;
    });

    expect(onSessionChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ pdf: stalePdf, checksum: 'a'.repeat(64) }),
    );
    expect(staleDestroy).toHaveBeenCalledOnce();
    expect(onLoadStart).toHaveBeenNthCalledWith(1, { preserveViewState: false });
    expect(onLoadStart).toHaveBeenNthCalledWith(2, { preserveViewState: false });
  });

  it('retries the same document while preserving its view state', async () => {
    const pdf = { numPages: 3 };
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve(pdf),
      destroy: vi.fn(async () => undefined),
    } as never);
    const onLoadStart = vi.fn();
    const { result } = renderHook(() =>
      useKnowledgePdfSession({
        active: true,
        documentId: 'doc-1',
        checksum: 'a'.repeat(64),
        onLoadStart,
      }),
    );
    await waitFor(() => expect(result.current.session?.pdf).toBe(pdf));

    act(() => result.current.retry());
    await waitFor(() => expect(getKnowledgePdf).toHaveBeenCalledTimes(2));

    expect(onLoadStart).toHaveBeenNthCalledWith(2, { preserveViewState: true });
  });
});
