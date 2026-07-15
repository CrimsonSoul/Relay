import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord, KnowledgeOutlineNode } from '@shared/knowledge';
import { getDocument, TextLayer } from 'pdfjs-dist/build/pdf.mjs';
import { KnowledgePdfViewer } from '../KnowledgePdfViewer';

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf-worker.js' }));
vi.mock('pdfjs-dist/build/pdf.mjs', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
  RenderingCancelledException: class RenderingCancelledException extends Error {},
  TextLayer: vi.fn(function MockTextLayer() {
    return { render: vi.fn(async () => undefined), cancel: vi.fn() };
  }),
}));

const getDocumentMock = vi.mocked(getDocument);
const TextLayerMock = vi.mocked(TextLayer);

function record(): KnowledgeDocumentRecord {
  return {
    id: 'doc-1',
    sourceKey: 'General/Guide.pdf',
    category: 'General',
    title: 'Operator guide',
    fileName: 'Guide.pdf',
    pdf: 'Guide.pdf',
    checksum: 'a'.repeat(64),
    byteSize: 1024,
    pageCount: 3,
    outline: [],
    outlineSource: 'none',
    sourceModifiedAt: '2026-07-14T12:00:00.000Z',
    indexedAt: '2026-07-14T12:00:00.000Z',
    created: '2026-07-14T12:00:00.000Z',
    updated: '2026-07-14T12:00:00.000Z',
  };
}

describe('KnowledgePdfViewer', () => {
  const getKnowledgePdf = vi.fn();
  const renderTask = { promise: Promise.resolve(), cancel: vi.fn() };
  const getPage = vi.fn(async (pageNumber: number) => ({
    pageNumber,
    cleanup: vi.fn(),
    getOperatorList: vi.fn(async () => ({ fnArray: [], argsArray: [] })),
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      scale,
      convertToViewportPoint: (_x: number, top: number) => [0, (800 - top) * scale],
    }),
    render: vi.fn(() => renderTask),
    getTextContent: vi.fn(async () => ({ items: [], styles: {} })),
  }));
  const destroy = vi.fn(async () => undefined);
  const loadingDestroy = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
    getKnowledgePdf.mockResolvedValue({
      ok: true,
      data: new Uint8Array([1, 2, 3]).buffer,
      checksum: 'a'.repeat(64),
      source: 'server',
    });
    globalThis.api = { getKnowledgePdf } as never;
    getDocumentMock.mockReturnValue({
      promise: Promise.resolve({ numPages: 3, getPage, destroy }),
      destroy: loadingDestroy,
    } as never);
  });

  afterEach(() => {
    delete globalThis.api;
    vi.restoreAllMocks();
  });

  it('loads the selected PDF through Relay with script execution disabled and renders selectable text', async () => {
    render(<KnowledgePdfViewer document={record()} active target={null} onPageChange={vi.fn()} />);

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(getKnowledgePdf).toHaveBeenCalledWith({ documentId: 'doc-1', checksum: 'a'.repeat(64) });
    expect(getDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        isEvalSupported: false,
        disableAutoFetch: true,
        disableStream: true,
        enableXfa: false,
      }),
    );
    await waitFor(() => expect(TextLayerMock).toHaveBeenCalled());
  });

  it('navigates pages and follows an outline target', async () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <KnowledgePdfViewer document={record()} active target={null} onPageChange={onPageChange} />,
    );
    await screen.findByText('Page 1 of 3');

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(onPageChange).toHaveBeenCalledWith(1);

    const target: KnowledgeOutlineNode = {
      id: 'heading',
      label: 'Recovery',
      level: 1,
      pageIndex: 2,
      top: 650,
    };
    rerender(
      <KnowledgePdfViewer document={record()} active target={target} onPageChange={onPageChange} />,
    );
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
  });

  it('shows the active section without replacing it when the target page opens', async () => {
    const onPageChange = vi.fn();
    const target: KnowledgeOutlineNode = {
      id: 'heading',
      label: 'Recovery procedure',
      level: 1,
      pageIndex: 1,
      top: 650,
    };
    render(
      <KnowledgePdfViewer
        document={record()}
        active
        target={target}
        currentSection="Recovery procedure"
        onPageChange={onPageChange}
      />,
    );

    expect(await screen.findByText('Current section · Recovery procedure')).toBeInTheDocument();
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('shows a useful offline state without exposing download or print controls', async () => {
    getKnowledgePdf.mockResolvedValue({ ok: false, error: 'not-available-offline' });
    render(<KnowledgePdfViewer document={record()} active target={null} onPageChange={vi.fn()} />);

    expect(await screen.findByText(/not cached on this laptop/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /print/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry document' })).toBeInTheDocument();
  });

  it('retries the active document after a transient load failure', async () => {
    getKnowledgePdf
      .mockResolvedValueOnce({ ok: false, error: 'download-failed' })
      .mockResolvedValueOnce({
        ok: true,
        data: new Uint8Array([1, 2, 3]).buffer,
        checksum: 'a'.repeat(64),
        source: 'server',
      });
    render(<KnowledgePdfViewer document={record()} active target={null} onPageChange={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Retry document' }));

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(getKnowledgePdf).toHaveBeenCalledTimes(2);
  });

  it('destroys an opened document through a single ownership path on unmount', async () => {
    const { unmount } = render(
      <KnowledgePdfViewer document={record()} active target={null} onPageChange={vi.fn()} />,
    );
    await screen.findByText('Page 1 of 3');

    unmount();
    expect(destroy).toHaveBeenCalledOnce();
    expect(loadingDestroy).not.toHaveBeenCalled();
  });
});
