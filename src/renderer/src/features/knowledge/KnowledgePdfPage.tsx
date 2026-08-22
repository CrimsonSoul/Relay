import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RenderingCancelledException,
  TextLayer,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist/build/pdf.mjs';
import {
  extractKnowledgeLinkItems,
  KnowledgeLinkLayer,
  type KnowledgeLinkItem,
  type KnowledgePdfDestination,
} from './KnowledgeLinkLayer';
import type { KnowledgeResolvedLink } from './knowledgeLinkResolver';
import type { KnowledgeDocumentSearchMatch } from './knowledgeDocumentSearch';
import { KnowledgeSearchHighlightLayer } from './KnowledgeSearchHighlightLayer';

export type KnowledgePdfPageStatus =
  | { state: 'ready'; pageIndex: number; width: number; height: number }
  | { state: 'error'; pageIndex: number; message: string };

export type KnowledgePdfPageProps = {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  render: boolean;
  targetTop: number | null;
  scrollOnReady?: boolean;
  retryKey: number;
  resolveUrl: (url: string) => KnowledgeResolvedLink;
  onActivateResolvedLink: (link: KnowledgeResolvedLink) => void;
  onActivateDestination: (destination: KnowledgePdfDestination) => void;
  onStatus: (status: KnowledgePdfPageStatus) => void;
  searchMatches?: readonly KnowledgeDocumentSearchMatch[];
  activeSearchResultId?: string | null;
  onActiveSearchHighlightReady?: (resultId: string, pageIndex: number, top: number) => void;
};

type KnowledgeLinkRender = {
  viewport: ReturnType<PDFPageProxy['getViewport']>;
  items: KnowledgeLinkItem[];
};

function isCancelledRender(error: unknown): boolean {
  return (
    error instanceof RenderingCancelledException ||
    (error instanceof Error && error.name === 'RenderingCancelledException')
  );
}

function scrollViewer(element: HTMLDivElement | null | undefined, options: ScrollToOptions): void {
  if (typeof element?.scrollTo === 'function') element.scrollTo(options);
}

