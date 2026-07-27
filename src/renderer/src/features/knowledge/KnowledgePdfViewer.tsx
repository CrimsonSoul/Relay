import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import type { KnowledgeDocumentSearchMatch } from './knowledgeDocumentSearch';
import type { KnowledgeSearchNavigationRequest } from './useKnowledgeDocumentSearch';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type KnowledgePdfSession = {
  pdf: PDFDocumentProxy;
  documentId: string;
  checksum: string;
  generation: number;
};

type Props = {
  document: KnowledgeDocumentRecord | null;
  active: boolean;
  target: KnowledgeViewerTarget | null;
  currentSection?: string | null;
  focusRequestKey?: number;
  toolbarLeading?: ReactNode;
  resolveUrl: (url: string) => KnowledgeResolvedLink;
  onActivateResolvedLink: (link: KnowledgeResolvedLink) => void;
  onDestinationChange: (target: KnowledgeViewerTarget) => void;
  onPageChange: (pageIndex: number) => void;
  onPdfSessionChange?: (session: KnowledgePdfSession | null) => void;
  searchNavigationRequest?: KnowledgeSearchNavigationRequest | null;
  searchMatches?: readonly KnowledgeDocumentSearchMatch[];
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

type PendingSearchRequest = {
  key: number;
  result: KnowledgeDocumentSearchMatch;
  pageIndex: number;
  documentId: string;
  checksum: string;
  generation: number;
};

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.4;
const SCALE_STEP = 0.15;
const SETTLED_SCROLL_MS = 1_500;

function viewerError(error: string): string {
  switch (error) {
    case 'not-available-offline':
      return 'This document is not cached on this laptop. Reconnect to the Relay server to open it.';
    case 'not-found':
      return 'This document is no longer available in the Wiki.';
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

function viewerScrollBehavior(): ScrollBehavior {
  return typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

export function KnowledgePdfViewer({
  document: knowledgeDocument,
  active,
  target,
  currentSection,
  focusRequestKey,
  toolbarLeading,
  resolveUrl,
  onActivateResolvedLink,
  onDestinationChange,
  onPageChange,
  onPdfSessionChange,
  searchNavigationRequest = null,
  searchMatches = [],
}: Readonly<Props>) {
  const documentId = knowledgeDocument?.id;
  const documentChecksum = knowledgeDocument?.checksum;
  const targetPageIndex = target?.pageIndex;
  const targetTop = target?.top;
  const initialNavigationTarget = normalizedViewerTarget(target, knowledgeDocument?.pageCount ?? 0);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [viewMode, setViewMode] = useState(loadKnowledgePdfViewMode);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const [navigationTarget, setNavigationTarget] = useState<KnowledgeViewerTarget | null>(
    initialNavigationTarget,
  );
  const [singleTopRequest, setSingleTopRequest] = useState<SingleTopRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<KnowledgeViewerError | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLElement>(null);
  const viewOptionsRef = useRef<HTMLDivElement>(null);
  const viewOptionsButtonRef = useRef<HTMLButtonElement>(null);
  const continuousPdfRef = useRef<KnowledgeContinuousPdfHandle>(null);
  const pageIndexRef = useRef(0);
  const observedPageIndexRef = useRef(0);
  const navigationTargetRef = useRef<KnowledgeViewerTarget | null>(initialNavigationTarget);
  const issuedNavigationTargetRef = useRef<KnowledgeViewerTarget | null>(null);
  const readyPageIndicesRef = useRef(new Set<number>());
  const settledScrollTimerRef = useRef<number | null>(null);
  const pdfIdentityRef = useRef<KnowledgePdfSession | null>(null);
  const loadedDocumentIdentityRef = useRef<string | null>(null);
  const activePdfIdentity = pdfIdentityRef.current;
  const activePdf =
    active &&
    pdf &&
    activePdfIdentity?.pdf === pdf &&
    activePdfIdentity.documentId === documentId &&
    activePdfIdentity.checksum === documentChecksum
      ? pdf
      : null;
  const pdfGenerationRef = useRef(0);
  const destinationRequestTokenRef = useRef(0);
  const focusRequestRef = useRef({ initialized: false, value: focusRequestKey });
  const pendingFocusRequestRef = useRef<PendingFocusRequest | undefined>(undefined);
  const pendingSearchRequestRef = useRef<PendingSearchRequest | null>(null);
  const handledSearchRequestKeyRef = useRef<number | null>(null);
  const normalizedTargetPageIndex =
    targetPageIndex === undefined
      ? undefined
      : clampKnowledgePdfPageIndex(
          targetPageIndex,
          activePdf?.numPages ?? knowledgeDocument?.pageCount ?? 0,
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
  const searchMatchesByPage = useMemo(() => {
    const matchesByPage = new Map<number, KnowledgeDocumentSearchMatch[]>();
    for (const match of searchMatches) {
      const pageMatches = matchesByPage.get(match.pageIndex);
      if (pageMatches) pageMatches.push(match);
      else matchesByPage.set(match.pageIndex, [match]);
    }
    return matchesByPage;
  }, [searchMatches]);
  const activeSearchResultId = searchNavigationRequest?.result.id ?? null;

  const closeViewOptions = useCallback((restoreFocus = false) => {
    setViewOptionsOpen(false);
    if (restoreFocus) queueMicrotask(() => viewOptionsButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!viewOptionsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && viewOptionsRef.current?.contains(event.target)) return;
      closeViewOptions();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeViewOptions(true);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeViewOptions, viewOptionsOpen]);

  useEffect(() => {
    setViewOptionsOpen(false);
  }, [documentId]);

  useEffect(() => {
    if (!active || !documentId || !documentChecksum || !globalThis.api?.getKnowledgePdf) {
      setPdf(null);
      if (!documentId || !documentChecksum) loadedDocumentIdentityRef.current = null;
      return;
    }

    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let loadedPdf: PDFDocumentProxy | null = null;
    let loadingTaskDestroyed = false;
    const destroyLoadingTask = async () => {
      if (!loadingTask || loadingTaskDestroyed) return;
      loadingTaskDestroyed = true;
      await loadingTask.destroy();
    };
    const generation = pdfGenerationRef.current + 1;
    const documentIdentity = `${documentId}:${documentChecksum}`;
    const preserveViewState = loadedDocumentIdentityRef.current === documentIdentity;
    loadedDocumentIdentityRef.current = documentIdentity;
    pdfGenerationRef.current = generation;
    pdfIdentityRef.current = null;
    pendingSearchRequestRef.current = null;
    handledSearchRequestKeyRef.current = null;
    readyPageIndicesRef.current.clear();
    setPdf(null);
    if (!preserveViewState) {
      setPageIndex(0);
      setScale(1);
      pageIndexRef.current = 0;
      observedPageIndexRef.current = 0;
    } else {
      observedPageIndexRef.current = pageIndexRef.current;
    }
    setNavigationTarget(null);
    setSingleTopRequest(null);
    setViewOptionsOpen(false);
    setLoading(true);
    setError(null);
    navigationTargetRef.current = null;
    issuedNavigationTargetRef.current = null;
    previousTargetRequestKeyRef.current = '';
    pendingFocusRequestRef.current = undefined;

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
          await destroyLoadingTask();
          return;
        }
        const session: KnowledgePdfSession = {
          pdf: loadedPdf,
          documentId,
          checksum: documentChecksum,
          generation,
        };
        pdfIdentityRef.current = session;
        onPdfSessionChange?.(session);
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
      if (pdfIdentityRef.current?.generation === generation) {
        pdfIdentityRef.current = null;
        pendingSearchRequestRef.current = null;
        onPdfSessionChange?.(null);
      }
      void destroyLoadingTask().catch(() => undefined);
    };
  }, [active, documentChecksum, documentId, onPdfSessionChange, retryKey]);

  useEffect(() => {
    if (!searchNavigationRequest) {
      pendingSearchRequestRef.current = null;
      return;
    }
    const identity = pdfIdentityRef.current;
    if (
      !activePdf ||
      !documentId ||
      !documentChecksum ||
      identity?.pdf !== activePdf ||
      identity.documentId !== documentId ||
      identity.checksum !== documentChecksum ||
      searchNavigationRequest.key === handledSearchRequestKeyRef.current
    ) {
      return;
    }

    const pageIndex = clampKnowledgePdfPageIndex(
      searchNavigationRequest.result.pageIndex,
      activePdf.numPages,
    );
    pendingSearchRequestRef.current = {
      ...searchNavigationRequest,
      pageIndex,
      documentId,
      checksum: documentChecksum,
      generation: identity.generation,
    };
    pageIndexRef.current = pageIndex;
    setPageIndex(pageIndex);
    if (viewModeRef.current === 'continuous') {
      continuousPdfRef.current?.scrollToPage(pageIndex);
    }
  }, [activePdf, documentChecksum, documentId, searchNavigationRequest, viewMode]);

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
      !activePdf ||
      normalizedTargetPageIndex === undefined ||
      pageIndexRef.current === normalizedTargetPageIndex
    ) {
      return;
    }
    pageIndexRef.current = normalizedTargetPageIndex;
    setPageIndex(normalizedTargetPageIndex);
  }, [activePdf, normalizedTargetPageIndex]);

  useEffect(() => {
    const previousViewMode = previousViewModeRef.current;
    previousViewModeRef.current = viewMode;
    if (previousViewMode !== 'single' || viewMode !== 'continuous' || !activePdf) return;
    const pendingTarget = navigationTargetRef.current;
    const targetOffset =
      pendingTarget?.pageIndex === pageIndexRef.current ? pendingTarget.top : null;
    continuousPdfRef.current?.scrollToPage(pageIndexRef.current, targetOffset);
  }, [activePdf, viewMode]);

  useEffect(() => {
    if (!activePdf || viewMode !== 'single') return;
    const previousPageNumber = pageIndex;
    const nextPageNumber = pageIndex + 2;
    const warmPage = async (pageNumber: number) => {
      const page = await activePdf.getPage(pageNumber);
      await page.getOperatorList({ intent: 'display' });
    };
    if (previousPageNumber >= 1) warmPage(previousPageNumber).catch(() => undefined);
    if (nextPageNumber <= activePdf.numPages) warmPage(nextPageNumber).catch(() => undefined);
  }, [activePdf, pageIndex, viewMode]);

  useEffect(() => {
    destinationRequestTokenRef.current += 1;
  }, [active, activePdf, documentChecksum, documentId, retryKey, target]);

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
      if (!activePdf) return;
      const requestToken = destinationRequestTokenRef.current + 1;
      destinationRequestTokenRef.current = requestToken;
      const sourceIdentity = pdfIdentityRef.current;
      if (
        sourceIdentity?.pdf !== activePdf ||
        sourceIdentity.documentId !== documentId ||
        sourceIdentity.checksum !== documentChecksum
      ) {
        return;
      }
      const nextTarget = await resolveKnowledgePdfDestination(activePdf, destination);
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
    [activePdf, documentChecksum, documentId, onActivateResolvedLink, onDestinationChange],
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

  const cancelSettledScrollRelease = useCallback(() => {
    if (settledScrollTimerRef.current === null) return;
    window.clearTimeout(settledScrollTimerRef.current);
    settledScrollTimerRef.current = null;
  }, []);

  const releaseNavigationTarget = useCallback(
    (pageIndex: number) => {
      cancelSettledScrollRelease();
      if (!navigationTargetRef.current) return;
      focusPendingRequest(pageIndex);
      navigationTargetRef.current = null;
      issuedNavigationTargetRef.current = null;
      setNavigationTarget(null);
    },
    [cancelSettledScrollRelease, focusPendingRequest],
  );

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
      cancelSettledScrollRelease();
      focusPendingRequest(pageIndex);
      navigationTargetRef.current = null;
      issuedNavigationTargetRef.current = null;
      setNavigationTarget(null);
      return true;
    },
    [cancelSettledScrollRelease, focusPendingRequest],
  );

  useEffect(() => cancelSettledScrollRelease, [cancelSettledScrollRelease]);

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
      if (status.state !== 'ready') {
        // A page that failed to render never reports ready, so a target waiting on it would pin
        // the page indicator and section tracking to the previous page for the rest of the session.
        if (navigationTargetRef.current?.pageIndex === status.pageIndex) {
          releaseNavigationTarget(status.pageIndex);
        }
        return;
      }
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
    [consumeNavigationTarget, focusPendingRequest, releaseNavigationTarget],
  );

  const handleTargetNavigationComplete = useCallback(
    (completedTarget: KnowledgeViewerTarget) => {
      if (!viewerTargetsMatch(navigationTargetRef.current, completedTarget)) return;
      issuedNavigationTargetRef.current = completedTarget;
      if (readyPageIndicesRef.current.has(completedTarget.pageIndex)) {
        focusPendingRequest(completedTarget.pageIndex);
      }
      if (consumeNavigationTarget(completedTarget.pageIndex)) return;
      // The scroll has been issued. A target page that never becomes the dominant one — a short
      // final page, for instance — would otherwise hold page reporting forever.
      cancelSettledScrollRelease();
      settledScrollTimerRef.current = window.setTimeout(
        () => releaseNavigationTarget(completedTarget.pageIndex),
        SETTLED_SCROLL_MS,
      );
    },
    [
      cancelSettledScrollRelease,
      consumeNavigationTarget,
      focusPendingRequest,
      releaseNavigationTarget,
    ],
  );

  const handleContinuousPageChange = useCallback(
    (nextPageIndex: number) => {
      observedPageIndexRef.current = nextPageIndex;
      if (pendingSearchRequestRef.current) return;
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

  const handleActiveSearchHighlightReady = useCallback(
    (resultId: string, readyPageIndex: number, top: number) => {
      const pendingRequest = pendingSearchRequestRef.current;
      const identity = pdfIdentityRef.current;
      const activeDocument = activeDocumentRef.current;
      if (
        pendingRequest?.result.id !== resultId ||
        pendingRequest.pageIndex !== readyPageIndex ||
        identity?.generation !== pendingRequest.generation ||
        identity.documentId !== pendingRequest.documentId ||
        identity.checksum !== pendingRequest.checksum ||
        !activeDocument.active ||
        activeDocument.documentId !== pendingRequest.documentId ||
        activeDocument.checksum !== pendingRequest.checksum
      ) {
        return;
      }

      const viewport = viewerRef.current?.querySelector<HTMLDivElement>(
        '.knowledge-viewer__viewport',
      );
      const pageShell = viewerRef.current?.querySelector<HTMLElement>(
        `[data-page-index="${readyPageIndex}"]`,
      );
      const pageOffset = viewModeRef.current === 'continuous' ? (pageShell?.offsetTop ?? 0) : 0;
      viewport?.scrollTo({
        top: Math.max(0, pageOffset + top - 28),
        behavior: viewerScrollBehavior(),
      });
      observedPageIndexRef.current = readyPageIndex;
      pageIndexRef.current = readyPageIndex;
      setPageIndex(readyPageIndex);
      onPageChange(readyPageIndex);
      handledSearchRequestKeyRef.current = pendingRequest.key;
      pendingSearchRequestRef.current = null;
    },
    [onPageChange],
  );

  const pageTargetTop = navigationTarget?.pageIndex === pageIndex ? navigationTarget.top : null;

  const moveToPage = (nextPage: number) => {
    if (!activePdf) return;
    destinationRequestTokenRef.current += 1;
    pendingFocusRequestRef.current = undefined;
    const boundedPage = clampKnowledgePdfPageIndex(nextPage, activePdf.numPages);
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
    if (!activePdf) return;
    const page = await activePdf.getPage(pageIndex + 1);
    const naturalViewport = page.getViewport({ scale: 1 });
    const activeViewport = viewerRef.current?.querySelector<HTMLDivElement>(
      '.knowledge-viewer__viewport',
    );
    const availableWidth = Math.max(320, (activeViewport?.clientWidth ?? 720) - 48);
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, availableWidth / naturalViewport.width)));
  };

  const selectViewMode = (nextMode: 'continuous' | 'single') => {
    if (nextMode === viewMode) {
      closeViewOptions(true);
      return;
    }
    persistKnowledgePdfViewMode(nextMode);
    setViewMode(nextMode);
    closeViewOptions(true);
  };

  const handleFitWidth = () => {
    void fitWidth();
    closeViewOptions(true);
  };

  if (!knowledgeDocument) {
    return (
      <div className="knowledge-viewer-state">
        <span className="knowledge-viewer-state__eyebrow">Wiki reader</span>
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
        {toolbarLeading && <div className="knowledge-viewer__leading">{toolbarLeading}</div>}
        <div className="knowledge-viewer__heading">
          <div className="knowledge-viewer__identity">
            <span className="knowledge-viewer__eyebrow">{knowledgeDocument.category}</span>
            <h2>{knowledgeDocument.title}</h2>
            <span className="knowledge-viewer__section">
              {currentSection ? `Current section · ${currentSection}` : 'Document overview'}
            </span>
          </div>
        </div>
        <div className="knowledge-viewer__controls" aria-label="PDF controls">
          <div
            className="knowledge-viewer__control-group knowledge-viewer__page-controls"
            role="group"
            aria-label="Page navigation"
          >
            <button
              type="button"
              aria-label="Previous page"
              disabled={!activePdf || pageIndex === 0}
              onClick={() => moveToPage(pageIndex - 1)}
            >
              ←
            </button>
            <span className="knowledge-viewer__page-status" aria-live="polite" aria-atomic="true">
              <span className="knowledge-viewer__page-status-long" aria-hidden="true">
                {activePdf ? `Page ${pageIndex + 1} of ${activePdf.numPages}` : 'Loading document'}
              </span>
              <span className="knowledge-viewer__page-status-compact" aria-hidden="true">
                {activePdf ? `${pageIndex + 1} / ${activePdf.numPages}` : 'Loading…'}
              </span>
              <span className="sr-only">
                {activePdf
                  ? `Current page ${pageIndex + 1} of ${activePdf.numPages}`
                  : 'Loading current document'}
              </span>
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={!activePdf || pageIndex >= activePdf.numPages - 1}
              onClick={() => moveToPage(pageIndex + 1)}
            >
              →
            </button>
          </div>
          <div
            className="knowledge-viewer__control-group knowledge-viewer__zoom-controls"
            role="group"
            aria-label="Zoom controls"
          >
            <button
              type="button"
              aria-label="Zoom out"
              disabled={!activePdf || scale <= MIN_SCALE}
              onClick={() => setScale((current) => Math.max(MIN_SCALE, current - SCALE_STEP))}
            >
              −
            </button>
            <span className="knowledge-viewer__zoom">{Math.round(scale * 100)}%</span>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={!activePdf || scale >= MAX_SCALE}
              onClick={() => setScale((current) => Math.min(MAX_SCALE, current + SCALE_STEP))}
            >
              +
            </button>
          </div>
          <div ref={viewOptionsRef} className="knowledge-viewer__view-menu">
            <button
              ref={viewOptionsButtonRef}
              type="button"
              className="knowledge-viewer__view-trigger"
              aria-label={`View options: ${viewMode === 'continuous' ? 'Continuous' : 'Single page'}`}
              aria-haspopup="dialog"
              aria-expanded={viewOptionsOpen}
              aria-controls="knowledge-view-options"
              onClick={() => setViewOptionsOpen((current) => !current)}
            >
              <span>View</span>
              <span aria-hidden="true">▾</span>
            </button>
            {viewOptionsOpen && (
              <div
                id="knowledge-view-options"
                className="knowledge-viewer__view-panel"
                role="dialog"
                aria-label="View options"
                data-motion="popover"
              >
                <div className="knowledge-viewer__view-heading">View options</div>
                <button
                  type="button"
                  className="knowledge-viewer__view-option"
                  disabled={!activePdf}
                  onClick={handleFitWidth}
                >
                  <span>Fit width</span>
                </button>
                <span className="knowledge-viewer__view-label">Page flow</span>
                <button
                  type="button"
                  className="knowledge-viewer__view-option"
                  aria-pressed={viewMode === 'continuous'}
                  onClick={() => selectViewMode('continuous')}
                >
                  <span>Continuous scrolling</span>
                  <span aria-hidden="true">{viewMode === 'continuous' ? '✓' : ''}</span>
                </button>
                <button
                  type="button"
                  className="knowledge-viewer__view-option"
                  aria-pressed={viewMode === 'single'}
                  onClick={() => selectViewMode('single')}
                >
                  <span>Single page</span>
                  <span aria-hidden="true">{viewMode === 'single' ? '✓' : ''}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {!activePdf && (loading || error) && (
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
      {!error && activePdf && viewMode === 'continuous' && (
        <KnowledgeContinuousPdf
          ref={continuousPdfRef}
          pdf={activePdf}
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
          searchMatchesByPage={searchMatchesByPage}
          activeSearchResultId={activeSearchResultId}
          onActiveSearchHighlightReady={handleActiveSearchHighlightReady}
        />
      )}
      {!error && activePdf && viewMode === 'single' && (
        <div className="knowledge-viewer__viewport" ref={viewportRef} tabIndex={-1}>
          <KnowledgePdfPage
            pdf={activePdf}
            pageIndex={pageIndex}
            scale={scale}
            render
            targetTop={pageTargetTop}
            retryKey={retryKey}
            resolveUrl={resolveUrl}
            onActivateResolvedLink={onActivateResolvedLink}
            onActivateDestination={activateDestination}
            onStatus={handlePageStatus}
            searchMatches={searchMatchesByPage.get(pageIndex) ?? []}
            activeSearchResultId={activeSearchResultId}
            onActiveSearchHighlightReady={handleActiveSearchHighlightReady}
          />
        </div>
      )}
    </section>
  );
}
