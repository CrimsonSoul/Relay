import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import {
  KnowledgeContinuousPdf,
  type KnowledgeContinuousPdfHandle,
} from './KnowledgeContinuousPdf';
import type { KnowledgePdfDestination } from './KnowledgeLinkLayer';
import type { KnowledgeResolvedLink } from './knowledgeLinkResolver';
import { KnowledgePdfPage, type KnowledgePdfPageStatus } from './KnowledgePdfPage';
import {
  clampKnowledgePdfPageIndex,
  resolveKnowledgePdfDestination,
  type KnowledgeViewerTarget,
} from './knowledgePdfDestination';
import { loadKnowledgePdfViewMode, persistKnowledgePdfViewMode } from './knowledgePdfViewMode';

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

type PendingFocusRequest = {
  key: number | undefined;
  documentId: string;
  targetRequestKey: string;
  target: KnowledgeViewerTarget;
};

type SingleTopRequest = {
  documentId: string;
  checksum: string;
  target: KnowledgeViewerTarget;
};

type KnowledgeViewerError = {
  message: string;
  documentId: string;
  checksum: string;
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

function viewerTargetsMatch(
  left: KnowledgeViewerTarget | null,
  right: KnowledgeViewerTarget | null,
): boolean {
  if (!left || !right) return left === right;
  return left?.pageIndex === right?.pageIndex && left?.top === right?.top;
}

function normalizedViewerTarget(
  target: KnowledgeViewerTarget | null,
  pageCount: number,
): KnowledgeViewerTarget | null {
  if (!target) return null;
  return {
    pageIndex: clampKnowledgePdfPageIndex(target.pageIndex, pageCount),
    top: target.top,
  };
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
  const documentId = knowledgeDocument?.id;
  const documentChecksum = knowledgeDocument?.checksum;
  const targetPageIndex = target?.pageIndex;
  const targetTop = target?.top;
  const initialNavigationTarget = normalizedViewerTarget(target, knowledgeDocument?.pageCount ?? 0);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [scale, setScale] = useState(1.05);
  const [viewMode, setViewMode] = useState(loadKnowledgePdfViewMode);
  const [navigationTarget, setNavigationTarget] = useState<KnowledgeViewerTarget | null>(
    initialNavigationTarget,
  );
  const [singleTopRequest, setSingleTopRequest] = useState<SingleTopRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<KnowledgeViewerError | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLElement>(null);
  const continuousPdfRef = useRef<KnowledgeContinuousPdfHandle>(null);
  const pageIndexRef = useRef(0);
  const observedPageIndexRef = useRef(0);
  const navigationTargetRef = useRef<KnowledgeViewerTarget | null>(initialNavigationTarget);
  const issuedNavigationTargetRef = useRef<KnowledgeViewerTarget | null>(null);
  const readyPageIndicesRef = useRef(new Set<number>());
  const pdfIdentityRef = useRef<{
    pdf: PDFDocumentProxy;
    documentId: string;
    checksum: string;
    generation: number;
  } | null>(null);
  const pdfGenerationRef = useRef(0);
  const destinationRequestTokenRef = useRef(0);
  const focusRequestRef = useRef({ initialized: false, value: focusRequestKey });
  const pendingFocusRequestRef = useRef<PendingFocusRequest | undefined>(undefined);
  const normalizedTargetPageIndex =
    targetPageIndex === undefined
      ? undefined
      : clampKnowledgePdfPageIndex(
          targetPageIndex,
          pdf?.numPages ?? knowledgeDocument?.pageCount ?? 0,
        );
  const targetRequestKey = `${documentId ?? ''}:${focusRequestKey ?? ''}:${targetPageIndex ?? ''}:${targetTop ?? ''}`;
  const previousTargetRef = useRef(target);
  const previousTargetRequestKeyRef = useRef(targetRequestKey);
  const previousViewModeRef = useRef(viewMode);
  const viewModeRef = useRef(viewMode);
  const activeDocumentRef = useRef({ active, documentId, checksum: documentChecksum });
  const focusContextRef = useRef({
    documentId,
    focusRequestKey,
    targetPageIndex: normalizedTargetPageIndex,
    targetTop,
  });
  activeDocumentRef.current = { active, documentId, checksum: documentChecksum };
  focusContextRef.current = {
    documentId,
    focusRequestKey,
    targetPageIndex: normalizedTargetPageIndex,
    targetTop,
  };
  viewModeRef.current = viewMode;

  useEffect(() => {
    if (!active || !documentId || !documentChecksum || !globalThis.api?.getKnowledgePdf) {
      setPdf(null);
      return;
    }

    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let loadedPdf: PDFDocumentProxy | null = null;
    let loadingTaskDestroyed = false;
    const generation = pdfGenerationRef.current + 1;
    pdfGenerationRef.current = generation;
    pdfIdentityRef.current = null;
    readyPageIndicesRef.current.clear();
    setLoading(true);
    setError(null);
    pageIndexRef.current = 0;
    observedPageIndexRef.current = 0;
    issuedNavigationTargetRef.current = null;
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
          setError({
            message: viewerError(result.error),
            documentId,
            checksum: documentChecksum,
          });
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
          generation,
        };
        setPdf(loadedPdf);
      })
      .catch(() => {
        if (!disposed) {
          setError({
            message: viewerError('download-failed'),
            documentId,
            checksum: documentChecksum,
          });
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
      if (pdfIdentityRef.current?.generation === generation) pdfIdentityRef.current = null;
      if (loadedPdf) {
        loadedPdf.destroy().catch(() => undefined);
      } else if (loadingTask) {
        loadingTaskDestroyed = true;
        loadingTask.destroy().catch(() => undefined);
      }
    };
  }, [active, documentChecksum, documentId, retryKey]);

  useEffect(() => {
    const isNewTargetRequest =
      previousTargetRef.current !== target ||
      previousTargetRequestKeyRef.current !== targetRequestKey;
    const nextTarget =
      normalizedTargetPageIndex === undefined
        ? null
        : { pageIndex: normalizedTargetPageIndex, top: targetTop ?? null };
    if (!isNewTargetRequest) {
      const pendingTarget = navigationTargetRef.current;
      if (!pendingTarget || viewerTargetsMatch(pendingTarget, nextTarget)) return;
    }
    previousTargetRef.current = target;
    previousTargetRequestKeyRef.current = targetRequestKey;
    navigationTargetRef.current = nextTarget;
    issuedNavigationTargetRef.current = null;
    setNavigationTarget(nextTarget);
    const activePdfIdentity = pdfIdentityRef.current;
    const canApplySingleTarget =
      isNewTargetRequest &&
      nextTarget &&
      viewModeRef.current === 'single' &&
      activeDocumentRef.current.active &&
      activePdfIdentity?.documentId === documentId &&
      activePdfIdentity.checksum === documentChecksum;
    if (canApplySingleTarget) {
      if (pageIndexRef.current !== nextTarget.pageIndex) {
        pageIndexRef.current = nextTarget.pageIndex;
        setPageIndex(nextTarget.pageIndex);
      } else if (nextTarget.top === null) {
        setSingleTopRequest({
          documentId: activePdfIdentity.documentId,
          checksum: activePdfIdentity.checksum,
          target: nextTarget,
        });
      }
    }
  }, [
    documentChecksum,
    documentId,
    normalizedTargetPageIndex,
    target,
    targetRequestKey,
    targetTop,
  ]);

  useEffect(() => {
    if (
      !pdf ||
      normalizedTargetPageIndex === undefined ||
      pageIndexRef.current === normalizedTargetPageIndex
    ) {
      return;
    }
    pageIndexRef.current = normalizedTargetPageIndex;
    setPageIndex(normalizedTargetPageIndex);
  }, [normalizedTargetPageIndex, pdf]);

  useEffect(() => {
    const previousViewMode = previousViewModeRef.current;
    previousViewModeRef.current = viewMode;
    if (previousViewMode !== 'single' || viewMode !== 'continuous' || !pdf) return;
    const pendingTarget = navigationTargetRef.current;
    const targetOffset =
      pendingTarget?.pageIndex === pageIndexRef.current ? pendingTarget.top : null;
    continuousPdfRef.current?.scrollToPage(pageIndexRef.current, targetOffset);
  }, [pdf, viewMode]);

  useEffect(() => {
    if (!pdf || viewMode !== 'single') return;
    const previousPageNumber = pageIndex;
    const nextPageNumber = pageIndex + 2;
    const warmPage = async (pageNumber: number) => {
      const page = await pdf.getPage(pageNumber);
      await page.getOperatorList({ intent: 'display' });
    };
    if (previousPageNumber >= 1) warmPage(previousPageNumber).catch(() => undefined);
    if (nextPageNumber <= pdf.numPages) warmPage(nextPageNumber).catch(() => undefined);
  }, [pageIndex, pdf, viewMode]);

  useEffect(() => {
    destinationRequestTokenRef.current += 1;
  }, [active, documentChecksum, documentId, pdf, retryKey, target]);

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
        documentId && normalizedTargetPageIndex !== undefined
          ? {
              key: focusRequestKey,
              documentId,
              targetRequestKey,
              target: { pageIndex: normalizedTargetPageIndex, top: targetTop ?? null },
            }
          : undefined;
      return;
    }

    const pendingRequest = pendingFocusRequestRef.current;
    if (
      pendingRequest &&
      (pendingRequest.documentId !== documentId ||
        pendingRequest.targetRequestKey !== targetRequestKey ||
        normalizedTargetPageIndex === undefined)
    ) {
      pendingFocusRequestRef.current = undefined;
      return;
    }
    if (
      pendingRequest &&
      (pendingRequest.target.pageIndex !== normalizedTargetPageIndex ||
        pendingRequest.target.top !== (targetTop ?? null))
    ) {
      pendingRequest.target = {
        pageIndex: normalizedTargetPageIndex,
        top: targetTop ?? null,
      };
    }
  }, [documentId, focusRequestKey, normalizedTargetPageIndex, targetRequestKey, targetTop]);

  useEffect(() => {
    const pendingRequest = pendingFocusRequestRef.current;
    if (
      error &&
      error.documentId === documentId &&
      error.checksum === documentChecksum &&
      pendingRequest !== undefined &&
      pendingRequest.key === focusRequestKey &&
      pendingRequest.documentId === documentId &&
      normalizedTargetPageIndex === pendingRequest.target.pageIndex &&
      (targetTop ?? null) === pendingRequest.target.top
    ) {
      viewportRef.current?.focus();
      pendingFocusRequestRef.current = undefined;
    }
  }, [documentChecksum, documentId, error, focusRequestKey, normalizedTargetPageIndex, targetTop]);

  const activateDestination = useCallback(
    async (destination: KnowledgePdfDestination) => {
      if (!pdf) return;
      const requestToken = destinationRequestTokenRef.current + 1;
      destinationRequestTokenRef.current = requestToken;
      const sourceIdentity = pdfIdentityRef.current;
      if (
        sourceIdentity?.pdf !== pdf ||
        sourceIdentity.documentId !== documentId ||
        sourceIdentity.checksum !== documentChecksum
      ) {
        return;
      }
      const nextTarget = await resolveKnowledgePdfDestination(pdf, destination);
      const currentIdentity = pdfIdentityRef.current;
      const activeDocument = activeDocumentRef.current;
      if (
        destinationRequestTokenRef.current !== requestToken ||
        currentIdentity?.pdf !== sourceIdentity.pdf ||
        currentIdentity.generation !== sourceIdentity.generation ||
        currentIdentity.documentId !== sourceIdentity.documentId ||
        currentIdentity.checksum !== sourceIdentity.checksum ||
        !activeDocument.active ||
        activeDocument.documentId !== sourceIdentity.documentId ||
        activeDocument.checksum !== sourceIdentity.checksum
      ) {
        return;
      }
      if (nextTarget) {
        onDestinationChange(nextTarget);
        return;
      }
      onActivateResolvedLink({ kind: 'unavailable', reason: 'unsupported' });
    },
    [documentChecksum, documentId, onActivateResolvedLink, onDestinationChange, pdf],
  );

  const focusPendingRequest = useCallback((pageIndex: number) => {
    const pendingFocusRequest = pendingFocusRequestRef.current;
    const focusContext = focusContextRef.current;
    if (
      pendingFocusRequest !== undefined &&
      pendingFocusRequest.key === focusContext.focusRequestKey &&
      pendingFocusRequest.documentId === focusContext.documentId &&
      pendingFocusRequest.target.pageIndex === pageIndex &&
      focusContext.targetPageIndex === pendingFocusRequest.target.pageIndex &&
      focusContext.targetTop === pendingFocusRequest.target.top
    ) {
      viewerRef.current?.querySelector<HTMLDivElement>('.knowledge-viewer__viewport')?.focus();
      pendingFocusRequestRef.current = undefined;
    }
  }, []);

  const consumeNavigationTarget = useCallback(
    (pageIndex: number) => {
      const pendingTarget = navigationTargetRef.current;
      if (
        pendingTarget?.pageIndex !== pageIndex ||
        observedPageIndexRef.current !== pageIndex ||
        !readyPageIndicesRef.current.has(pageIndex) ||
        !viewerTargetsMatch(issuedNavigationTargetRef.current, pendingTarget)
      ) {
        return false;
      }
      focusPendingRequest(pageIndex);
      navigationTargetRef.current = null;
      issuedNavigationTargetRef.current = null;
      setNavigationTarget(null);
      return true;
    },
    [focusPendingRequest],
  );

  useEffect(() => {
    if (!singleTopRequest) return;
    setSingleTopRequest((currentRequest) =>
      currentRequest === singleTopRequest ? null : currentRequest,
    );
    const activePdfIdentity = pdfIdentityRef.current;
    const activeDocument = activeDocumentRef.current;
    const pendingTarget = navigationTargetRef.current;
    if (
      viewModeRef.current !== 'single' ||
      !activeDocument.active ||
      activeDocument.documentId !== singleTopRequest.documentId ||
      activeDocument.checksum !== singleTopRequest.checksum ||
      activePdfIdentity?.documentId !== singleTopRequest.documentId ||
      activePdfIdentity.checksum !== singleTopRequest.checksum ||
      !viewerTargetsMatch(pendingTarget, singleTopRequest.target) ||
      pageIndexRef.current !== singleTopRequest.target.pageIndex
    ) {
      return;
    }
    viewportRef.current?.scrollTo({ top: 0 });
    observedPageIndexRef.current = singleTopRequest.target.pageIndex;
    issuedNavigationTargetRef.current = singleTopRequest.target;
    consumeNavigationTarget(singleTopRequest.target.pageIndex);
  }, [consumeNavigationTarget, singleTopRequest]);

  const handlePageStatus = useCallback(
    (status: KnowledgePdfPageStatus) => {
      if (status.state !== 'ready') return;
      readyPageIndicesRef.current.add(status.pageIndex);
      if (viewModeRef.current === 'single') {
        observedPageIndexRef.current = status.pageIndex;
        const pendingTarget = navigationTargetRef.current;
        if (pendingTarget?.pageIndex === status.pageIndex) {
          issuedNavigationTargetRef.current = pendingTarget;
        }
      }
      focusPendingRequest(status.pageIndex);
      consumeNavigationTarget(status.pageIndex);
    },
    [consumeNavigationTarget, focusPendingRequest],
  );

  const handleTargetNavigationComplete = useCallback(
    (completedTarget: KnowledgeViewerTarget) => {
      if (!viewerTargetsMatch(navigationTargetRef.current, completedTarget)) return;
      issuedNavigationTargetRef.current = completedTarget;
      if (readyPageIndicesRef.current.has(completedTarget.pageIndex)) {
        focusPendingRequest(completedTarget.pageIndex);
      }
      consumeNavigationTarget(completedTarget.pageIndex);
    },
    [consumeNavigationTarget, focusPendingRequest],
  );

  const handleContinuousPageChange = useCallback(
    (nextPageIndex: number) => {
      observedPageIndexRef.current = nextPageIndex;
      const pendingTarget = navigationTargetRef.current;
      if (pendingTarget && pendingTarget.pageIndex !== nextPageIndex) return;
      if (pendingTarget?.pageIndex === nextPageIndex) {
        if (!consumeNavigationTarget(nextPageIndex)) return;
      }
      if (pageIndexRef.current === nextPageIndex) return;
      pageIndexRef.current = nextPageIndex;
      setPageIndex(nextPageIndex);
      onPageChange(nextPageIndex);
    },
    [consumeNavigationTarget, onPageChange],
  );

  const pageTargetTop = navigationTarget?.pageIndex === pageIndex ? navigationTarget.top : null;

  const moveToPage = (nextPage: number) => {
    if (!pdf) return;
    destinationRequestTokenRef.current += 1;
    pendingFocusRequestRef.current = undefined;
    const boundedPage = clampKnowledgePdfPageIndex(nextPage, pdf.numPages);
    if (navigationTargetRef.current) {
      navigationTargetRef.current = null;
      issuedNavigationTargetRef.current = null;
      setNavigationTarget(null);
    }
    if (viewMode === 'continuous') {
      continuousPdfRef.current?.scrollToPage(boundedPage);
      return;
    }
    pageIndexRef.current = boundedPage;
    setPageIndex(boundedPage);
    onPageChange(boundedPage);
  };

  const fitWidth = async () => {
    if (!pdf) return;
    const page = await pdf.getPage(pageIndex + 1);
    const naturalViewport = page.getViewport({ scale: 1 });
    const activeViewport = viewerRef.current?.querySelector<HTMLDivElement>(
      '.knowledge-viewer__viewport',
    );
    const availableWidth = Math.max(320, (activeViewport?.clientWidth ?? 720) - 48);
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, availableWidth / naturalViewport.width)));
  };

  const toggleViewMode = () => {
    const nextMode = viewMode === 'continuous' ? 'single' : 'continuous';
    persistKnowledgePdfViewMode(nextMode);
    setViewMode(nextMode);
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
    <section
      ref={viewerRef}
      className="knowledge-viewer"
      aria-label={`${knowledgeDocument.title} PDF viewer`}
    >
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
          <span className="knowledge-viewer__control-divider" aria-hidden="true" />
          <button
            type="button"
            className="knowledge-viewer__mode"
            aria-pressed={viewMode === 'continuous'}
            onClick={toggleViewMode}
          >
            {viewMode === 'continuous' ? 'View: Continuous' : 'View: Single page'}
          </button>
        </div>
      </header>
      {!pdf && (loading || error) && (
        <div className="knowledge-viewer__viewport" ref={viewportRef} tabIndex={-1}>
          {loading && <div className="knowledge-viewer__loading">Preparing document…</div>}
          {error && (
            <div className="knowledge-viewer-state knowledge-viewer-state--error" role="status">
              <span className="knowledge-viewer-state__eyebrow">Document unavailable</span>
              <h3>Unable to open this guide</h3>
              <p>{error.message}</p>
              <button type="button" onClick={() => setRetryKey((current) => current + 1)}>
                Retry document
              </button>
            </div>
          )}
        </div>
      )}
      {!error && pdf && viewMode === 'continuous' && (
        <KnowledgeContinuousPdf
          ref={continuousPdfRef}
          pdf={pdf}
          scale={scale}
          activePageIndex={pageIndex}
          target={navigationTarget}
          focusRequestKey={focusRequestKey ?? 0}
          resolveUrl={resolveUrl}
          onActivateResolvedLink={onActivateResolvedLink}
          onActivateDestination={activateDestination}
          onPageStatus={handlePageStatus}
          onTargetNavigationComplete={handleTargetNavigationComplete}
          onCurrentPageChange={handleContinuousPageChange}
        />
      )}
      {!error && pdf && viewMode === 'single' && (
        <div className="knowledge-viewer__viewport" ref={viewportRef} tabIndex={-1}>
          <KnowledgePdfPage
            pdf={pdf}
            pageIndex={pageIndex}
            scale={scale}
            render
            targetTop={pageTargetTop}
            retryKey={retryKey}
            resolveUrl={resolveUrl}
            onActivateResolvedLink={onActivateResolvedLink}
            onActivateDestination={activateDestination}
            onStatus={handlePageStatus}
          />
        </div>
      )}
    </section>
  );
}