function destinationScrollBehavior(): ScrollBehavior {
  return typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

export function KnowledgePdfPage({
  pdf,
  pageIndex,
  scale,
  render,
  targetTop,
  scrollOnReady = true,
  retryKey,
  resolveUrl,
  onActivateResolvedLink,
  onActivateDestination,
  onStatus,
  searchMatches = [],
  activeSearchResultId = null,
  onActiveSearchHighlightReady,
}: Readonly<KnowledgePdfPageProps>) {
  const [linkRender, setLinkRender] = useState<KnowledgeLinkRender | null>(null);
  const [textLayerVersion, setTextLayerVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [localRetryKey, setLocalRetryKey] = useState(0);
  const pageShellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const renderedViewportRef = useRef<KnowledgeLinkRender['viewport'] | null>(null);
  const appliedTargetTopRef = useRef<number | null>(null);
  const targetTopRef = useRef(targetTop);
  targetTopRef.current = targetTop;

  // Consuming a destination flips targetTop back to null. Applying the offset imperatively keeps
  // that transition out of the render effect, so the page is not torn down and scrolled to the top
  // moments after it jumped to the linked section.
  const applyTargetTop = useCallback((): boolean => {
    const viewport = renderedViewportRef.current;
    const top = targetTopRef.current;
    if (!viewport || top === null || appliedTargetTopRef.current === top) return false;
    appliedTargetTopRef.current = top;
    const [, y] = viewport.convertToViewportPoint(0, top);
    scrollViewer(pageShellRef.current?.closest<HTMLDivElement>('.knowledge-viewer__viewport'), {
      top: Math.max(0, y - 28),
      behavior: destinationScrollBehavior(),
    });
    return true;
  }, []);

  const handleActiveSearchHighlightReady = useCallback(
    (resultId: string, top: number) => {
      onActiveSearchHighlightReady?.(resultId, pageIndex, top);
    },
    [onActiveSearchHighlightReady, pageIndex],
  );

  useEffect(() => {
    setLinkRender(null);
    setTextLayerVersion(0);
    setError(null);
    renderedViewportRef.current = null;
    appliedTargetTopRef.current = null;
    if (!render) return;

    let disposed = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    let renderedPage: PDFPageProxy | null = null;
    const work: Promise<unknown>[] = [];
    let cleanupQueued = false;
    let pageFailure: unknown = null;

    const cleanupPage = () => {
      if (!renderedPage || cleanupQueued) return;
      cleanupQueued = true;
      void Promise.allSettled(work).then(() => renderedPage?.cleanup());
    };

    const cancelPageWork = () => {
      renderTask?.cancel();
      textLayer?.cancel();
    };

    const recordPageFailure = (workError: unknown) => {
      if (pageFailure !== null) return;
      pageFailure = workError;
      cancelPageWork();
      cleanupPage();
    };

    pdf
      .getPage(pageIndex + 1)
      .then(async (page) => {
        renderedPage = page;
        if (disposed) {
          cleanupPage();
          return;
        }

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const textContainer = textLayerRef.current;
        if (!canvas || !textContainer) return;

        const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio));
        canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        textContainer.replaceChildren();
        textContainer.style.width = `${viewport.width}px`;
        textContainer.style.height = `${viewport.height}px`;

        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas rendering is unavailable');

        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          annotationMode: 0,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        const canvasRender = renderTask.promise;
        work.push(canvasRender);
        const canvasRenderResult = canvasRender.then(
          () => ({ error: null }),
          (renderError: unknown) => {
            if (!disposed && !isCancelledRender(renderError)) recordPageFailure(renderError);
            return { error: renderError };
          },
        );

        // Annotations are optional decoration: a page whose annotation dictionary is malformed
        // must still render. The async wrapper absorbs a synchronous throw as well as a rejection,
        // and still calls getAnnotations synchronously so the request is in flight immediately.
        const annotationsPromise: ReturnType<PDFPageProxy['getAnnotations']> = (async () => {
          try {
            return await page.getAnnotations({ intent: 'display' });
          } catch {
            return [];
          }
        })();
        work.push(annotationsPromise);
        const textContentPromise = page.getTextContent();
        work.push(textContentPromise);
        const [textContent, annotations] = await Promise.all([
          textContentPromise,
          annotationsPromise,
        ]);
        if (disposed) return;
        if (pageFailure !== null) throw pageFailure;

        textLayer = new TextLayer({
          textContentSource: textContent,
          container: textContainer,
          viewport,
        });
        const textRender = textLayer.render();
        work.push(textRender);
        const textRenderResult = textRender.then(
          () => ({ error: null }),
          (renderError: unknown) => {
            if (!disposed && !isCancelledRender(renderError)) recordPageFailure(renderError);
            return { error: renderError };
          },
        );
        const [canvasResult, textResult] = await Promise.all([
          canvasRenderResult,
          textRenderResult,
        ]);
        if (canvasResult.error !== null) throw canvasResult.error;
        if (textResult.error !== null) throw textResult.error;
        if (disposed) return;
        textLayer.textDivs?.forEach((textDiv, itemIndex) => {
          textDiv.dataset.knowledgeTextItemIndex = String(itemIndex);
        });
        setTextLayerVersion((version) => version + 1);

        if (scrollOnReady) {
          renderedViewportRef.current = viewport;
          if (!applyTargetTop()) {
            scrollViewer(
              pageShellRef.current?.closest<HTMLDivElement>('.knowledge-viewer__viewport'),
              {
                top: 0,
              },
            );
          }
        }

        setLinkRender({ viewport, items: extractKnowledgeLinkItems(annotations) });
        onStatus({ state: 'ready', pageIndex, width: viewport.width, height: viewport.height });
      })
      .catch((renderError: unknown) => {
        const reportedError = pageFailure ?? renderError;
        if (disposed || isCancelledRender(reportedError)) return;
        recordPageFailure(reportedError);
        const message = 'Relay could not render this page.';
        setError(message);
        onStatus({ state: 'error', pageIndex, message });
      });

    return () => {
      disposed = true;
      cancelPageWork();
      cleanupPage();
    };
  }, [
    applyTargetTop,
    onStatus,
    pageIndex,
    pdf,
    render,
    retryKey,
    scale,
    scrollOnReady,
    localRetryKey,
  ]);

  // Declared after the render effect so a commit that changes both the page and the destination
  // finds the viewport already invalidated instead of scrolling with the outgoing page.
  useEffect(() => {
    // A cleared target releases the applied offset so the same destination can be requested again.
    if (targetTop === null) appliedTargetTopRef.current = null;
    else applyTargetTop();
  }, [applyTargetTop, targetTop]);

  return (
    <div ref={pageShellRef} className="knowledge-page" data-testid="knowledge-pdf-page-shell">
      {render && !error && (
        <>
          <canvas ref={canvasRef} aria-label={`Page ${pageIndex + 1}`} />
          <div ref={textLayerRef} className="knowledge-page__text-layer textLayer" />
          <KnowledgeSearchHighlightLayer
            textLayer={textLayerRef.current}
            textLayerVersion={textLayerVersion}
            matches={searchMatches}
            activeResultId={activeSearchResultId}
            onActiveHighlightReady={handleActiveSearchHighlightReady}
          />
          {linkRender && (
            <KnowledgeLinkLayer
              items={linkRender.items}
              viewport={linkRender.viewport}
              resolveUrl={resolveUrl}
              onActivateResolvedLink={onActivateResolvedLink}
              onActivateDestination={onActivateDestination}
            />
          )}
        </>
      )}
      {render && error && (
        <div
          className="knowledge-page__error"
          role="status"
          aria-live="polite"
          aria-label={`Page ${pageIndex + 1} rendering error`}
        >
          <p>{error}</p>
          <button
            type="button"
            aria-label={`Retry page ${pageIndex + 1}`}
            onClick={() => setLocalRetryKey((current) => current + 1)}
          >
            Retry page
          </button>
        </div>
      )}
    </div>
  );
}
