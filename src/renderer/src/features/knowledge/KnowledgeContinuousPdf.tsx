import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist/build/pdf.mjs';
import { KnowledgePdfPage, type KnowledgePdfPageProps } from './KnowledgePdfPage';
import type { KnowledgeViewerTarget } from './knowledgePdfDestination';
import { useContinuousPdfPages } from './useContinuousPdfPages';

export type KnowledgeContinuousPdfHandle = {
  scrollToPage(pageIndex: number, top?: number | null): void;
};

type KnowledgeContinuousPdfProps = {
  pdf: PDFDocumentProxy;
  scale: number;
  activePageIndex: number;
  target: KnowledgeViewerTarget | null;
  focusRequestKey: number;
  resolveUrl: KnowledgePdfPageProps['resolveUrl'];
  onActivateResolvedLink: KnowledgePdfPageProps['onActivateResolvedLink'];
  onActivateDestination: KnowledgePdfPageProps['onActivateDestination'];
  onPageStatus?: KnowledgePdfPageProps['onStatus'];
  onTargetNavigationComplete?: (target: KnowledgeViewerTarget) => void;
  onCurrentPageChange: (pageIndex: number) => void;
};

type PageMetric = {
  width: number;
  height: number;
};

type LoadedPageMetrics = {
  pdf: PDFDocumentProxy;
  values: readonly PageMetric[];
};

type NavigationRequest = {
  pdf: PDFDocumentProxy;
  activePageIndex: number;
  targetPageIndex: number | undefined;
  targetTop: number | null | undefined;
  focusRequestKey: number;
};

const DEFAULT_PAGE_METRIC: PageMetric = { width: 612, height: 792 };
const METADATA_CONCURRENCY = 4;

function validMetric(width: number, height: number): PageMetric | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function ignorePageStatus(): void {
  // The continuous surface derives shell metrics separately from page rendering.
}

export const KnowledgeContinuousPdf = forwardRef<
  KnowledgeContinuousPdfHandle,
  Readonly<KnowledgeContinuousPdfProps>
