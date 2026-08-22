import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextLayer } from 'pdfjs-dist/build/pdf.mjs';
import type { KnowledgeResolvedLink } from '../knowledgeLinkResolver';
import type { KnowledgeDocumentSearchMatch } from '../knowledgeDocumentSearch';
import { KnowledgePdfPage } from '../KnowledgePdfPage';

vi.mock('pdfjs-dist/build/pdf.mjs', () => ({
  AnnotationType: { LINK: 2 },
  RenderingCancelledException: class RenderingCancelledException extends Error {},
  TextLayer: vi.fn(function MockTextLayer({ container }: { container: HTMLElement }) {
    const textDivs: HTMLElement[] = [];
    return {
      render: vi.fn(async () => {
        const span = document.createElement('span');
        span.textContent = 'Reset the lane service';
        textDivs.push(span);
        container.append(span);
      }),
      cancel: vi.fn(),
      textDivs,
    };
  }),
}));

const TextLayerMock = vi.mocked(TextLayer);

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('KnowledgePdfPage', () => {
  const onActivateResolvedLink = vi.fn();
  const onActivateDestination = vi.fn();
  const onStatus = vi.fn();
  const resolveUrl = vi.fn((): KnowledgeResolvedLink => ({
    kind: 'unavailable',
    reason: 'unsupported',
  }));
  const firstRenderTask = { promise: Promise.resolve(), cancel: vi.fn() };
  const secondRenderTask = { promise: Promise.resolve(), cancel: vi.fn() };
  const pageCleanup = vi.fn();
  const getViewport = vi.fn(({ scale }: { scale: number }) => ({
    width: 600 * scale,
    height: 800 * scale,
    scale,
    convertToViewportPoint: (x: number, y: number) => [x * scale, (800 - y) * scale],
  }));
  const renderPage = vi.fn();
  const page = {
    cleanup: pageCleanup,
    getViewport,
    render: renderPage,
    getTextContent: vi.fn(async () => ({ items: [], styles: {} })),
    // pdf.js hands back loosely-typed annotation dictionaries, and
    // `extractKnowledgeLinkItems` narrows them itself, so the fixtures stay `unknown`.
    getAnnotations: vi.fn(async (): Promise<unknown[]> => []),
  };
  const getPage = vi.fn(async () => page);
  const pdf = { numPages: 3, getPage };

  function props(overrides = {}) {
    return {
      pdf: pdf as never,
      pageIndex: 0,
      scale: 1,
      render: true,
      targetTop: null,
      retryKey: 0,
      resolveUrl,
      onActivateResolvedLink,
      onActivateDestination,
      onStatus,
      ...overrides,
    };
  }

  const searchMatch: KnowledgeDocumentSearchMatch = {
    id: '0:0:0',
    pageIndex: 0,
    matchIndex: 0,
    snippet: 'Reset the lane service',
    sectionLabel: 'Recovery',
    normalizedStart: 0,
    normalizedEnd: 22,
    textItemRange: { start: 0, end: 0 },
    domRange: {
      start: { itemIndex: 0, itemOffset: 0 },
      end: { itemIndex: 0, itemOffset: 22 },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
    Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1.5 });
    renderPage.mockReturnValueOnce(firstRenderTask).mockReturnValueOnce(secondRenderTask);
    getPage.mockResolvedValue(page);
    page.getAnnotations.mockResolvedValue([]);
  });

  afterEach(() => vi.restoreAllMocks());

  it('renders search highlights after the selectable text layer is ready', async () => {
    vi.spyOn(document, 'createRange').mockReturnValue({
      setStart: vi.fn(),
      setEnd: vi.fn(),
      getClientRects: vi.fn(() => [DOMRect.fromRect({ x: 30, y: 120, width: 140, height: 18 })]),
    } as unknown as Range);
    const onActiveSearchHighlightReady = vi.fn();

    render(
      <KnowledgePdfPage
        {...props({
          searchMatches: [searchMatch],
          activeSearchResultId: searchMatch.id,
          onActiveSearchHighlightReady,
        })}
      />,
    );

    expect(await screen.findByTestId('knowledge-search-highlight-active')).toBeInTheDocument();
    expect(onActiveSearchHighlightReady).toHaveBeenCalledWith(searchMatch.id, 0, 120);
  });

  it('labels rendered spans with their source PDF text-item indices', async () => {
    render(<KnowledgePdfPage {...props()} />);

    const textLayer = await screen.findByTestId('knowledge-pdf-page-shell');
    await waitFor(() =>
      expect(textLayer.querySelector('.knowledge-page__text-layer span')).toHaveAttribute(
        'data-knowledge-text-item-index',
        '0',
      ),
    );
  });

  it('renders the canvas at device pixel ratio with selectable text and safe link annotations', async () => {
    page.getAnnotations.mockResolvedValue([
      {
        subtype: 'Link',
        id: 'guide',
        rect: [10, 20, 30, 40],
        url: 'https://relay.example/guide',
      },
    ]);
    resolveUrl.mockReturnValue({
      kind: 'web',
      url: 'https://relay.example/guide',
      hostname: 'relay.example',
    });
    render(<KnowledgePdfPage {...props()} />);

    const canvas = await screen.findByLabelText('Page 1');
    expect(canvas).toHaveAttribute('width', '900');
    expect(canvas).toHaveAttribute('height', '1200');
    expect(TextLayerMock).toHaveBeenCalledOnce();
    fireEvent.click(await screen.findByRole('button', { name: 'Open relay.example in browser' }));
    expect(onActivateResolvedLink).toHaveBeenCalledWith({
      kind: 'web',
      url: 'https://relay.example/guide',
      hostname: 'relay.example',
    });
    expect(onStatus).toHaveBeenCalledWith({
      state: 'ready',
      pageIndex: 0,
      width: 600,
      height: 800,
    });
  });

  it('renders only a page shell while rendering is deferred', () => {
    render(<KnowledgePdfPage {...props({ render: false })} />);

    expect(screen.getByTestId('knowledge-pdf-page-shell')).toBeInTheDocument();
    expect(screen.queryByLabelText('Page 1')).not.toBeInTheDocument();
    expect(getPage).not.toHaveBeenCalled();
  });

  it('keeps a page error local and retries only that page', async () => {
    getPage.mockRejectedValueOnce(new Error('corrupt page')).mockResolvedValueOnce(page);
    render(<KnowledgePdfPage {...props()} />);

    expect(await screen.findByRole('status', { name: 'Page 1 rendering error' })).toHaveAttribute(
      'aria-live',
      'polite',
    );
    expect(screen.getByRole('button', { name: 'Retry page 1' })).toBeInTheDocument();
    expect(onStatus).toHaveBeenCalledWith({
      state: 'error',
      pageIndex: 0,
      message: 'Relay could not render this page.',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry page 1' }));
    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(onStatus).toHaveBeenLastCalledWith({
        state: 'ready',
        pageIndex: 0,
        width: 600,
        height: 800,
      }),
    );
  });

  it('cancels sibling work and defers cleanup when one page render task fails', async () => {
    const canvasRender = deferred<void>();
    const textRender = deferred<void>();
    const renderTask = { promise: canvasRender.promise, cancel: vi.fn() };
    const textLayer = { render: vi.fn(() => textRender.promise), cancel: vi.fn() };
    renderPage.mockReset().mockReturnValue(renderTask);
    TextLayerMock.mockImplementationOnce(function DeferredTextLayer() {
      return textLayer as never;
    });

    render(<KnowledgePdfPage {...props({ pageIndex: 1 })} />);
    await waitFor(() => expect(textLayer.render).toHaveBeenCalledOnce());

    canvasRender.reject(new Error('canvas failed'));

    await waitFor(() => expect(renderTask.cancel).toHaveBeenCalledOnce());
    expect(textLayer.cancel).toHaveBeenCalledOnce();
    expect(pageCleanup).not.toHaveBeenCalled();

    textRender.resolve();
    await waitFor(() => expect(pageCleanup).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole('status', { name: 'Page 2 rendering error' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry page 2' })).toBeInTheDocument();
  });

  it('cancels in-flight canvas and text-layer work without reporting stale status', async () => {
    const canvasRender = deferred<void>();
    const textRender = deferred<void>();
    const renderTask = { promise: canvasRender.promise, cancel: vi.fn() };
    const textLayer = { render: vi.fn(() => textRender.promise), cancel: vi.fn() };
    renderPage.mockReset().mockReturnValue(renderTask);
    TextLayerMock.mockImplementationOnce(function DeferredTextLayer() {
      return textLayer as never;
    });

    const { rerender } = render(<KnowledgePdfPage {...props()} />);
    await waitFor(() => expect(textLayer.render).toHaveBeenCalledOnce());

    rerender(<KnowledgePdfPage {...props({ render: false })} />);

    expect(renderTask.cancel).toHaveBeenCalledOnce();
    expect(textLayer.cancel).toHaveBeenCalledOnce();
    expect(pageCleanup).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();

    canvasRender.resolve();
    await canvasRender.promise;
    expect(pageCleanup).not.toHaveBeenCalled();

    textRender.resolve();
    await textRender.promise;
    await waitFor(() => expect(pageCleanup).toHaveBeenCalledOnce());
    expect(onStatus).not.toHaveBeenCalled();
  });

  it('cancels stale render tasks when scale changes', async () => {
    const { rerender } = render(<KnowledgePdfPage {...props({ scale: 1 })} />);
    await waitFor(() => expect(renderPage).toHaveBeenCalledOnce());

    rerender(<KnowledgePdfPage {...props({ scale: 1.25 })} />);

    expect(firstRenderTask.cancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(getViewport).toHaveBeenCalledWith({ scale: 1.25 }));
  });

  it('cancels page work and cleans up when unmounted', async () => {
    const { unmount } = render(<KnowledgePdfPage {...props()} />);
    await waitFor(() => expect(renderPage).toHaveBeenCalledOnce());

    unmount();

    expect(firstRenderTask.cancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(pageCleanup).toHaveBeenCalledOnce());
  });
});
