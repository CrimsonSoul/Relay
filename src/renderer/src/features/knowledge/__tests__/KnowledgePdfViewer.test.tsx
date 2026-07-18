import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import { getDocument, TextLayer } from 'pdfjs-dist/build/pdf.mjs';
import type { KnowledgeResolvedLink } from '../knowledgeLinkResolver';
import type { KnowledgeViewerTarget } from '../knowledgePdfDestination';
import { KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY } from '../knowledgePdfViewMode';
import { KnowledgePdfViewer } from '../KnowledgePdfViewer';

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdf-worker.js' }));
vi.mock('pdfjs-dist/build/pdf.mjs', () => ({
  AnnotationType: { LINK: 2 },
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(),
  RenderingCancelledException: class RenderingCancelledException extends Error {},
  TextLayer: vi.fn(function MockTextLayer() {
    return { render: vi.fn(async () => undefined), cancel: vi.fn() };
  }),
}));

const getDocumentMock = vi.mocked(getDocument);
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

type ObserverEntry = {
  target: Element;
  intersectionRatio: number;
  isIntersecting?: boolean;
};

class IntersectionObserverDouble {
  static readonly instances: IntersectionObserverDouble[] = [];

  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    IntersectionObserverDouble.instances.push(this);
  }

  showPage(target: Element): void {
    this.emit([{ target, intersectionRatio: 1 }]);
  }

  emit(entries: ObserverEntry[]): void {
    this.callback(
      entries.map(
        ({ target, intersectionRatio, isIntersecting = intersectionRatio > 0 }) =>
          ({ target, intersectionRatio, isIntersecting }) as IntersectionObserverEntry,
      ),
      this as unknown as IntersectionObserver,
    );
  }
}

function record(overrides: Partial<KnowledgeDocumentRecord> = {}): KnowledgeDocumentRecord {
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
    ...overrides,
  };
}