>(function KnowledgeContinuousPdf(
  {
    pdf,
    scale,
    activePageIndex,
    target,
    focusRequestKey,
    resolveUrl,
    onActivateResolvedLink,
    onActivateDestination,
    onPageStatus = ignorePageStatus,
    onTargetNavigationComplete,
    onCurrentPageChange,
  },
  ref,
) {
  const pageCount = Math.max(0, Math.floor(pdf.numPages));
  const viewportRef = useRef<HTMLDivElement>(null);
  const previousFocusRequestKeyRef = useRef(focusRequestKey);
  const scaleRef = useRef(scale);
  const observedCurrentPageIndexRef = useRef(activePageIndex);
  const previousNavigationRequestRef = useRef<NavigationRequest | null>(null);
  const defaultMetrics = useMemo(
    () => Array.from({ length: pageCount }, () => DEFAULT_PAGE_METRIC),
    [pageCount],
  );
  const pageIndices = useMemo(
    () => Array.from({ length: pageCount }, (_, pageIndex) => pageIndex),
    [pageCount],
  );
  const [loadedMetrics, setLoadedMetrics] = useState<LoadedPageMetrics>(() => ({
    pdf,
    values: defaultMetrics,
  }));
  const metrics =
    loadedMetrics.pdf === pdf && loadedMetrics.values.length === pageCount
      ? loadedMetrics.values
      : defaultMetrics;
  const reducedMotion =
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { currentPageIndex, renderPageIndices, registerPage, scrollToPage } = useContinuousPdfPages(
    {
      active: true,
      pageCount,
      rootRef: viewportRef,
      initialPageIndex: activePageIndex,
      reducedMotion,
    },
  );
  scaleRef.current = scale;
  observedCurrentPageIndexRef.current = currentPageIndex;

  useImperativeHandle(ref, () => ({ scrollToPage }), [scrollToPage]);

  useEffect(() => {
    let disposed = false;
    let nextPageIndex = 0;
    const nextMetrics = [...defaultMetrics];
    setLoadedMetrics((current) => {
      if (current.pdf === pdf && current.values.length === pageCount) return current;
      return { pdf, values: defaultMetrics };
    });

    const loadMetrics = async () => {
      while (!disposed) {
        const pageIndex = nextPageIndex;
        nextPageIndex += 1;
        if (pageIndex >= pageCount) break;
        try {
          const page = await pdf.getPage(pageIndex + 1);
          if (disposed) return;
          const viewport = page.getViewport({ scale: 1 });
          const metric = validMetric(viewport.width, viewport.height);
          if (metric) nextMetrics[pageIndex] = metric;
        } catch {
          // Keep the stable default shell; KnowledgePdfPage owns the local render error.
        }
      }
      if (!disposed) setLoadedMetrics({ pdf, values: [...nextMetrics] });
    };

    const workerCount = Math.min(METADATA_CONCURRENCY, pageCount);
    for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
      loadMetrics().catch(() => undefined);
    }

    return () => {
      disposed = true;
    };
  }, [defaultMetrics, pageCount, pdf]);

  useEffect(() => {
    onCurrentPageChange(currentPageIndex);
  }, [currentPageIndex, onCurrentPageChange]);

  const targetPageIndex = target?.pageIndex;
  const targetTop = target?.top;
  const requestedPageIndex = targetPageIndex ?? activePageIndex;
  const boundedRequestedPageIndex = Math.min(
    Math.max(0, Math.floor(requestedPageIndex)),
    Math.max(0, pageCount - 1),
  );

  useEffect(() => {
    const previousRequest = previousNavigationRequestRef.current;
    const nextRequest: NavigationRequest = {
      pdf,
      activePageIndex: boundedRequestedPageIndex,
      targetPageIndex,
      targetTop,
      focusRequestKey,
    };
    previousNavigationRequestRef.current = nextRequest;

    const documentChanged = previousRequest !== null && previousRequest.pdf !== pdf;
    const activePageChanged =
      previousRequest !== null && previousRequest.activePageIndex !== boundedRequestedPageIndex;
    const targetChanged =
      previousRequest?.targetPageIndex !== targetPageIndex ||
      previousRequest?.targetTop !== targetTop;
    const targetRemoved =
      previousRequest?.targetPageIndex !== undefined && targetPageIndex === undefined;
    const targetRequestChanged = targetPageIndex !== undefined && targetChanged;
    const focusRequestChanged =
      previousRequest !== null && previousRequest.focusRequestKey !== focusRequestKey;
    const observerFeedback =
      previousRequest !== null &&
      activePageChanged &&
      !targetChanged &&
      !focusRequestChanged &&
      boundedRequestedPageIndex === observedCurrentPageIndexRef.current;
    const isExternalRequest =
      documentChanged ||
      targetRequestChanged ||
      focusRequestChanged ||
      (activePageChanged && !observerFeedback && !targetRemoved);

    if (pageCount === 0 || !isExternalRequest) return;

    let disposed = false;
    if (previousFocusRequestKeyRef.current !== focusRequestKey) {
      previousFocusRequestKeyRef.current = focusRequestKey;
      viewportRef.current?.focus();
    }
    const navigate = async () => {
      let targetOffset = 0;
      if (targetTop !== null && targetTop !== undefined) {
        const page = await pdf.getPage(boundedRequestedPageIndex + 1);
        if (disposed) return;
        const viewport = page.getViewport({ scale: scaleRef.current });
        const [, viewportY] = viewport.convertToViewportPoint(0, targetTop);
        targetOffset = Math.max(0, viewportY);
      }
      if (disposed) return;
      scrollToPage(boundedRequestedPageIndex, targetOffset);
      if (targetPageIndex !== undefined) {
        onTargetNavigationComplete?.({
          pageIndex: boundedRequestedPageIndex,
          top: targetTop ?? null,
        });
      }
    };
    navigate().catch(() => undefined);

    return () => {
      disposed = true;
    };
  }, [
    boundedRequestedPageIndex,
    focusRequestKey,
    pageCount,
    pdf,
    onTargetNavigationComplete,
    scrollToPage,
    targetPageIndex,
    targetTop,
  ]);

  return (
    <div
      ref={viewportRef}
      className="knowledge-continuous-pdf knowledge-viewer__viewport"
      role="region"
      tabIndex={-1}
      aria-label="Continuous PDF pages"
    >
      {pageIndices.map((pageIndex) => {
        const metric = metrics[pageIndex] ?? DEFAULT_PAGE_METRIC;
        const shouldRender = renderPageIndices.has(pageIndex);
        return (
          <div
            key={pageIndex}
            ref={registerPage(pageIndex)}
            className="knowledge-page-shell"
            data-page-index={pageIndex}
            style={{ width: metric.width * scale, minHeight: metric.height * scale }}
          >
            {shouldRender ? (
              <KnowledgePdfPage
                pdf={pdf}
                pageIndex={pageIndex}
                scale={scale}
                render
                targetTop={null}
                scrollOnReady={false}
                retryKey={0}
                resolveUrl={resolveUrl}
                onActivateResolvedLink={onActivateResolvedLink}
                onActivateDestination={onActivateDestination}
                onStatus={onPageStatus}
              />
            ) : (
              <div className="knowledge-page-placeholder" aria-hidden="true">
                <span>{pageIndex + 1}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});
