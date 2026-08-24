import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
import { useKnowledgePdfSession, type KnowledgePdfSession } from './useKnowledgePdfSession';
import {
  createKnowledgePdfNavigationState,
  knowledgePdfNavigationReducer,
} from './knowledgePdfNavigationState';
import { KnowledgePdfToolbar } from './KnowledgePdfToolbar';

export type { KnowledgePdfSession } from './useKnowledgePdfSession';

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
  const [navigationState, dispatchNavigation] = useReducer(
    knowledgePdfNavigationReducer,
    initialNavigationTarget,
    createKnowledgePdfNavigationState,
  );
  const { pageIndex, navigationTarget, singleTopRequest } = navigationState;
  const [scale, setScale] = useState(1);
  const [viewMode, setViewMode] = useState(loadKnowledgePdfViewMode);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLElement>(null);
  const continuousPdfRef = useRef<KnowledgeContinuousPdfHandle>(null);
  const pageIndexRef = useRef(0);
  const observedPageIndexRef = useRef(0);
  const navigationTargetRef = useRef<KnowledgeViewerTarget | null>(initialNavigationTarget);
  const issuedNavigationTargetRef = useRef<KnowledgeViewerTarget | null>(null);
  const readyPageIndicesRef = useRef(new Set<number>());
  const settledScrollTimerRef = useRef<number | null>(null);
  const destinationRequestTokenRef = useRef(0);
  const focusRequestRef = useRef({ initialized: false, value: focusRequestKey });
  const pendingFocusRequestRef = useRef<PendingFocusRequest | undefined>(undefined);
  const pendingSearchRequestRef = useRef<PendingSearchRequest | null>(null);
  const handledSearchRequestKeyRef = useRef<number | null>(null);
  const targetRequestKey = `${documentId ?? ''}:${focusRequestKey ?? ''}:${targetPageIndex ?? ''}:${targetTop ?? ''}`;
  const previousTargetRef = useRef(target);
  const previousTargetRequestKeyRef = useRef(targetRequestKey);
  const previousViewModeRef = useRef(viewMode);
  const viewModeRef = useRef(viewMode);
  const activeDocumentRef = useRef({ active, documentId, checksum: documentChecksum });

  const resetForPdfLoad = useCallback(({ preserveViewState }: { preserveViewState: boolean }) => {
    pendingSearchRequestRef.current = null;
    handledSearchRequestKeyRef.current = null;
    readyPageIndicesRef.current.clear();
    if (!preserveViewState) {
      setScale(1);
      pageIndexRef.current = 0;
      observedPageIndexRef.current = 0;
    } else {
      observedPageIndexRef.current = pageIndexRef.current;
    }
    dispatchNavigation({ type: 'document-reset', preservePage: preserveViewState });
    navigationTargetRef.current = null;
    issuedNavigationTargetRef.current = null;
    previousTargetRequestKeyRef.current = '';
    pendingFocusRequestRef.current = undefined;
  }, []);

  const publishPdfSession = useCallback(
    (nextSession: KnowledgePdfSession | null) => {
      if (!nextSession) pendingSearchRequestRef.current = null;
      onPdfSessionChange?.(nextSession);
    },
    [onPdfSessionChange],
  );

  const {
    session: pdfSession,
    sessionRef: pdfIdentityRef,
    loading,
    error,
    retryKey,
    retry,
  } = useKnowledgePdfSession({
    active,
    documentId,
    checksum: documentChecksum,
    onSessionChange: publishPdfSession,
    onLoadStart: resetForPdfLoad,
  });
  const pdf = pdfSession?.pdf ?? null;
  const activePdfIdentity = pdfIdentityRef.current;
  const activePdf =
    active &&
    pdf &&
    activePdfIdentity?.pdf === pdf &&
    activePdfIdentity.documentId === documentId &&
    activePdfIdentity.checksum === documentChecksum
      ? pdf
      : null;
  const normalizedTargetPageIndex =
    targetPageIndex === undefined
      ? undefined
      : clampKnowledgePdfPageIndex(
          targetPageIndex,
          activePdf?.numPages ?? knowledgeDocument?.pageCount ?? 0,
        );
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
    dispatchNavigation({ type: 'page', pageIndex });
    if (viewModeRef.current === 'continuous') {
      continuousPdfRef.current?.scrollToPage(pageIndex);
    }
  }, [activePdf, documentChecksum, documentId, pdfIdentityRef, searchNavigationRequest, viewMode]);

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
    dispatchNavigation({ type: 'target', target: nextTarget });
    const activePdfIdentity = pdfIdentityRef.current;
    // `documentId`/`documentChecksum` are undefined while no document is selected, so the
    // identity comparisons must not be reached through optional chaining: `undefined ===
    // undefined` would report a match against a session that does not exist.
    const canApplySingleTarget =
      isNewTargetRequest &&
      nextTarget &&
      viewModeRef.current === 'single' &&
      activeDocumentRef.current.active &&
      activePdfIdentity !== null &&
      activePdfIdentity.documentId === documentId &&
      activePdfIdentity.checksum === documentChecksum;
    if (canApplySingleTarget) {
      if (pageIndexRef.current !== nextTarget.pageIndex) {
        pageIndexRef.current = nextTarget.pageIndex;
        dispatchNavigation({ type: 'page', pageIndex: nextTarget.pageIndex });
      } else {
        // The page is already mounted, so it will not report ready again. Hand the target to the
        // single-page settle effect — for an offset destination KnowledgePdfPage performs the
        // scroll itself — so the target is still released and the pending focus request runs.
        dispatchNavigation({
          type: 'single-top',
          request: {
            documentId: activePdfIdentity.documentId,
            checksum: activePdfIdentity.checksum,
            target: nextTarget,
          },
        });
      }
    }
  }, [
    documentChecksum,
    documentId,
    normalizedTargetPageIndex,
    pdfIdentityRef,
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
    dispatchNavigation({ type: 'page', pageIndex: normalizedTargetPageIndex });
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
    if (!pendingRequest) return;
    if (
      pendingRequest.documentId !== documentId ||
      pendingRequest.targetRequestKey !== targetRequestKey ||
      normalizedTargetPageIndex === undefined
    ) {
      pendingFocusRequestRef.current = undefined;
      return;
    }
    if (
      pendingRequest.target.pageIndex !== normalizedTargetPageIndex ||
      pendingRequest.target.top !== (targetTop ?? null)
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
    [
      activePdf,
      documentChecksum,
      documentId,
      onActivateResolvedLink,
      onDestinationChange,
      pdfIdentityRef,
    ],
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
      dispatchNavigation({ type: 'target', target: null });
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
      dispatchNavigation({ type: 'target', target: null });
      return true;
    },
    [cancelSettledScrollRelease, focusPendingRequest],
  );

  useEffect(() => cancelSettledScrollRelease, [cancelSettledScrollRelease]);

  useEffect(() => {
    if (!singleTopRequest) return;
    dispatchNavigation({ type: 'consume-single-top', request: singleTopRequest });
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
    // An offset destination is scrolled by KnowledgePdfPage against the rendered viewport; only a
    // whole-page target resets the viewport here.
    if (singleTopRequest.target.top === null) viewportRef.current?.scrollTo({ top: 0 });
    observedPageIndexRef.current = singleTopRequest.target.pageIndex;
    issuedNavigationTargetRef.current = singleTopRequest.target;
    consumeNavigationTarget(singleTopRequest.target.pageIndex);
  }, [consumeNavigationTarget, pdfIdentityRef, singleTopRequest]);

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
      dispatchNavigation({ type: 'page', pageIndex: nextPageIndex });
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
      dispatchNavigation({ type: 'page', pageIndex: readyPageIndex });
      onPageChange(readyPageIndex);
      handledSearchRequestKeyRef.current = pendingRequest.key;
      pendingSearchRequestRef.current = null;
    },
    [onPageChange, pdfIdentityRef],
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
      dispatchNavigation({ type: 'target', target: null });
    }
    if (viewMode === 'continuous') {
      continuousPdfRef.current?.scrollToPage(boundedPage);
      return;
    }
    pageIndexRef.current = boundedPage;
    dispatchNavigation({ type: 'page', pageIndex: boundedPage });
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
    persistKnowledgePdfViewMode(nextMode);
    setViewMode(nextMode);
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
      <KnowledgePdfToolbar
        identityKey={documentId}
        category={knowledgeDocument.category}
        title={knowledgeDocument.title}
        currentSection={currentSection}
        toolbarLeading={toolbarLeading}
        pageIndex={pageIndex}
        pageCount={activePdf?.numPages ?? null}
        scale={scale}
        viewMode={viewMode}
        onPreviousPage={() => moveToPage(pageIndex - 1)}
        onNextPage={() => moveToPage(pageIndex + 1)}
        onZoomOut={() => setScale((current) => Math.max(MIN_SCALE, current - SCALE_STEP))}
        onZoomIn={() => setScale((current) => Math.min(MAX_SCALE, current + SCALE_STEP))}
        onFitWidth={() => void fitWidth()}
        onSelectViewMode={selectViewMode}
      />
      {!activePdf && (loading || error) && (
        <div className="knowledge-viewer__viewport" ref={viewportRef} tabIndex={-1}>
          {loading && <div className="knowledge-viewer__loading">Preparing document…</div>}
          {error && (
            <div className="knowledge-viewer-state knowledge-viewer-state--error" role="status">
              <span className="knowledge-viewer-state__eyebrow">Document unavailable</span>
              <h3>Unable to open this guide</h3>
              <p>{error.message}</p>
              <button type="button" onClick={retry}>
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
