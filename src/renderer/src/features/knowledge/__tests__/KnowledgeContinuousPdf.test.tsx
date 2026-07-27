import { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs';
import type { KnowledgeResolvedLink } from '../knowledgeLinkResolver';
import type { KnowledgeDocumentSearchMatch } from '../knowledgeDocumentSearch';
import {
  KnowledgeContinuousPdf,
  type KnowledgeContinuousPdfHandle,
} from '../KnowledgeContinuousPdf';

vi.mock('../KnowledgePdfPage', async () => {
  const React = await import('react');
  return {
    KnowledgePdfPage: vi.fn(function MockKnowledgePdfPage({
      pdf,
      pageIndex,
      render: shouldRender,
      searchMatches = [],
      activeSearchResultId,
    }: {
      pdf: PDFDocumentProxy;
      pageIndex: number;
      render: boolean;
      searchMatches?: readonly KnowledgeDocumentSearchMatch[];
      activeSearchResultId?: string | null;
    }) {
      const [retryCount, setRetryCount] = React.useState(0);
      const errorPageIndex = (pdf as unknown as { errorPageIndex?: number }).errorPageIndex;
      const failed = errorPageIndex === pageIndex && retryCount === 0;
      return (
        <div
          data-testid="rendered-pdf-page"
          data-page-index={pageIndex}
          data-search-match-count={searchMatches.length}
          data-active-search-result={activeSearchResultId ?? ''}
        >
          {failed ? (
            <div role="status">
              <span>Page {pageIndex + 1} failed</span>
              <button type="button" onClick={() => setRetryCount((current) => current + 1)}>
                Retry page {pageIndex + 1}
              </button>
            </div>
          ) : (
            <span>{shouldRender ? `Rendered page ${pageIndex + 1}` : 'Deferred'}</span>
          )}
        </div>
      );
    }),
  };
});

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

function firstObserver(): IntersectionObserverDouble {
  const [observer] = IntersectionObserverDouble.instances;
  if (!observer) {
    throw new Error('expected KnowledgeContinuousPdf to construct an IntersectionObserver');
  }
  return observer;
}

function pageShells(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('.knowledge-page-shell')];
}