describe('KnowledgePdfViewer', () => {
  const getKnowledgePdf = vi.fn();
  const renderTask = { promise: Promise.resolve(), cancel: vi.fn() };
  const annotationMocks = new Map<number, ReturnType<typeof vi.fn>>();
  const operatorListMocks = new Map<number, ReturnType<typeof vi.fn>>();
  const resolveUrl = vi.fn(
    (): KnowledgeResolvedLink => ({ kind: 'unavailable', reason: 'unsupported' }),
  );
  const onActivateResolvedLink = vi.fn();
  const onDestinationChange = vi.fn();
  const onPageChange = vi.fn();
  const destroy = vi.fn(async () => undefined);
  const loadingDestroy = vi.fn(async () => undefined);
  const getDestination = vi.fn(async () => null);
  const getPageIndex = vi.fn(async () => 0);

  function getAnnotations(pageNumber: number) {
    let mock = annotationMocks.get(pageNumber);
    if (!mock) {
      mock = vi.fn(async () => []);
      annotationMocks.set(pageNumber, mock);
    }
    return mock;
  }

  function getOperatorList(pageNumber: number) {
    let mock = operatorListMocks.get(pageNumber);
    if (!mock) {
      mock = vi.fn(async () => ({ fnArray: [], argsArray: [] }));
      operatorListMocks.set(pageNumber, mock);
    }
    return mock;
  }

  function page(pageNumber: number) {
    return {
      pageNumber,
      cleanup: vi.fn(),
      getOperatorList: getOperatorList(pageNumber),
      getViewport: ({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
        scale,
        convertToViewportPoint: (_x: number, top: number) => [0, (800 - top) * scale],
        convertToViewportRectangle: (rect: number[]) =>
          rect.map((coordinate) => coordinate * scale),
      }),
      render: vi.fn(() => renderTask),
      getTextContent: vi.fn(async () => ({ items: [], styles: {} })),
      getAnnotations: getAnnotations(pageNumber),
    };
  }

  const getPage = vi.fn(async (pageNumber: number) => page(pageNumber));

  function pdf(overrides = {}) {
    return {
      numPages: 3,
      getPage,
      getDestination,
      getPageIndex,
      destroy,
      ...overrides,
    };
  }

  function viewerProps(overrides = {}) {
    return {
      document: record(),
      active: true,
      target: null,
      resolveUrl,
      onActivateResolvedLink,
      onDestinationChange,
      onPageChange,
      ...overrides,
    };
  }

  function renderComponent(overrides = {}) {
    return render(<KnowledgePdfViewer {...viewerProps(overrides)} />);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY, 'single');
    IntersectionObserverDouble.instances.splice(0);
    vi.stubGlobal('IntersectionObserver', IntersectionObserverDouble);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false })) as unknown as typeof globalThis.matchMedia,
    );
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    annotationMocks.clear();
    operatorListMocks.clear();
    getPage.mockImplementation(async (pageNumber: number) => page(pageNumber));
    resolveUrl.mockReturnValue({ kind: 'unavailable', reason: 'unsupported' });
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
      promise: Promise.resolve(pdf()),
      destroy: loadingDestroy,
    } as never);
  });

  it('labels the empty destination as the Wiki reader', () => {
    renderComponent({ document: null });

    expect(screen.getByText('Wiki reader')).toBeInTheDocument();
    expect(screen.queryByText('Focus reader')).not.toBeInTheDocument();
  });

  afterEach(() => {
    delete globalThis.api;
    localStorage.clear();
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('defaults to a pressed Continuous control and tracks the most visible page', async () => {
    localStorage.removeItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY);
    const { container } = renderComponent();

    expect(await screen.findByRole('button', { name: 'View: Continuous' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('region', { name: 'Continuous PDF pages' })).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();

    const pageThree = container.querySelector<HTMLElement>('[data-page-index="2"]');
    expect(pageThree).not.toBeNull();
    await waitFor(() => expect(IntersectionObserverDouble.instances).toHaveLength(1));
    act(() => IntersectionObserverDouble.instances[0].showPage(pageThree!));

    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(onPageChange).toHaveBeenLastCalledWith(2);
  });

  it('keeps the uniquely named mode control focused while its pressed state and name change', async () => {
    localStorage.removeItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY);
    renderComponent();

    const continuousMode = await screen.findByRole('button', { name: 'View: Continuous' });
    expect(screen.getAllByRole('button', { name: /^View:/ })).toHaveLength(1);
    continuousMode.focus();
    fireEvent.click(continuousMode);

    const singleMode = await screen.findByRole('button', { name: 'View: Single page' });
    expect(singleMode).toHaveAttribute('aria-pressed', 'false');
    expect(singleMode).toHaveFocus();

    fireEvent.click(singleMode);
    const restoredContinuousMode = await screen.findByRole('button', {
      name: 'View: Continuous',
    });
    expect(restoredContinuousMode).toHaveAttribute('aria-pressed', 'true');
    expect(restoredContinuousMode).toHaveFocus();
  });

  it('reads a cached offline PDF in Continuous and Single without another fetch or load', async () => {
    localStorage.removeItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY);
    getKnowledgePdf.mockResolvedValue({
      ok: true,
      data: new Uint8Array([1, 2, 3]).buffer,
      checksum: 'a'.repeat(64),
      source: 'cache',
    });
    renderComponent();

    expect(await screen.findByRole('region', { name: 'Continuous PDF pages' })).toBeInTheDocument();
    expect(screen.getByLabelText('Page 1')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View: Continuous' }));

    expect(await screen.findByRole('button', { name: 'View: Single page' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByLabelText('Page 1')).toBeVisible();
    expect(screen.queryByText(/not cached on this laptop/i)).not.toBeInTheDocument();
    expect(getKnowledgePdf).toHaveBeenCalledOnce();
    expect(getDocumentMock).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
  });

  it('uses instant scrolling for a Single-page destination when reduced motion is requested', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
      })) as unknown as typeof globalThis.matchMedia,
    );
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    renderComponent({
      target: { pageIndex: 1, top: 650 },
      currentSection: 'Reduced-motion destination',
    });

    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 129.5, behavior: 'auto' }));
  });

  it('switches modes on the shared current page without refetching or destroying the PDF', async () => {
    localStorage.removeItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY);
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    const { container } = renderComponent();
    await screen.findByText('Page 1 of 3');
    const pageTwo = container.querySelector<HTMLElement>('[data-page-index="1"]');
    expect(pageTwo).not.toBeNull();

    act(() => IntersectionObserverDouble.instances[0].showPage(pageTwo!));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'View: Continuous' }));

    expect(await screen.findByRole('button', { name: 'View: Single page' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByLabelText('Page 2')).toBeVisible();
    expect(localStorage.getItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY)).toBe('single');
    expect(getKnowledgePdf).toHaveBeenCalledOnce();
    expect(getDocumentMock).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();

    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0 }));
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'View: Single page' }));

    expect(await screen.findByRole('button', { name: 'View: Continuous' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' })),
    );
    expect(scrollTo.mock.calls).toEqual([[expect.objectContaining({ behavior: 'smooth' })]]);
    expect(localStorage.getItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY)).toBe('continuous');
    expect(getKnowledgePdf).toHaveBeenCalledOnce();
    expect(getDocumentMock).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
  });

  it('consumes a saved Single target before manual navigation and restores the manual page', async () => {
    const offsetTop = vi
      .spyOn(HTMLElement.prototype, 'offsetTop', 'get')
      .mockImplementation(function mockPageOffset(this: HTMLElement) {
        const pageShellIndex = this.dataset.pageIndex;
        return pageShellIndex === undefined ? 0 : Number(pageShellIndex) * 1000;
      });
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    renderComponent({ target: { pageIndex: 1, top: null }, currentSection: 'Saved target' });
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    await waitFor(() => expect(getAnnotations(2)).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
    await waitFor(() => expect(getAnnotations(3)).toHaveBeenCalled());

    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'View: Single page' }));

    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
    await waitFor(() => expect(scrollTo.mock.calls).toEqual([[{ top: 1972, behavior: 'smooth' }]]));
    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenCalledWith(2);
    expect(getKnowledgePdf).toHaveBeenCalledOnce();
    offsetTop.mockRestore();
  });

  it('reopens a fresh same-valued target in Single without reacting to stable rerenders', async () => {
    const initialTarget: KnowledgeViewerTarget = { pageIndex: 1, top: null };
    const { rerender } = renderComponent({
      target: initialTarget,
      currentSection: 'Repeated Single target',
    });
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    await waitFor(() => expect(getAnnotations(2)).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
    await waitFor(() => expect(getAnnotations(3)).toHaveBeenCalledTimes(1));

    rerender(
      <KnowledgePdfViewer
        {...viewerProps({ target: initialTarget, currentSection: 'Incidental Single rerender' })}
      />,
    );
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(getAnnotations(2)).toHaveBeenCalledTimes(1);

    const repeatedTarget: KnowledgeViewerTarget = { pageIndex: 1, top: null };
    rerender(
      <KnowledgePdfViewer
        {...viewerProps({ target: repeatedTarget, currentSection: 'Repeated Single target' })}
      />,
    );
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    await waitFor(() => expect(getAnnotations(2)).toHaveBeenCalledTimes(2));

    rerender(
      <KnowledgePdfViewer
        {...viewerProps({ target: repeatedTarget, currentSection: 'Second incidental rerender' })}
      />,
    );
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(getAnnotations(2)).toHaveBeenCalledTimes(2);
    expect(onPageChange.mock.calls).toEqual([[2]]);
    expect(getKnowledgePdf).toHaveBeenCalledOnce();
    expect(getDocumentMock).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
  });

  it('scrolls a fresh same-page Single target to the top without reacting to stable rerenders', async () => {
    const initialTarget: KnowledgeViewerTarget = { pageIndex: 1, top: null };
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    const { container, rerender } = renderComponent({
      target: initialTarget,
      currentSection: 'Same-page Single target',
    });
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    await waitFor(() => expect(getAnnotations(2)).toHaveBeenCalledTimes(1));
    const viewport = container.querySelector<HTMLElement>('.knowledge-viewer__viewport');
    expect(viewport).not.toBeNull();
    Object.defineProperty(viewport!, 'scrollTop', { configurable: true, value: 420 });

    scrollTo.mockClear();
    rerender(
      <KnowledgePdfViewer
        {...viewerProps({ target: initialTarget, currentSection: 'Incidental Single rerender' })}
      />,
    );
    expect(scrollTo).not.toHaveBeenCalled();

    const repeatedTarget: KnowledgeViewerTarget = { pageIndex: 1, top: null };
    rerender(
      <KnowledgePdfViewer
        {...viewerProps({ target: repeatedTarget, currentSection: 'Same-page Single target' })}
      />,
    );
    await waitFor(() => expect(scrollTo.mock.calls).toEqual([[{ top: 0 }]]));

    scrollTo.mockClear();
    rerender(
      <KnowledgePdfViewer
        {...viewerProps({ target: repeatedTarget, currentSection: 'Second incidental rerender' })}
      />,
    );
    expect(scrollTo).not.toHaveBeenCalled();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(getAnnotations(2)).toHaveBeenCalledTimes(1);
    expect(onPageChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'View: Single page' }));
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' })),
    );
    scrollTo.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'View: Continuous' }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    await waitFor(() => expect(scrollTo.mock.calls).toEqual([[{ top: 0 }]]));
    expect(getAnnotations(2)).toHaveBeenCalledTimes(3);
    expect(getKnowledgePdf).toHaveBeenCalledOnce();
    expect(getDocumentMock).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
  });

  it('uses continuous previous and next controls without feeding observer updates back into scroll', async () => {
    localStorage.removeItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY);
    const { container } = renderComponent();
    await screen.findByText('Page 1 of 3');
    const viewport = screen.getByRole('region', { name: 'Continuous PDF pages' });
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;
    const pages = [...container.querySelectorAll<HTMLElement>('[data-page-index]')];
    Object.defineProperty(pages[0], 'offsetTop', { configurable: true, value: 200 });
    Object.defineProperty(pages[1], 'offsetTop', { configurable: true, value: 1000 });
    Object.defineProperty(pages[2], 'offsetTop', { configurable: true, value: 1600 });

    await waitFor(() => expect(IntersectionObserverDouble.instances).toHaveLength(1));
    act(() => IntersectionObserverDouble.instances[0].showPage(pages[1]));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(scrollTo).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 172, behavior: 'smooth' });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1572, behavior: 'smooth' });
  });

  it('consumes a same-page ready target after scrolling so later observer pages remain current', async () => {
    localStorage.removeItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY);
    const { container, rerender } = renderComponent();
    await screen.findByText('Page 1 of 3');
    await waitFor(() => expect(TextLayerMock).toHaveBeenCalled());
    const viewport = screen.getByRole('region', { name: 'Continuous PDF pages' });
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;
    const pages = [...container.querySelectorAll<HTMLElement>('[data-page-index]')];
    Object.defineProperty(pages[0], 'offsetTop', { configurable: true, value: 200 });

    rerender(
      <KnowledgePdfViewer
        {...viewerProps({ target: { pageIndex: 0, top: 650 }, currentSection: 'Overview target' })}
      />,
    );

    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 329.5, behavior: 'smooth' }));
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();

    act(() => {
      IntersectionObserverDouble.instances[0].emit([
        { target: pages[0], intersectionRatio: 0 },
        { target: pages[1], intersectionRatio: 1 },
      ]);
    });

    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenLastCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: 'View: Continuous' }));
    expect(await screen.findByLabelText('Page 2')).toBeVisible();
  });

  it('releases a cross-page target that becomes visible before it finishes rendering', async () => {
    localStorage.removeItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY);
    const pageTwoText = deferred<{ items: never[]; styles: Record<string, never> }>();
    getPage.mockImplementation(async (pageNumber: number) => {
      const loadedPage = page(pageNumber);
      if (pageNumber === 2) loadedPage.getTextContent = vi.fn(() => pageTwoText.promise);
      return loadedPage;
    });
    const { container, rerender } = renderComponent();
    await screen.findByText('Page 1 of 3');
    const viewport = screen.getByRole('region', { name: 'Continuous PDF pages' });
    viewport.scrollTo = vi.fn();
    const pages = [...container.querySelectorAll<HTMLElement>('[data-page-index]')];

    rerender(
      <KnowledgePdfViewer
        {...viewerProps({ target: { pageIndex: 1, top: null }, currentSection: 'Delayed target' })}
      />,
    );
    await waitFor(() => expect(viewport.scrollTo).toHaveBeenCalled());
    act(() => {
      IntersectionObserverDouble.instances[0].emit([
        { target: pages[0], intersectionRatio: 0 },
        { target: pages[1], intersectionRatio: 1 },
      ]);
    });
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();

    await act(async () => {
      pageTwoText.resolve({ items: [], styles: {} });
      await pageTwoText.promise;
    });
    await waitFor(() => expect(TextLayerMock).toHaveBeenCalledTimes(3));

    act(() => {
      IntersectionObserverDouble.instances[0].emit([
        { target: pages[1], intersectionRatio: 0 },
        { target: pages[2], intersectionRatio: 1 },
      ]);
    });

    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    expect(onPageChange).toHaveBeenCalledTimes(1);
    expect(onPageChange).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: 'View: Continuous' }));
    expect(await screen.findByLabelText('Page 3')).toBeVisible();
  });

  it('rearms a fresh explicit target with the same page and offset only once', async () => {
    localStorage.removeItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY);
    const offsetTop = vi
      .spyOn(HTMLElement.prototype, 'offsetTop', 'get')
      .mockImplementation(function mockPageOffset(this: HTMLElement) {
        const pageShellIndex = this.dataset.pageIndex;
        return pageShellIndex === undefined ? 0 : Number(pageShellIndex) * 1000;
      });
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    const initialTarget: KnowledgeViewerTarget = { pageIndex: 1, top: null };
    const { container, rerender } = renderComponent({
      target: initialTarget,
      currentSection: 'Repeated target',
    });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 972, behavior: 'smooth' }));
    const pages = [...container.querySelectorAll<HTMLElement>('[data-page-index]')];
    act(() => IntersectionObserverDouble.instances[0].showPage(pages[1]));
    act(() => {
      IntersectionObserverDouble.instances[0].emit([
        { target: pages[1], intersectionRatio: 0 },
        { target: pages[2], intersectionRatio: 1 },
      ]);
    });
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();

    scrollTo.mockClear();
    rerender(
      <KnowledgePdfViewer
        {...viewerProps({ target: initialTarget, currentSection: 'Incidental rerender' })}
      />,
    );
    expect(scrollTo).not.toHaveBeenCalled();

    const repeatedTarget: KnowledgeViewerTarget = { pageIndex: 1, top: null };
    rerender(
      <KnowledgePdfViewer
        {...viewerProps({ target: repeatedTarget, currentSection: 'Repeated target' })}
      />,
    );
    await waitFor(() => expect(scrollTo.mock.calls).toEqual([[{ top: 972, behavior: 'smooth' }]]));
    act(() => IntersectionObserverDouble.instances[0].showPage(pages[1]));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(onPageChange.mock.calls).toEqual([[2], [1]]);

    scrollTo.mockClear();
    rerender(
      <KnowledgePdfViewer
        {...viewerProps({ target: repeatedTarget, currentSection: 'Second incidental rerender' })}
      />,
    );
    expect(scrollTo).not.toHaveBeenCalled();
    expect(getKnowledgePdf).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
    offsetTop.mockRestore();
  });

  it.each([
    ['fractional', 1.8, 1, 972],
    ['out-of-range', 8.7, 2, 1972],
  ])(
    'normalizes a %s target before Continuous consumption',
    async (_label, requestedPageIndex, expectedPageIndex, expectedScrollTop) => {
      localStorage.removeItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY);
      const offsetTop = vi
        .spyOn(HTMLElement.prototype, 'offsetTop', 'get')
        .mockImplementation(function mockPageOffset(this: HTMLElement) {
          const pageShellIndex = this.dataset.pageIndex;
          return pageShellIndex === undefined ? 0 : Number(pageShellIndex) * 1000;
        });
      const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
      const { container } = renderComponent({
        target: { pageIndex: requestedPageIndex, top: null },
        currentSection: 'Normalized target',
      });
      expect(await screen.findByText(`Page ${expectedPageIndex + 1} of 3`)).toBeInTheDocument();
      await waitFor(() =>
        expect(scrollTo).toHaveBeenCalledWith({
          top: expectedScrollTop,
          behavior: 'smooth',
        }),
      );
      const pages = [...container.querySelectorAll<HTMLElement>('[data-page-index]')];

      act(() => {
        IntersectionObserverDouble.instances[0].showPage(pages[expectedPageIndex]);
      });
      const nextPageIndex = expectedPageIndex === 2 ? 1 : 2;
      act(() => {
        IntersectionObserverDouble.instances[0].emit([
          { target: pages[expectedPageIndex], intersectionRatio: 0 },
          { target: pages[nextPageIndex], intersectionRatio: 1 },
        ]);
      });

      expect(screen.getByText(`Page ${nextPageIndex + 1} of 3`)).toBeInTheDocument();
      expect(onPageChange).toHaveBeenCalledTimes(1);
      expect(onPageChange).toHaveBeenLastCalledWith(nextPageIndex);
      fireEvent.click(screen.getByRole('button', { name: 'View: Continuous' }));
      expect(await screen.findByLabelText(`Page ${nextPageIndex + 1}`)).toBeVisible();
      offsetTop.mockRestore();
    },
  );

  it('keeps outline offsets, shared zoom, and fit width without a second PDF fetch', async () => {
    localStorage.removeItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY);
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);
    const { container } = renderComponent({
      target: { pageIndex: 1, top: 650 },
      currentSection: 'Recovery procedure',
    });

    expect(await screen.findByText('Current section · Recovery procedure')).toBeInTheDocument();
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 129.5, behavior: 'smooth' }));

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByText('120%')).toBeInTheDocument();

    const continuousViewport = screen.getByRole('region', { name: 'Continuous PDF pages' });
    Object.defineProperty(continuousViewport, 'clientWidth', { configurable: true, value: 648 });
    fireEvent.click(screen.getByRole('button', { name: 'Fit width' }));
    await waitFor(() => expect(screen.getByText('100%')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'View: Continuous' }));
    expect(await screen.findByLabelText('Page 2')).toBeVisible();
    expect(container.querySelectorAll('.knowledge-page')).toHaveLength(1);
    expect(getKnowledgePdf).toHaveBeenCalledOnce();
    expect(getDocumentMock).toHaveBeenCalledOnce();
    expect(destroy).not.toHaveBeenCalled();
  });

  it('loads the selected PDF through Relay with script execution disabled and renders selectable text', async () => {
    renderComponent();

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

  it('observes canvas rendering before text or annotation extraction can be interrupted', async () => {
    const renderPromise = new Promise<void>(() => undefined);
    const renderPromiseThen = vi.spyOn(renderPromise, 'then');
    const renderPage = page(1);
    renderPage.render = vi.fn(() => ({ promise: renderPromise, cancel: vi.fn() }));
    renderPage.getTextContent = vi.fn(() => new Promise(() => undefined));
    renderPage.getAnnotations = vi.fn(() => new Promise(() => undefined));
    getPage.mockResolvedValueOnce(renderPage);

    renderComponent();

    await waitFor(() => expect(renderPage.getAnnotations).toHaveBeenCalledOnce());
    expect(renderPromiseThen).toHaveBeenCalled();
    expect(renderPromiseThen.mock.invocationCallOrder[0]).toBeLessThan(
      renderPage.getTextContent.mock.invocationCallOrder[0],
    );
    expect(renderPromiseThen.mock.invocationCallOrder[0]).toBeLessThan(
      renderPage.getAnnotations.mock.invocationCallOrder[0],
    );
  });

  it('requests annotations only for the active loaded page', async () => {
    const { rerender } = renderComponent({ active: false });

    expect(getKnowledgePdf).not.toHaveBeenCalled();
    expect(getAnnotations(1)).not.toHaveBeenCalled();

    rerender(<KnowledgePdfViewer {...viewerProps()} />);

    await waitFor(() => expect(getAnnotations(1)).toHaveBeenCalledWith({ intent: 'display' }));
    expect(getAnnotations(2)).not.toHaveBeenCalled();
  });

  it('prefetches only the adjacent pages around the active single page', async () => {
    renderComponent();

    await waitFor(() => expect(getOperatorList(2)).toHaveBeenCalledWith({ intent: 'display' }));
    expect(getPage).not.toHaveBeenCalledWith(3);
    expect(getOperatorList(3)).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    await waitFor(() => expect(getOperatorList(3)).toHaveBeenCalledWith({ intent: 'display' }));
    expect(getOperatorList(1)).toHaveBeenCalledWith({ intent: 'display' });
  });

  it('refreshes link geometry after zoom and page changes', async () => {
    resolveUrl.mockReturnValue({
      kind: 'web',
      url: 'https://relay.example/help',
      hostname: 'relay.example',
    });
    getAnnotations(1).mockResolvedValue([
      {
        subtype: 'Link',
        id: 'page-one',
        rect: [10, 20, 30, 40],
        url: 'https://relay.example/help',
      },
    ]);
    getAnnotations(2).mockResolvedValue([
      {
        subtype: 'Link',
        id: 'page-two',
        rect: [30, 20, 50, 40],
        url: 'https://relay.example/help',
      },
    ]);
    renderComponent();

    const pageOneLink = await screen.findByRole('button', {
      name: 'Open relay.example in browser',
    });
    expect(pageOneLink).toHaveStyle({ left: '10.5px', width: '21px' });

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open relay.example in browser' })).toHaveStyle({
        left: '12px',
        width: '24px',
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Open relay.example in browser' })).toHaveStyle({
        left: '36px',
        width: '24px',
      }),
    );
    expect(getAnnotations(1)).toHaveBeenCalledTimes(2);
    expect(getAnnotations(2)).toHaveBeenCalledOnce();
  });

  it('navigates a native destination without reloading PDF bytes', async () => {
    getAnnotations(1).mockResolvedValue([
      { subtype: 'Link', id: 'destination', rect: [10, 20, 30, 40], dest: [2, { name: 'Fit' }] },
    ]);

    function DestinationHarness() {
      const [target, setTarget] = useState<KnowledgeViewerTarget | null>(null);
      return <KnowledgePdfViewer {...viewerProps({ target, onDestinationChange: setTarget })} />;
    }

    render(<DestinationHarness />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open linked location in this guide' }),
    );

    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
    expect(getKnowledgePdf).toHaveBeenCalledOnce();
    expect(onActivateResolvedLink).not.toHaveBeenCalled();
  });

  it('applies only the latest native destination when lookups resolve out of order', async () => {
    const firstDestination = deferred<unknown[] | null>();
    const secondDestination = deferred<unknown[] | null>();
    const getRaceDestination = vi.fn((name: string) =>
      name === 'first-destination' ? firstDestination.promise : secondDestination.promise,
    );
    getDocumentMock.mockReturnValueOnce({
      promise: Promise.resolve(pdf({ getDestination: getRaceDestination })),
      destroy: loadingDestroy,
    } as never);
    getAnnotations(1).mockResolvedValue([
      { subtype: 'Link', id: 'first', rect: [10, 20, 30, 40], dest: 'first-destination' },
      { subtype: 'Link', id: 'second', rect: [10, 50, 30, 70], dest: 'second-destination' },
    ]);
    renderComponent();

    const [firstButton, secondButton] = await screen.findAllByRole('button', {
      name: 'Open linked location in this guide',
    });
    fireEvent.click(firstButton);
    fireEvent.click(secondButton);
    await waitFor(() => expect(getRaceDestination).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondDestination.resolve([2, { name: 'Fit' }]);
      await secondDestination.promise;
    });
    await waitFor(() =>
      expect(onDestinationChange).toHaveBeenCalledWith({ pageIndex: 2, top: null }),
    );

    await act(async () => {
      firstDestination.resolve([1, { name: 'Fit' }]);
      await firstDestination.promise;
      await Promise.resolve();
    });

    expect(onDestinationChange).toHaveBeenCalledOnce();
  });

  it('invalidates an in-flight native destination when the operator changes page manually', async () => {
    const destination = deferred<unknown[] | null>();
    const getManualRaceDestination = vi.fn(() => destination.promise);
    getDocumentMock.mockReturnValueOnce({
      promise: Promise.resolve(pdf({ getDestination: getManualRaceDestination })),
      destroy: loadingDestroy,
    } as never);
    getAnnotations(1).mockResolvedValue([
      { subtype: 'Link', id: 'destination', rect: [10, 20, 30, 40], dest: 'late-destination' },
    ]);
    renderComponent();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open linked location in this guide' }),
    );
    await waitFor(() => expect(getManualRaceDestination).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();

    await act(async () => {
      destination.resolve([2, { name: 'Fit' }]);
      await destination.promise;
      await Promise.resolve();
    });

    expect(onDestinationChange).not.toHaveBeenCalled();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('discards a native destination that resolves after selecting another document', async () => {
    const destination = deferred<unknown[] | null>();
    const pageIndex = deferred<number>();
    const sourceGetDestination = vi.fn(() => destination.promise);
    const sourceGetPageIndex = vi.fn(() => pageIndex.promise);
    const sourcePdf = pdf({
      getDestination: sourceGetDestination,
      getPageIndex: sourceGetPageIndex,
    });
    const selectedPdf = pdf();
    getDocumentMock
      .mockReturnValueOnce({
        promise: Promise.resolve(sourcePdf),
        destroy: loadingDestroy,
      } as never)
      .mockReturnValueOnce({
        promise: Promise.resolve(selectedPdf),
        destroy: loadingDestroy,
      } as never);
    getAnnotations(1).mockResolvedValue([
      { subtype: 'Link', id: 'destination', rect: [10, 20, 30, 40], dest: 'late-destination' },
    ]);
    const sourceDocument = record({ title: 'Source guide' });
    const selectedDocument = record({
      id: 'doc-2',
      checksum: 'b'.repeat(64),
      title: 'Selected guide',
      sourceKey: 'General/Selected.pdf',
      fileName: 'Selected.pdf',
      pdf: 'Selected.pdf',
    });

    function DestinationRaceHarness() {
      const [selected, setSelected] = useState(sourceDocument);
      const [target, setTarget] = useState<KnowledgeViewerTarget | null>(null);
      const [section, setSection] = useState('Source section');

      return (
        <>
          <button
            type="button"
            onClick={() => {
              setSelected(selectedDocument);
              setTarget(null);
              setSection('Selected section');
            }}
          >
            Select another document
          </button>
          <KnowledgePdfViewer
            {...viewerProps({
              document: selected,
              target,
              currentSection: section,
              onDestinationChange: (nextTarget: KnowledgeViewerTarget) => {
                setTarget(nextTarget);
                setSection(`${selected.title} destination`);
              },
            })}
          />
        </>
      );
    }

    render(<DestinationRaceHarness />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open linked location in this guide' }),
    );
    await waitFor(() => expect(sourceGetDestination).toHaveBeenCalledWith('late-destination'));

    fireEvent.click(screen.getByRole('button', { name: 'Select another document' }));
    expect(await screen.findByRole('heading', { name: 'Selected guide' })).toBeInTheDocument();
    expect(await screen.findByText('Current section · Selected section')).toBeInTheDocument();
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();

    await act(async () => {
      destination.resolve([{ num: 2, gen: 0 }, { name: 'Fit' }]);
      await sourceGetDestination.mock.results[0]?.value;
    });
    await waitFor(() => expect(sourceGetPageIndex).toHaveBeenCalledOnce());
    await act(async () => {
      pageIndex.resolve(2);
      await pageIndex.promise;
    });

    expect(screen.getByText('Current section · Selected section')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
  });

  it('reports an invalid native destination without changing page', async () => {
    getAnnotations(1).mockResolvedValue([
      { subtype: 'Link', id: 'invalid', rect: [10, 20, 30, 40], dest: [8, { name: 'Fit' }] },
    ]);
    renderComponent();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Open linked location in this guide' }),
    );

    await waitFor(() =>
      expect(onActivateResolvedLink).toHaveBeenCalledWith({
        kind: 'unavailable',
        reason: 'unsupported',
      }),
    );
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(onDestinationChange).not.toHaveBeenCalled();
  });

  it('clears stale overlays across scale, page, and document changes', async () => {
    resolveUrl.mockReturnValue({
      kind: 'web',
      url: 'https://relay.example/help',
      hostname: 'relay.example',
    });
    const annotation = {
      subtype: 'Link',
      id: 'current',
      rect: [10, 20, 30, 40],
      url: 'https://relay.example/help',
    };
    getAnnotations(1).mockResolvedValueOnce([annotation]);
    const scaledAnnotations = deferred<unknown[]>();
    getAnnotations(1).mockReturnValueOnce(scaledAnnotations.promise);
    const nextPageAnnotations = deferred<unknown[]>();
    getAnnotations(2).mockReturnValueOnce(nextPageAnnotations.promise);
    const { rerender } = renderComponent();

    expect(
      await screen.findByRole('button', { name: 'Open relay.example in browser' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(
      screen.queryByRole('button', { name: 'Open relay.example in browser' }),
    ).not.toBeInTheDocument();
    scaledAnnotations.resolve([annotation]);
    expect(
      await screen.findByRole('button', { name: 'Open relay.example in browser' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(
      screen.queryByRole('button', { name: 'Open relay.example in browser' }),
    ).not.toBeInTheDocument();
    nextPageAnnotations.resolve([{ ...annotation, id: 'next-page' }]);
    expect(
      await screen.findByRole('button', { name: 'Open relay.example in browser' }),
    ).toBeInTheDocument();

    const nextDocumentPdf = deferred<{
      ok: true;
      data: ArrayBuffer;
      checksum: string;
      source: 'server';
    }>();
    getKnowledgePdf.mockReturnValueOnce(nextDocumentPdf.promise);
    const nextDocument = record({
      id: 'doc-2',
      checksum: 'b'.repeat(64),
      title: 'Second guide',
      sourceKey: 'General/Second.pdf',
      fileName: 'Second.pdf',
      pdf: 'Second.pdf',
    });
    rerender(<KnowledgePdfViewer {...viewerProps({ document: nextDocument })} />);
    expect(
      screen.queryByRole('button', { name: 'Open relay.example in browser' }),
    ).not.toBeInTheDocument();
    expect(getKnowledgePdf).toHaveBeenCalledTimes(2);
  });

  it('ignores late annotation work from an interrupted page render', async () => {
    resolveUrl.mockImplementation(
      (url): KnowledgeResolvedLink => ({
        kind: 'web',
        url,
        hostname: new URL(url).hostname,
      }),
    );
    const firstPageAnnotations = deferred<unknown[]>();
    getAnnotations(1).mockReturnValueOnce(firstPageAnnotations.promise);
    getAnnotations(2).mockResolvedValueOnce([
      { subtype: 'Link', id: 'new', rect: [20, 20, 40, 40], url: 'https://new.example' },
    ]);
    renderComponent();
    await screen.findByText('Page 1 of 3');

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(
      await screen.findByRole('button', { name: 'Open new.example in browser' }),
    ).toBeInTheDocument();

    firstPageAnnotations.resolve([
      { subtype: 'Link', id: 'old', rect: [10, 10, 30, 30], url: 'https://old.example' },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    expect(screen.queryByRole('button', { name: 'Open old.example in browser' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open new.example in browser' })).toBeInTheDocument();
  });

  it('invalidates active annotation work when the same document checksum changes', async () => {
    resolveUrl.mockImplementation(
      (url): KnowledgeResolvedLink => ({
        kind: 'web',
        url,
        hostname: new URL(url).hostname,
      }),
    );
    const staleAnnotations = deferred<unknown[]>();
    const stalePage = page(1);
    stalePage.getAnnotations = vi.fn(() => staleAnnotations.promise);
    const staleGetPage = vi.fn(async () => stalePage);
    getDocumentMock.mockReturnValueOnce({
      promise: Promise.resolve(pdf({ getPage: staleGetPage })),
      destroy: loadingDestroy,
    } as never);
    getKnowledgePdf
      .mockResolvedValueOnce({
        ok: true,
        data: new Uint8Array([1, 2, 3]).buffer,
        checksum: 'a'.repeat(64),
        source: 'server',
      })
      .mockReturnValueOnce(new Promise(() => undefined));
    const { rerender } = renderComponent();
    await waitFor(() => expect(stalePage.getAnnotations).toHaveBeenCalledOnce());

    rerender(
      <KnowledgePdfViewer {...viewerProps({ document: record({ checksum: 'b'.repeat(64) }) })} />,
    );

    expect(getKnowledgePdf).toHaveBeenLastCalledWith({
      documentId: 'doc-1',
      checksum: 'b'.repeat(64),
    });
    staleAnnotations.resolve([
      { subtype: 'Link', id: 'stale', rect: [10, 10, 30, 30], url: 'https://stale.example' },
    ]);
    await Promise.resolve();
    await Promise.resolve();

    await waitFor(() => expect(stalePage.cleanup).toHaveBeenCalledOnce());
    expect(staleGetPage).toHaveBeenCalledWith(1);
    expect(staleGetPage).toHaveBeenCalledWith(2);
    expect(stalePage.getAnnotations).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Open stale.example in browser' })).toBeNull();
  });

  it('handles interrupted render and annotation rejections without an unhandled rejection', async () => {
    const canvasRender = deferred<void>();
    const annotations = deferred<unknown[]>();
    const interruptedPage = page(1);
    interruptedPage.render = vi.fn(() => ({ promise: canvasRender.promise, cancel: vi.fn() }));
    interruptedPage.getAnnotations = vi.fn(() => annotations.promise);
    getPage.mockResolvedValueOnce(interruptedPage);
    const unhandled = vi.fn((event: PromiseRejectionEvent) => event.preventDefault());
    globalThis.addEventListener('unhandledrejection', unhandled);
    const { rerender } = renderComponent();
    await waitFor(() => expect(interruptedPage.getAnnotations).toHaveBeenCalled());

    rerender(<KnowledgePdfViewer {...viewerProps({ active: false })} />);
    const cancelled = new Error('cancelled');
    cancelled.name = 'RenderingCancelledException';
    canvasRender.reject(cancelled);
    annotations.reject(cancelled);
    await Promise.resolve();
    await Promise.resolve();

    expect(unhandled).not.toHaveBeenCalled();
    expect(screen.queryByText('Relay could not render this page.')).not.toBeInTheDocument();
    globalThis.removeEventListener('unhandledrejection', unhandled);
  });

  it.each(['rejects', 'throws'])(
    'keeps an active readable page visible when optional annotation extraction %s',
    async (failureMode) => {
      const readablePage = page(1);
      readablePage.getAnnotations =
        failureMode === 'throws'
          ? vi.fn(() => {
              throw new Error('malformed optional annotation data');
            })
          : vi.fn(async () => {
              throw new Error('malformed optional annotation data');
            });
      getPage.mockResolvedValueOnce(readablePage);

      renderComponent();

      await waitFor(() =>
        expect(readablePage.getAnnotations).toHaveBeenCalledWith({ intent: 'display' }),
      );
      await waitFor(() => expect(TextLayerMock).toHaveBeenCalled());
      expect(screen.getByLabelText('Page 1')).toBeInTheDocument();
      expect(screen.queryByText('Relay could not render this page.')).not.toBeInTheDocument();
      expect(document.querySelector('.knowledge-page__link-target')).not.toBeInTheDocument();
    },
  );

  it('restores focus after a cross-document request once its target page is rendered', async () => {
    const secondPageText = deferred<{ items: never[]; styles: Record<string, never> }>();
    const secondGetPage = vi.fn(async (pageNumber: number) => {
      const loadedPage = page(pageNumber);
      if (pageNumber === 2) loadedPage.getTextContent = vi.fn(() => secondPageText.promise);
      return loadedPage;
    });
    getDocumentMock
      .mockReturnValueOnce({ promise: Promise.resolve(pdf()), destroy: loadingDestroy } as never)
      .mockReturnValueOnce({
        promise: Promise.resolve(pdf({ getPage: secondGetPage })),
        destroy: loadingDestroy,
      } as never);
    const externalFocus = document.createElement('button');
    document.body.append(externalFocus);
    externalFocus.focus();
    const { container, rerender } = renderComponent({ focusRequestKey: 0 });
    await waitFor(() => expect(TextLayerMock).toHaveBeenCalled());
    expect(externalFocus).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(getAnnotations(1)).toHaveBeenCalledTimes(2));
    expect(externalFocus).toHaveFocus();

    const nextDocument = record({
      id: 'doc-2',
      checksum: 'b'.repeat(64),
      title: 'Second guide',
      sourceKey: 'General/Second.pdf',
      fileName: 'Second.pdf',
      pdf: 'Second.pdf',
    });
    rerender(
      <KnowledgePdfViewer
        {...viewerProps({
          document: nextDocument,
          target: { pageIndex: 1, top: null },
          focusRequestKey: 1,
        })}
      />,
    );
    await waitFor(() => expect(secondGetPage).toHaveBeenCalledWith(2));
    expect(externalFocus).toHaveFocus();

    secondPageText.resolve({ items: [], styles: {} });
    const viewport = container.querySelector('.knowledge-viewer__viewport');
    await waitFor(() => expect(viewport).toHaveFocus());
    expect(viewport).toHaveAttribute('tabindex', '-1');
    externalFocus.remove();
  });

  it('restores focus using the bounded page for an out-of-range target', async () => {
    const externalFocus = document.createElement('button');
    document.body.append(externalFocus);
    externalFocus.focus();
    const { container, rerender } = renderComponent({ focusRequestKey: 0 });
    await waitFor(() => expect(TextLayerMock).toHaveBeenCalled());
    expect(externalFocus).toHaveFocus();

    rerender(
      <KnowledgePdfViewer
        {...viewerProps({ target: { pageIndex: 8.7, top: null }, focusRequestKey: 1 })}
      />,
    );

    await waitFor(() => expect(getAnnotations(3)).toHaveBeenCalled());
    const viewport = container.querySelector('.knowledge-viewer__viewport');
    await waitFor(() => expect(viewport).toHaveFocus());
    expect(screen.getByText('Page 3 of 3')).toBeInTheDocument();
    externalFocus.remove();
  });

  it('does not restore delayed target focus after manual navigation supersedes it', async () => {
    localStorage.removeItem(KNOWLEDGE_PDF_VIEW_MODE_STORAGE_KEY);
    const pageTwoText = deferred<{ items: never[]; styles: Record<string, never> }>();
    const secondGetPage = vi.fn(async (pageNumber: number) => {
      const loadedPage = page(pageNumber);
      if (pageNumber === 2) loadedPage.getTextContent = vi.fn(() => pageTwoText.promise);
      return loadedPage;
    });
    getDocumentMock
      .mockReturnValueOnce({ promise: Promise.resolve(pdf()), destroy: loadingDestroy } as never)
      .mockReturnValueOnce({
        promise: Promise.resolve(pdf({ getPage: secondGetPage })),
        destroy: loadingDestroy,
      } as never);
    const { rerender } = renderComponent({ focusRequestKey: 0 });
    await waitFor(() => expect(TextLayerMock).toHaveBeenCalledTimes(3));

    const nextDocument = record({
      id: 'doc-2',
      checksum: 'b'.repeat(64),
      title: 'Second guide',
      sourceKey: 'General/Second.pdf',
      fileName: 'Second.pdf',
      pdf: 'Second.pdf',
    });
    rerender(
      <KnowledgePdfViewer
        {...viewerProps({
          document: nextDocument,
          target: { pageIndex: 1, top: null },
          focusRequestKey: 1,
        })}
      />,
    );
    await waitFor(() => expect(TextLayerMock).toHaveBeenCalledTimes(5));

    const nextPage = screen.getByRole('button', { name: 'Next page' });
    nextPage.focus();
    fireEvent.click(nextPage);
    expect(nextPage).toHaveFocus();
    await act(async () => {
      pageTwoText.resolve({ items: [], styles: {} });
      await pageTwoText.promise;
    });
    await waitFor(() => expect(TextLayerMock).toHaveBeenCalledTimes(6));

    expect(nextPage).toHaveFocus();
  });

  it('does not transfer a pending cross-document focus request to an unrelated document', async () => {
    const requestedPageText = deferred<{ items: never[]; styles: Record<string, never> }>();
    const requestedGetPage = vi.fn(async (pageNumber: number) => {
      const loadedPage = page(pageNumber);
      if (pageNumber === 2) loadedPage.getTextContent = vi.fn(() => requestedPageText.promise);
      return loadedPage;
    });
    const unrelatedGetPage = vi.fn(async (pageNumber: number) => page(pageNumber));
    getDocumentMock
      .mockReturnValueOnce({ promise: Promise.resolve(pdf()), destroy: loadingDestroy } as never)
      .mockReturnValueOnce({
        promise: Promise.resolve(pdf({ getPage: requestedGetPage })),
        destroy: loadingDestroy,
      } as never)
      .mockReturnValueOnce({
        promise: Promise.resolve(pdf({ getPage: unrelatedGetPage })),
        destroy: loadingDestroy,
      } as never);
    const externalFocus = document.createElement('button');
    document.body.append(externalFocus);
    externalFocus.focus();
    const { rerender } = renderComponent({ focusRequestKey: 0 });
    await waitFor(() => expect(TextLayerMock).toHaveBeenCalled());

    const requestedDocument = record({
      id: 'doc-2',
      checksum: 'b'.repeat(64),
      title: 'Requested guide',
      sourceKey: 'General/Requested.pdf',
      fileName: 'Requested.pdf',
      pdf: 'Requested.pdf',
    });
    rerender(
      <KnowledgePdfViewer
        {...viewerProps({
          document: requestedDocument,
          target: { pageIndex: 1, top: null },
          focusRequestKey: 1,
        })}
      />,
    );
    await waitFor(() => expect(requestedGetPage).toHaveBeenCalledWith(2));
    expect(externalFocus).toHaveFocus();

    const unrelatedDocument = record({
      id: 'doc-3',
      checksum: 'c'.repeat(64),
      title: 'Unrelated guide',
      sourceKey: 'General/Unrelated.pdf',
      fileName: 'Unrelated.pdf',
      pdf: 'Unrelated.pdf',
    });
    rerender(
      <KnowledgePdfViewer
        {...viewerProps({
          document: unrelatedDocument,
          target: null,
          focusRequestKey: 1,
        })}
      />,
    );

    await waitFor(() => expect(unrelatedGetPage).toHaveBeenCalledWith(1));
    await waitFor(() => expect(TextLayerMock).toHaveBeenCalledTimes(2));
    expect(externalFocus).toHaveFocus();
    externalFocus.remove();
  });

  it('focuses and consumes only a matching cross-document request when the target is unavailable offline', async () => {
    getKnowledgePdf.mockResolvedValue({ ok: false, error: 'not-available-offline' });
    const externalFocus = document.createElement('button');
    document.body.append(externalFocus);
    externalFocus.focus();
    const { container, rerender } = renderComponent({ focusRequestKey: 0 });

    expect(await screen.findByText(/not cached on this laptop/i)).toBeInTheDocument();
    expect(externalFocus).toHaveFocus();

    const requestedDocument = record({
      id: 'doc-2',
      checksum: 'b'.repeat(64),
      title: 'Requested guide',
      sourceKey: 'General/Requested.pdf',
      fileName: 'Requested.pdf',
      pdf: 'Requested.pdf',
    });
    rerender(
      <KnowledgePdfViewer
        {...viewerProps({
          document: requestedDocument,
          target: { pageIndex: 1, top: null },
          currentSection: 'Requested section',
          focusRequestKey: 1,
        })}
      />,
    );

    await waitFor(() =>
      expect(getKnowledgePdf).toHaveBeenLastCalledWith({
        documentId: 'doc-2',
        checksum: 'b'.repeat(64),
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Requested guide' })).toBeInTheDocument();
    expect(screen.getByText('Current section · Requested section')).toBeInTheDocument();
    expect(screen.getByText(/not cached on this laptop/i)).toBeInTheDocument();
    const viewport = container.querySelector('.knowledge-viewer__viewport');
    await waitFor(() => expect(viewport).toHaveFocus());
    expect(onPageChange).not.toHaveBeenCalled();
    expect(onDestinationChange).not.toHaveBeenCalled();

    externalFocus.focus();
    const unrelatedDocument = record({
      id: 'doc-3',
      checksum: 'c'.repeat(64),
      title: 'Unrelated guide',
      sourceKey: 'General/Unrelated.pdf',
      fileName: 'Unrelated.pdf',
      pdf: 'Unrelated.pdf',
    });
    rerender(
      <KnowledgePdfViewer
        {...viewerProps({
          document: unrelatedDocument,
          target: { pageIndex: 1, top: null },
          focusRequestKey: 1,
        })}
      />,
    );

    await waitFor(() =>
      expect(getKnowledgePdf).toHaveBeenLastCalledWith({
        documentId: 'doc-3',
        checksum: 'c'.repeat(64),
      }),
    );
    expect(await screen.findByRole('heading', { name: 'Unrelated guide' })).toBeInTheDocument();
    expect(screen.getByText(/not cached on this laptop/i)).toBeInTheDocument();
    expect(externalFocus).toHaveFocus();
    externalFocus.remove();
  });

  it('navigates pages and follows a viewer target', async () => {
    const { rerender } = renderComponent();
    await screen.findByText('Page 1 of 3');

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(onPageChange).toHaveBeenCalledWith(1);

    const target: KnowledgeViewerTarget = { pageIndex: 2, top: 650 };
    rerender(<KnowledgePdfViewer {...viewerProps({ target })} />);
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
  });

  it('shows the active section without replacing it when the target page opens', async () => {
    renderComponent({
      target: { pageIndex: 1, top: 650 },
      currentSection: 'Recovery procedure',
    });

    expect(await screen.findByText('Current section · Recovery procedure')).toBeInTheDocument();
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(onPageChange).not.toHaveBeenCalled();
  });

  it('shows a useful offline state without exposing download or print controls', async () => {
    getKnowledgePdf.mockResolvedValue({ ok: false, error: 'not-available-offline' });
    renderComponent();

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
    renderComponent();

    fireEvent.click(await screen.findByRole('button', { name: 'Retry document' }));

    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(getKnowledgePdf).toHaveBeenCalledTimes(2);
  });

  it('destroys an opened document through a single ownership path on unmount', async () => {
    const { unmount } = renderComponent();
    await screen.findByText('Page 1 of 3');

    unmount();
    expect(destroy).toHaveBeenCalledOnce();
    expect(loadingDestroy).not.toHaveBeenCalled();
  });
});
