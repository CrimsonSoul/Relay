import { useEffect, useRef, useState } from 'react';
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
} from './KnowledgeLinkLayer';
import type { KnowledgeResolvedLink } from './knowledgeLinkResolver';

export type KnowledgePdfPageStatus =
  | { state: 'ready'; pageIndex: number; width: number; height: number }
  | { state: 'error'; pageIndex: number; message: string };

export type KnowledgePdfPageProps = {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  render: boolean;
  targetTop: number | null;
  retryKey: number;
  resolveUrl: (url: string) => KnowledgeResolvedLink;
  onActivateResolvedLink: (link: KnowledgeResolvedLink) => void;
  onActivateDestination: (destination: unknown) => void;
  onStatus: (status: KnowledgePdfPageStatus) => void;
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

function scrollViewer(element: HTMLDivElement | null, options: ScrollToOptions): void {
  if (typeof element?.scrollTo === 'function') element.scrollTo(options);
}

export function KnowledgePdfPage({
  pdf,
  pageIndex,
  scale,
  render,
  targetTop,
  retryKey,
  resolveUrl,
  onActivateResolvedLink,
  onActivateDestination,
  onStatus,
}: Readonly<KnowledgePdfPageProps>) {
  const [linkRender, setLinkRender] = useState<KnowledgeLinkRender | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localRetryKey, setLocalRetryKey] = useState(0);
  const pageShellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLinkRender(null);
    setError(null);
    if (!render) return;

    let disposed = false;
    let renderTask: RenderTask | null = null;
    let textLayer: TextLayer | null = null;
    let renderedPage: PDFPageProxy | null = null;
    const work: Promise<unknown>[] = [];
    let cleanupQueued = false;

    const cleanupPage = () => {
      if (!renderedPage || cleanupQueued) return;
      cleanupQueued = true;
      void Promise.allSettled(work).then(() => renderedPage?.cleanup());
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
          (renderError: unknown) => ({ error: renderError }),
        );

        let annotationsPromise: ReturnType<PDFPageProxy['getAnnotations']>;
        try {
          annotationsPromise = page.getAnnotations({ intent: 'display' }).catch(() => []);
        } catch {
          annotationsPromise = Promise.resolve([]);
        }
        work.push(annotationsPromise);
        const textContentPromise = page.getTextContent();
        work.push(textContentPromise);
        const [textContent, annotations] = await Promise.all([
          textContentPromise,
          annotationsPromise,
        ]);
        if (disposed) return;

        textLayer = new TextLayer({
          textContentSource: textContent,
          container: textContainer,
          viewport,
        });
        const textRender = textLayer.render();
        work.push(textRender);
        const [canvasResult] = await Promise.all([canvasRenderResult, textRender]);
        if (canvasResult.error !== null) throw canvasResult.error;
        if (disposed) return;

        if (targetTop !== null) {
          const [, y] = viewport.convertToViewportPoint(0, targetTop);
          scrollViewer(
            pageShellRef.current?.closest<HTMLDivElement>('.knowledge-viewer__viewport'),
            {
              top: Math.max(0, y - 28),
              behavior: 'smooth',
            },
          );
        } else {
          scrollViewer(
            pageShellRef.current?.closest<HTMLDivElement>('.knowledge-viewer__viewport'),
            {
              top: 0,
            },
          );
        }

        setLinkRender({ viewport, items: extractKnowledgeLinkItems(annotations) });
        onStatus({ state: 'ready', pageIndex, width: viewport.width, height: viewport.height });
      })
      .catch((renderError: unknown) => {
        if (disposed || isCancelledRender(renderError)) return;
        const message = 'Relay could not render this page.';
        setError(message);
        onStatus({ state: 'error', pageIndex, message });
      });

    return () => {
      disposed = true;
      renderTask?.cancel();
      textLayer?.cancel();
      cleanupPage();
    };
  }, [onStatus, pageIndex, pdf, render, retryKey, scale, targetTop, localRetryKey]);

  return (
    <div ref={pageShellRef} className="knowledge-page" data-testid="knowledge-pdf-page-shell">
      {render && !error && (
        <>
          <canvas ref={canvasRef} aria-label={`Page ${pageIndex + 1}`} />
          <div ref={textLayerRef} className="knowledge-page__text-layer textLayer" />
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
        <div className="knowledge-page__error" role="status">
          <p>{error}</p>
          <button type="button" onClick={() => setLocalRetryKey((current) => current + 1)}>
            Retry page
          </button>
        </div>
      )}
    </div>
  );
}