function shellAt(shells: readonly HTMLElement[], index: number): HTMLElement {
  const shell = shells[index];
  if (!shell) {
    throw new Error(`expected a rendered page shell at index ${index}`);
  }
  return shell;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createPdf(
  pageCount: number,
  overrides: Record<string, unknown> = {},
  convertToViewportPoint: (pageNumber: number, x: number, y: number, scale: number) => number[] = (
    pageNumber,
    _x,
    y,
    scale,
  ) => [0, (800 + pageNumber - y) * scale],
) {
  const getPage = vi.fn(async (pageNumber: number) => ({
    getViewport: vi.fn(({ scale = 1 }: { scale?: number } = {}) => ({
      width: 600 + pageNumber,
      height: 800 + pageNumber,
      convertToViewportPoint: (x: number, y: number) =>
        convertToViewportPoint(pageNumber, x, y, scale),
    })),
  }));
  return {
    pdf: { numPages: pageCount, getPage, ...overrides } as unknown as PDFDocumentProxy,
    getPage,
  };
}

describe('KnowledgeContinuousPdf', () => {
  const resolveUrl = vi.fn((): KnowledgeResolvedLink => ({
    kind: 'unavailable',
    reason: 'unsupported',
  }));
  const onActivateResolvedLink = vi.fn();
  const onActivateDestination = vi.fn();
  const onCurrentPageChange = vi.fn();

  function props(pdf: PDFDocumentProxy, overrides = {}) {
    return {
      pdf,
      scale: 1,
      activePageIndex: 0,
      target: null,
      focusRequestKey: 0,
      resolveUrl,
      onActivateResolvedLink,
      onActivateDestination,
      onCurrentPageChange,
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
  });

  afterEach(() => {
    delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo;
    vi.unstubAllGlobals();
  });

  it('threads only each page search matches and the active result into rendered pages', () => {
    const { pdf } = createPdf(4);
    render(
      <KnowledgeContinuousPdf
        {...props(pdf, {
          searchMatchesByPage: new Map([[0, [searchMatch]]]),
          activeSearchResultId: searchMatch.id,
        })}
      />,
    );

    expect(
      screen.getByText('Rendered page 1').closest('[data-testid="rendered-pdf-page"]'),
    ).toHaveAttribute('data-search-match-count', '1');
    expect(
      screen.getByText('Rendered page 1').closest('[data-testid="rendered-pdf-page"]'),
    ).toHaveAttribute('data-active-search-result', searchMatch.id);
    expect(
      screen.getByText('Rendered page 2').closest('[data-testid="rendered-pdf-page"]'),
    ).toHaveAttribute('data-search-match-count', '0');
  });

  it('creates one stable shell per page and mounts only the bounded overscan window', async () => {
    const { pdf } = createPdf(8);
    const { container } = render(<KnowledgeContinuousPdf {...props(pdf)} />);
    const shells = pageShells(container);

    expect(shells).toHaveLength(8);
    expect(screen.getByRole('region', { name: 'Continuous PDF pages' }).tagName).toBe('SECTION');
    expect(screen.getAllByTestId('rendered-pdf-page')).toHaveLength(3);
    expect(container.querySelector('.knowledge-page-placeholder')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    expect(shellAt(shells, 0)).toHaveStyle({ width: '612px', minHeight: '792px' });

    await waitFor(() =>
      expect(shellAt(shells, 0)).toHaveStyle({ width: '601px', minHeight: '801px' }),
    );

    act(() => {
      firstObserver().emit([
        { target: shellAt(shells, 0), intersectionRatio: 0 },
        { target: shellAt(shells, 3), intersectionRatio: 1 },
      ]);
    });

    expect(screen.getAllByTestId('rendered-pdf-page')).toHaveLength(5);
    expect(
      screen.getAllByTestId('rendered-pdf-page').map((page) => page.dataset.pageIndex),
    ).toEqual(['1', '2', '3', '4', '5']);
  });

  it('reports the visible page and clamps rendering at the first and last pages', () => {
    const { pdf } = createPdf(6);
    const { container } = render(<KnowledgeContinuousPdf {...props(pdf)} />);
    const shells = pageShells(container);

    expect(onCurrentPageChange).toHaveBeenLastCalledWith(0);
    expect(
      screen.getAllByTestId('rendered-pdf-page').map((page) => page.dataset.pageIndex),
    ).toEqual(['0', '1', '2']);

    act(() => {
      firstObserver().emit([
        { target: shellAt(shells, 0), intersectionRatio: 0 },
        { target: shellAt(shells, 5), intersectionRatio: 1 },
      ]);
    });

    expect(onCurrentPageChange).toHaveBeenLastCalledWith(5);
    expect(
      screen.getAllByTestId('rendered-pdf-page').map((page) => page.dataset.pageIndex),
    ).toEqual(['3', '4', '5']);
  });

  it('supports imperative and repeated target navigation inside its own viewport', async () => {
    const { pdf } = createPdf(6);
    const readerRef = createRef<KnowledgeContinuousPdfHandle>();
    const { container, rerender } = render(
      <KnowledgeContinuousPdf ref={readerRef} {...props(pdf)} />,
    );
    const viewport = container.querySelector<HTMLElement>('.knowledge-continuous-pdf');
    const targetShell = container.querySelector<HTMLElement>('[data-page-index="4"]');
    expect(viewport).not.toBeNull();
    expect(targetShell).not.toBeNull();
    await waitFor(() => expect(targetShell).toHaveStyle({ width: '605px', minHeight: '805px' }));
    const scrollTo = vi.fn();
    viewport!.scrollTo = scrollTo;
    Object.defineProperty(targetShell, 'offsetTop', { configurable: true, value: 1000 });

    act(() => readerRef.current?.scrollToPage(4, 50));
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 1022, behavior: 'smooth' });
    scrollTo.mockClear();

    rerender(
      <KnowledgeContinuousPdf
        ref={readerRef}
        {...props(pdf, {
          target: { pageIndex: 4, top: 700 },
          focusRequestKey: 1,
        })}
      />,
    );
    await waitFor(() =>
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 1077, behavior: 'smooth' }),
    );
    expect(viewport).toHaveFocus();
    scrollTo.mockClear();

    rerender(
      <KnowledgeContinuousPdf
        ref={readerRef}
        {...props(pdf, {
          target: { pageIndex: 4, top: 700 },
          focusRequestKey: 2,
        })}
      />,
    );
    await waitFor(() => expect(scrollTo).toHaveBeenCalledOnce());
  });

  it('routes programmatic page navigation through instant scrolling for reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
      })) as unknown as typeof globalThis.matchMedia,
    );
    const { pdf } = createPdf(6);
    const readerRef = createRef<KnowledgeContinuousPdfHandle>();
    const { container } = render(<KnowledgeContinuousPdf ref={readerRef} {...props(pdf)} />);
    const targetShell = container.querySelector<HTMLElement>('[data-page-index="2"]')!;
    Object.defineProperty(targetShell, 'offsetTop', { configurable: true, value: 700 });
    const scrollTo = vi.mocked(HTMLElement.prototype.scrollTo);

    act(() => readerRef.current?.scrollToPage(2));

    expect(scrollTo).toHaveBeenCalledWith({ top: 672, behavior: 'auto' });
  });

  it('does not turn observer feedback, zoom, or late metrics into programmatic scrolling', async () => {
    const { pdf } = createPdf(6);
    const { container, rerender } = render(<KnowledgeContinuousPdf {...props(pdf)} />);
    const viewport = container.querySelector<HTMLElement>('.knowledge-continuous-pdf')!;
    const shells = pageShells(container);
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;
    Object.defineProperty(shellAt(shells, 3), 'offsetTop', { configurable: true, value: 900 });
    Object.defineProperty(shellAt(shells, 4), 'offsetTop', { configurable: true, value: 1200 });

    act(() => {
      firstObserver().emit([
        { target: shellAt(shells, 0), intersectionRatio: 0 },
        { target: shellAt(shells, 3), intersectionRatio: 0.37 },
      ]);
    });
    rerender(<KnowledgeContinuousPdf {...props(pdf, { activePageIndex: 3 })} />);
    await waitFor(() =>
      expect(shellAt(shells, 3)).toHaveStyle({ width: '604px', minHeight: '804px' }),
    );
    rerender(<KnowledgeContinuousPdf {...props(pdf, { activePageIndex: 3, scale: 1.5 })} />);

    expect(scrollTo).not.toHaveBeenCalled();

    rerender(<KnowledgeContinuousPdf {...props(pdf, { activePageIndex: 4, scale: 1.5 })} />);
    await waitFor(() =>
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 1172, behavior: 'smooth' }),
    );
  });

  it('uses the PDF viewport transform once and consumes target removal without scrolling', async () => {
    const convertToViewportPoint = vi.fn(
      (_pageNumber: number, _x: number, _y: number, scale: number) => [412 * scale, 137 * scale],
    );
    const { pdf } = createPdf(6, {}, convertToViewportPoint);
    const { container, rerender } = render(<KnowledgeContinuousPdf {...props(pdf)} />);
    const viewport = container.querySelector<HTMLElement>('.knowledge-continuous-pdf')!;
    const targetShell = container.querySelector<HTMLElement>('[data-page-index="4"]')!;
    const scrollTo = vi.fn();
    viewport.scrollTo = scrollTo;
    Object.defineProperty(targetShell, 'offsetTop', { configurable: true, value: 1000 });

    rerender(
      <KnowledgeContinuousPdf
        {...props(pdf, {
          scale: 1.5,
          activePageIndex: 4,
          target: { pageIndex: 4, top: 700 },
          focusRequestKey: 1,
        })}
      />,
    );

    await waitFor(() => expect(convertToViewportPoint).toHaveBeenCalledWith(5, 0, 700, 1.5));
    // Wait on the scroll itself rather than treating the coordinate conversion as
    // a proxy for it: the two are no longer in the same tick, so asserting
    // synchronously here raced and only lost on CI's timing.
    await waitFor(() =>
      expect(scrollTo).toHaveBeenLastCalledWith({ top: 1177.5, behavior: 'smooth' }),
    );
    expect(scrollTo).toHaveBeenCalledOnce();

    rerender(
      <KnowledgeContinuousPdf
        {...props(pdf, {
          scale: 1.5,
          activePageIndex: 4,
          target: null,
          focusRequestKey: 1,
        })}
      />,
    );

    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it('recomputes shell dimensions at scale without reloading metadata or churning observers', async () => {
    const { pdf, getPage } = createPdf(4);
    const { container, rerender } = render(<KnowledgeContinuousPdf {...props(pdf)} />);
    const shell = container.querySelector<HTMLElement>('[data-page-index="0"]')!;
    await waitFor(() => expect(shell).toHaveStyle({ width: '601px', minHeight: '801px' }));
    const observer = firstObserver();
    expect(getPage).toHaveBeenCalledTimes(4);

    rerender(<KnowledgeContinuousPdf {...props(pdf, { scale: 1.5 })} />);

    expect(shell).toHaveStyle({ width: '901.5px', minHeight: '1201.5px' });
    expect(getPage).toHaveBeenCalledTimes(4);
    expect(observer.unobserve).not.toHaveBeenCalled();
    expect(observer.observe).toHaveBeenCalledTimes(4);
  });

  it('keeps page errors and retries isolated to the failing page shell', async () => {
    const { pdf } = createPdf(4, { errorPageIndex: 1 });
    render(<KnowledgeContinuousPdf {...props(pdf)} />);

    expect(screen.getByText('Rendered page 1')).toBeInTheDocument();
    expect(screen.getByText('Page 2 failed')).toBeInTheDocument();
    expect(screen.getByText('Rendered page 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry page 2' }));

    expect(screen.getByText('Rendered page 2')).toBeInTheDocument();
    expect(screen.getByText('Rendered page 1')).toBeInTheDocument();
    expect(screen.getByText('Rendered page 3')).toBeInTheDocument();
  });

  it('limits metadata loading concurrency and mounts at most five pages in a 200-page PDF', async () => {
    let activeReads = 0;
    let greatestActiveReads = 0;
    const pendingReads: Array<ReturnType<typeof deferred<unknown>>> = [];
    const getPage = vi.fn(() => {
      activeReads += 1;
      greatestActiveReads = Math.max(greatestActiveReads, activeReads);
      const pending = deferred<unknown>();
      pendingReads.push(pending);
      return pending.promise.finally(() => {
        activeReads -= 1;
      });
    });
    const pdf = { numPages: 200, getPage } as unknown as PDFDocumentProxy;
    const { container, unmount } = render(<KnowledgeContinuousPdf {...props(pdf)} />);

    await waitFor(() => expect(getPage).toHaveBeenCalledTimes(4));
    expect(greatestActiveReads).toBe(4);
    expect(container.querySelectorAll('.knowledge-page-shell')).toHaveLength(200);
    expect(screen.getAllByTestId('rendered-pdf-page').length).toBeLessThanOrEqual(5);

    const shells = pageShells(container);
    act(() => {
      firstObserver().emit([
        { target: shellAt(shells, 0), intersectionRatio: 0 },
        { target: shellAt(shells, 100), intersectionRatio: 1 },
      ]);
    });
    expect(
      screen.getAllByTestId('rendered-pdf-page').map((page) => page.dataset.pageIndex),
    ).toEqual(['98', '99', '100', '101', '102']);

    act(() => {
      firstObserver().emit([
        { target: shellAt(shells, 100), intersectionRatio: 0 },
        { target: shellAt(shells, 199), intersectionRatio: 1 },
      ]);
    });
    expect(
      screen.getAllByTestId('rendered-pdf-page').map((page) => page.dataset.pageIndex),
    ).toEqual(['197', '198', '199']);

    unmount();
    for (const pending of pendingReads) {
      pending.resolve({ getViewport: () => ({ width: 600, height: 800 }) });
    }
  });
});
