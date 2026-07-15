import { useEffect, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  RenderingCancelledException,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import {
  extractKnowledgeLinkItems,
  KnowledgeLinkLayer,
  type KnowledgeLinkItem,
  type KnowledgePdfDestination,
} from './KnowledgeLinkLayer';
import type { KnowledgeResolvedLink } from './knowledgeLinkResolver';
import {
  resolveKnowledgePdfDestination,
  type KnowledgeViewerTarget,
} from './knowledgePdfDestination';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type Props = {
  document: KnowledgeDocumentRecord | null;
  active: boolean;
  target: KnowledgeViewerTarget | null;
  currentSection?: string | null;
  focusRequestKey?: number;
  resolveUrl: (url: string) => KnowledgeResolvedLink;
  onActivateResolvedLink: (link: KnowledgeResolvedLink) => void;
  onDestinationChange: (target: KnowledgeViewerTarget) => void;
  onPageChange: (pageIndex: number) => void;
};

type KnowledgeLinkRender = {
  pageIndex: number;
  viewport: ReturnType<PDFPageProxy['getViewport']>;
  items: KnowledgeLinkItem[];
};

type PendingFocusRequest = {
  key: number | undefined;
  documentId: string;
  target: KnowledgeViewerTarget;
};

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.4;
const SCALE_STEP = 0.15;

function viewerError(error: string): string {
  switch (error) {
    case 'not-available-offline':
      return 'This document is not cached on this laptop. Reconnect to the Relay server to open it.';
    case 'not-found':
      return 'This document is no longer available in the knowledge base.';
    case 'checksum-mismatch':
      return 'Relay could not verify this document. Refresh the library and try again.';
    default:
      return 'Relay could not open this document. Try again after the library refreshes.';
  }
}

function isCancelledRender(error: unknown): boolean {
  return (
    error instanceof RenderingCancelledException ||
    (error instanceof Error && error.name === 'RenderingCancelledException')
  );
}

function scrollViewer(element: HTMLDivElement | null, options: ScrollToOptions): void {
  if (typeof element?.scrollTo === 'function') element.scrollTo(options);
}

export function KnowledgePdfViewer({
  document: knowledgeDocument,
  active,
  target,
  currentSection,
  focusRequestKey,
  resolveUrl,
  onActivateResolvedLink,
  onDestinationChange,
  onPageChange,
}: Readonly<Props>) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [scale, setScale] = useState(1.05);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [linkRender, setLinkRender] = useState<KnowledgeLinkRender | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pdfIdentityRef = useRef<{
    pdf: PDFDocumentProxy;
    documentId: string;
    checksum: string;
  } | null>(null);
  const focusRequestRef = useRef({ initialized: false, value: focusRequestKey });
  const pendingFocusRequestRef = useRef<PendingFocusRequest | undefined>(undefined);
  const documentId = knowledgeDocument?.id;
  const documentChecksum = knowledgeDocument?.checksum;

  useEffect(() => {
    if (!active || !documentId || !documentChecksum || !globalThis.api?.getKnowledgePdf) {
      setPdf(null);
      return;
    }

    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let loadedPdf: PDFDocumentProxy | null = null;
    let loadingTaskDestroyed = false;
    pdfIdentityRef.current = null;
    setLoading(true);
    setError(null);
    setPageIndex(0);
    setPdf(null);

    globalThis.api
      .getKnowledgePdf({
        documentId,
        checksum: documentChecksum,
      })
      .then(async (result) => {
        if (disposed) return;
        if (!result.ok) {
          setError(viewerError(result.error));
          return;
        }
        loadingTask = getDocument({
          data: new Uint8Array(result.data),
          isEvalSupported: false,
          disableAutoFetch: true,
          disableStream: true,
          enableXfa: false,
          useWorkerFetch: false,
        });
        loadedPdf = await loadingTask.promise;
        if (disposed) {
          if (!loadingTaskDestroyed) await loadedPdf.destroy();
          return;
        }
        pdfIdentityRef.current = {
          pdf: loadedPdf,
          documentId,
          checksum: documentChecksum,
        };
        setPdf(loadedPdf);
      })
      .catch(() => {
        if (!disposed) setError(viewerError('download-failed'));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      if (loadedPdf) {
        loadedPdf.destroy().catch(() => undefined);
      } else if (loadingTask) {
        loadingTaskDestroyed = true;
        loadingTask.destroy().catch(() => undefined);
      }
    };
  }, [active, documentChecksum, documentId, retryKey]);

  useEffect(() => {
    if (!pdf || !target) return;
    const nextPage = Math.min(Math.max(0, target.pageIndex), pdf.numPages - 1);
    setPageIndex(nextPage);
  }, [pdf, target]);

  useEffect(() => {
    const request = focusRequestRef.current;
    if (!request.initialized) {
      request.initialized = true;
      request.value = focusRequestKey;
      return;
    }
    if (request.value !== focusRequestKey) {
      request.value = focusRequestKey;
      pendingFocusRequestRef.current =
        documentId && target
          ? {
              key: focusRequestKey,
              documentId,
              target: { pageIndex: target.pageIndex, top: target.top },
            }
          : undefined;
      return;
    }

    const pendingRequest = pendingFocusRequestRef.current;
    if (
      pendingRequest &&
      (pendingRequest.documentId !== documentId ||
        !target ||
        pendingRequest.target.pageIndex !== target.pageIndex ||
        pendingRequest.target.top !== target.top)
    ) {
      pendingFocusRequestRef.current = undefined;
    }
  }, [documentId, focusRequestKey, target]);

  useEffect(() => {
    setLinkRender(null);
    const pdfIdentity = pdfIdentityRef.current;
    if (
      !pdf ||
      !active ||
      pdfIdentity?.pdf !== pdf ||
      pdfIdentity.documentId !== documentId ||
      pdfIdentity.checksum !== documentChecksum
    ) {
      return;
    }
    let disposed = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    let renderedPage: PDFPageProxy | null = null;
    let adjacentPage: PDFPageProxy | null = null;

    pdf
      .getPage(pageIndex + 1)
      .then(async (page) => {
        if (disposed) return;
        renderedPage = page;
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
        const canvasRenderResult = renderTask.promise.then(
          () => ({ error: null }),
          (renderError: unknown) => ({ error: renderError }),
        );
        const [textContent, annotations] = await Promise.all([
          page.getTextContent(),
          page.getAnnotations({ intent: 'display' }),
        ]);
        if (disposed) return;
        textLayer = new TextLayer({
          textContentSource: textContent,
          container: textContainer,
          viewport,
        });
        const [canvasResult] = await Promise.all([canvasRenderResult, textLayer.render()]);
        if (canvasResult.error !== null) throw canvasResult.error;
        if (disposed) return;

        if (target?.pageIndex === pageIndex && target.top !== null) {
          const [, y] = viewport.convertToViewportPoint(0, target.top);
          scrollViewer(viewportRef.current, { top: Math.max(0, y - 28), behavior: 'smooth' });
        } else {
          scrollViewer(viewportRef.current, { top: 0 });
        }

        setLinkRender({
          pageIndex,
          viewport,
          items: extractKnowledgeLinkItems(annotations),
        });

        const pendingFocusRequest = pendingFocusRequestRef.current;
        if (
          pendingFocusRequest !== undefined &&
          pendingFocusRequest.key === focusRequestKey &&
          pendingFocusRequest.documentId === documentId &&
          pendingFocusRequest.target.pageIndex === pageIndex &&
          target?.pageIndex === pendingFocusRequest.target.pageIndex &&
          target.top === pendingFocusRequest.target.top
        ) {
          viewportRef.current?.focus();
          pendingFocusRequestRef.current = undefined;
        }

        const adjacentIndex = pageIndex + 1 < pdf.numPages ? pageIndex + 1 : pageIndex - 1;
        if (adjacentIndex >= 0) {
          pdf
            .getPage(adjacentIndex + 1)
            .then(async (pageToPreload) => {
              if (disposed) {
                pageToPreload.cleanup();
                return;
              }
              adjacentPage = pageToPreload;
              await pageToPreload.getOperatorList();
            })
            .catch(() => undefined);
        }
      })
      .catch((renderError) => {
        if (!disposed && !isCancelledRender(renderError)) {
          setError('Relay could not render this page.');
        }
      });

    return () => {
      disposed = true;
      renderTask?.cancel();
      textLayer?.cancel();
      renderedPage?.cleanup();
      adjacentPage?.cleanup();
    };
  }, [active, documentChecksum, documentId, focusRequestKey, pageIndex, pdf, scale, target]);

  const activateDestination = async (destination: KnowledgePdfDestination) => {
    if (!pdf) return;
    const nextTarget = await resolveKnowledgePdfDestination(pdf, destination);
    if (nextTarget) {
      onDestinationChange(nextTarget);
      return;
    }
    onActivateResolvedLink({ kind: 'unavailable', reason: 'unsupported' });
  };

  const moveToPage = (nextPage: number) => {
    if (!pdf) return;
    const boundedPage = Math.min(Math.max(0, nextPage), pdf.numPages - 1);
    setPageIndex(boundedPage);
    onPageChange(boundedPage);
  };

  const fitWidth = async () => {
    if (!pdf) return;
    const page = await pdf.getPage(pageIndex + 1);
    const naturalViewport = page.getViewport({ scale: 1 });
    const availableWidth = Math.max(320, (viewportRef.current?.clientWidth ?? 720) - 48);
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, availableWidth / naturalViewport.width)));
  };

  if (!knowledgeDocument) {
    return (
      <div className="knowledge-viewer-state">
        <span className="knowledge-viewer-state__eyebrow">Focus reader</span>
        <h2>Select a document</h2>
        <p>Choose a guide from the library to read it here.</p>
      </div>
    );
  }

  return (
    <section className="knowledge-viewer" aria-label={`${knowledgeDocument.title} PDF viewer`}>
      <header className="knowledge-viewer__toolbar">
        <div className="knowledge-viewer__identity">
          <span className="knowledge-viewer__eyebrow">{knowledgeDocument.category}</span>
          <h2>{knowledgeDocument.title}</h2>
          <span className="knowledge-viewer__section">
            {currentSection ? `Current section · ${currentSection}` : 'Document overview'}
          </span>
        </div>
        <div className="knowledge-viewer__controls" aria-label="PDF controls">
          <button
            type="button"
            aria-label="Previous page"
            disabled={!pdf || pageIndex === 0}
            onClick={() => moveToPage(pageIndex - 1)}
          >
            ←
          </button>
          <span className="knowledge-viewer__page-status" aria-live="polite">
            {pdf ? `Page ${pageIndex + 1} of ${pdf.numPages}` : 'Loading document'}
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={!pdf || pageIndex >= pdf.numPages - 1}
            onClick={() => moveToPage(pageIndex + 1)}
          >
            →
          </button>
          <span className="knowledge-viewer__control-divider" aria-hidden="true" />
          <button
            type="button"
            aria-label="Zoom out"
            disabled={!pdf || scale <= MIN_SCALE}
            onClick={() => setScale((current) => Math.max(MIN_SCALE, current - SCALE_STEP))}
          >
            −
          </button>
          <span className="knowledge-viewer__zoom">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={!pdf || scale >= MAX_SCALE}
            onClick={() => setScale((current) => Math.min(MAX_SCALE, current + SCALE_STEP))}
          >
            +
          </button>
          <button
            type="button"
            className="knowledge-viewer__fit"
            disabled={!pdf}
            onClick={fitWidth}
          >
            Fit width
          </button>
        </div>
      </header>
      <div className="knowledge-viewer__viewport" ref={viewportRef} tabIndex={-1}>
        {loading && <div className="knowledge-viewer__loading">Preparing document…</div>}
        {error && (
          <div className="knowledge-viewer-state knowledge-viewer-state--error" role="status">
            <span className="knowledge-viewer-state__eyebrow">Document unavailable</span>
            <h3>Unable to open this guide</h3>
            <p>{error}</p>
            <button type="button" onClick={() => setRetryKey((current) => current + 1)}>
              Retry document
            </button>
          </div>
        )}
        {!error && (
          <div className="knowledge-page" hidden={!pdf}>
            <canvas ref={canvasRef} aria-label={`Page ${pageIndex + 1}`} />
            <div ref={textLayerRef} className="knowledge-page__text-layer textLayer" />
            {linkRender?.pageIndex === pageIndex && (
              <KnowledgeLinkLayer
                items={linkRender.items}
                viewport={linkRender.viewport}
                resolveUrl={resolveUrl}
                onActivateResolvedLink={onActivateResolvedLink}
                onActivateDestination={(destination) => void activateDestination(destination)}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}
