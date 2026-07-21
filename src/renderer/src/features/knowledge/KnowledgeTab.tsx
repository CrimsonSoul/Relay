import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicRelayConfig } from '@shared/ipc';
import type {
  KnowledgeDocumentRecord,
  KnowledgeIndexStatus,
  KnowledgeOutlineNode,
} from '@shared/knowledge';
import { useToast } from '../../components/Toast';
import { TactileButton } from '../../components/TactileButton';
import { KnowledgeIcon } from '../../components/sidebar/SidebarIcons';
import { usePrivilegedAccess } from '../../contexts/PrivilegedAccessContext';
import { buildKnowledgeLibrary } from './knowledgeModel';
import { useKnowledgeLibrary } from './useKnowledgeLibrary';
import { useKnowledgeSelectionReconciliation } from './useKnowledgeSelectionReconciliation';
import { KnowledgeReaderSidebarBody } from './KnowledgeReaderSidebarBody';
import { KnowledgePdfViewer, type KnowledgePdfSession } from './KnowledgePdfViewer';
import { useKnowledgeDocumentSearch } from './useKnowledgeDocumentSearch';
import { KnowledgeManagementWorkspace } from './KnowledgeManagementWorkspace';
import { KnowledgeLibrary } from './KnowledgeLibrary';
import type { KnowledgeViewerTarget } from './knowledgePdfDestination';
import { resolveKnowledgeLink, type KnowledgeResolvedLink } from './knowledgeLinkResolver';
import {
  acknowledgeKnowledgeDocumentOpen,
  getPendingKnowledgeDocumentOpen,
  type KnowledgeOpenRequest,
  OPEN_KNOWLEDGE_DOCUMENT_EVENT,
} from './knowledgeNavigation';

type Props = {
  active: boolean;
  relayMode?: PublicRelayConfig['mode'];
  onLibraryCountChange?: (count: number | null) => void;
};

type PendingPassageOpen = {
  key: number;
  documentId: string;
  expectedChecksum: string;
  expectedSessionGeneration: number | null;
  expectedSessionPdf: KnowledgePdfSession['pdf'] | null;
  pageIndex: number;
  highlightText: string;
  normalizedStart: number;
  normalizedEnd: number;
};

function freshnessLabel(indexedAt: string | null | undefined): string {
  if (!indexedAt) return 'Waiting for first index';
  const timestamp = Date.parse(indexedAt);
  if (!Number.isFinite(timestamp)) return 'Library index available';
  return `Indexed ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)}`;
}

function indexLabel(
  status: KnowledgeIndexStatus | null,
  latestDocumentIndex: string | undefined,
): string {
  if (status?.state === 'indexing') return 'Refreshing library…';
  if (status?.message && (status.state === 'warning' || status.state === 'error')) {
    return status.message;
  }
  return freshnessLabel(status?.lastIndexedAt ?? latestDocumentIndex);
}

function headingForTarget(
  document: KnowledgeDocumentRecord,
  target: KnowledgeViewerTarget,
): KnowledgeOutlineNode | undefined {
  const exact = document.outline.find(
    (node) =>
      node.pageIndex === target.pageIndex &&
      (target.top === null || node.top === null || Math.abs(node.top - target.top) <= 2),
  );
  return exact;
}

function unavailableLinkMessage(reason: 'not-found' | 'ambiguous' | 'unsupported'): string {
  switch (reason) {
    case 'not-found':
      return 'Linked guide not found.';
    case 'ambiguous':
      return 'Multiple guides use this filename. Ask the document owner to qualify the category.';
    default:
      return 'Relay blocked an unsupported document link.';
  }
}

function emptyLibraryDescription(isServer: boolean, canManage: boolean): string {
  if (!isServer) {
    return 'The Relay server has not shared any Wiki documents yet. They will appear here automatically when available.';
  }
  if (canManage) {
    return 'Use the protected management workspace to stage and publish PDF guides for your Relay team.';
  }
  return 'A designated Wiki publisher can add PDF guides from their signed-in Relay workstation.';
}

function initialKnowledgeView(categories: unknown): 'catalog' | 'reader' {
  return Array.isArray(categories) ? 'catalog' : 'reader';
}

function initialKnowledgeDocumentId(
  categories: unknown,
  documents: KnowledgeDocumentRecord[],
): string | null {
  if (Array.isArray(categories)) return null;
  return buildKnowledgeLibrary(documents)[0]?.documents[0]?.id ?? null;
}

function showsKnowledgeCatalog(
  view: 'catalog' | 'reader',
  selectedDocument: KnowledgeDocumentRecord | null,
): boolean {
  return view === 'catalog' || !selectedDocument;
}

function clampKnowledgePageIndex(pageIndex: number | undefined, pageCount: number): number | null {
  if (pageIndex === undefined || !Number.isSafeInteger(pageIndex)) return null;
  return Math.min(Math.max(pageIndex, 0), Math.max(pageCount - 1, 0));
}

function KnowledgeEmptyState({
  relayMode,
  canManage,
  indexStatus,
  error,
  onManage,
}: Readonly<{
  relayMode: PublicRelayConfig['mode'] | undefined;
  canManage: boolean;
  indexStatus: KnowledgeIndexStatus | null;
  error: string | null;
  onManage: () => void;
}>) {
  const statusMessage =
    indexStatus?.state === 'warning' || indexStatus?.state === 'error' ? indexStatus.message : null;
  return (
    <div className="knowledge-tab knowledge-tab--empty">
      <div className="knowledge-empty">
        <div className="knowledge-empty__glyph" aria-hidden="true">
          W
        </div>
        <span className="knowledge-empty__eyebrow">Read-only reference library</span>
        <h1>No Wiki documents yet</h1>
        <p>{emptyLibraryDescription(relayMode === 'server', canManage)}</p>
        {statusMessage && (
          <span className="knowledge-empty__error" role="status">
            {statusMessage}
          </span>
        )}
        {error && <span className="knowledge-empty__error">{error}</span>}
        {canManage && (
          <TactileButton variant="primary" onClick={onManage}>
            Manage Wiki
          </TactileButton>
        )}
      </div>
    </div>
  );
}

export function KnowledgeTab({ active, relayMode, onLibraryCountChange }: Readonly<Props>) {
  const libraryData = useKnowledgeLibrary({ enabled: active, retainSnapshotWhenDisabled: true });
  const { documents, loading, error, hasLoadedSnapshot, refetch } = libraryData;
  const categories = libraryData.categories ?? [];
  const { session } = usePrivilegedAccess();
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(() =>
    initialKnowledgeDocumentId(libraryData.categories, documents),
  );
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [target, setTarget] = useState<KnowledgeViewerTarget | null>(null);
  const [focusRequestKey, setFocusRequestKey] = useState(0);
  const [indexStatus, setIndexStatus] = useState<KnowledgeIndexStatus | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false);
  const [desktopLibraryCollapsed, setDesktopLibraryCollapsed] = useState(false);
  const [sidebarMode, setSidebarMode] = useState<'contents' | 'library'>('contents');
  const [pdfSession, setPdfSession] = useState<KnowledgePdfSession | null>(null);
  const [readerPageIndex, setReaderPageIndex] = useState(0);
  const [pendingPassageOpen, setPendingPassageOpen] = useState<PendingPassageOpen | null>(null);
  const [view, setView] = useState<'catalog' | 'reader'>(() =>
    initialKnowledgeView(libraryData.categories),
  );
  const compactLibraryToggleRef = useRef<HTMLButtonElement>(null);
  const desktopLibraryRestoreRef = useRef<HTMLButtonElement>(null);
  const contentsTabRef = useRef<HTMLButtonElement>(null);
  const libraryTabRef = useRef<HTMLButtonElement>(null);
  const contentsSearchRef = useRef<HTMLInputElement>(null);
  const librarySearchRef = useRef<HTMLInputElement>(null);
  const drawerInitialFocusRef = useRef<'tab' | 'search'>('tab');
  const passageOpenKeyRef = useRef(0);
  const documentsRef = useRef(documents);
  const selectedDocumentIdRef = useRef(selectedDocumentId);
  documentsRef.current = documents;
  selectedDocumentIdRef.current = selectedDocumentId;
  const library = useMemo(() => buildKnowledgeLibrary(documents, query), [documents, query]);
  const handleConfirmedAbsent = useCallback(() => {
    setSelectedDocumentId(null);
    setActiveHeadingId(null);
    setTarget(null);
    setView('catalog');
  }, []);
  const { selectedDocument } = useKnowledgeSelectionReconciliation({
    selectedDocumentId,
    documents,
    loading,
    error,
    hasLoadedSnapshot,
    refetch,
    onConfirmedAbsent: handleConfirmedAbsent,
  });
  const documentSearch = useKnowledgeDocumentSearch(
    pdfSession,
    selectedDocument?.outline ?? [],
    readerPageIndex,
  );
  const activateExternalSearchTarget = documentSearch.activateExternalTarget;
  const cancelExternalSearchActivation = documentSearch.cancelExternalActivation;
  const activeHeading = selectedDocument?.outline.find((node) => node.id === activeHeadingId);
  const canManage = session.state === 'active' && session.capabilities.includes('knowledge.manage');
  const cancelPendingPassageOpen = useCallback(() => {
    cancelExternalSearchActivation();
    passageOpenKeyRef.current += 1;
    setPendingPassageOpen(null);
  }, [cancelExternalSearchActivation]);

  const queuePassageOpen = useCallback(
    (
      request: KnowledgeOpenRequest,
      document: KnowledgeDocumentRecord,
      pageIndex: number | null,
    ) => {
      if (
        pageIndex === null ||
        !request.highlightText ||
        request.normalizedStart === undefined ||
        request.normalizedEnd === undefined ||
        !Number.isSafeInteger(request.normalizedStart) ||
        !Number.isSafeInteger(request.normalizedEnd) ||
        request.normalizedStart < 0 ||
        request.normalizedEnd <= request.normalizedStart
      ) {
        cancelPendingPassageOpen();
        return;
      }
      const readySession =
        pdfSession?.documentId === document.id && pdfSession.checksum === document.checksum
          ? pdfSession
          : null;
      passageOpenKeyRef.current += 1;
      setPendingPassageOpen({
        key: passageOpenKeyRef.current,
        documentId: document.id,
        expectedChecksum: document.checksum,
        expectedSessionGeneration: readySession?.generation ?? null,
        expectedSessionPdf: readySession?.pdf ?? null,
        pageIndex,
        highlightText: request.highlightText,
        normalizedStart: request.normalizedStart,
        normalizedEnd: request.normalizedEnd,
      });
    },
    [cancelPendingPassageOpen, pdfSession],
  );

  useEffect(() => {
    setPendingPassageOpen((current) => {
      if (!current) return null;
      const currentDocument = documents.find((document) => document.id === current.documentId);
      return currentDocument?.checksum === current.expectedChecksum &&
        selectedDocumentId === current.documentId
        ? current
        : null;
    });
  }, [documents, selectedDocumentId]);

  useEffect(
    () => () => {
      passageOpenKeyRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (documentSearch.query) cancelPendingPassageOpen();
  }, [cancelPendingPassageOpen, documentSearch.query]);

  useEffect(() => {
    const pending = pendingPassageOpen;
    if (
      !pending ||
      pdfSession?.documentId !== pending.documentId ||
      pdfSession.checksum !== pending.expectedChecksum ||
      selectedDocument?.id !== pending.documentId ||
      selectedDocument.checksum !== pending.expectedChecksum
    ) {
      return;
    }
    if (pending.expectedSessionGeneration === null || pending.expectedSessionPdf === null) {
      setPendingPassageOpen((current) =>
        current?.key === pending.key
          ? {
              ...current,
              expectedSessionGeneration: pdfSession.generation,
              expectedSessionPdf: pdfSession.pdf,
            }
          : current,
      );
      return;
    }
    if (
      pdfSession.generation !== pending.expectedSessionGeneration ||
      pdfSession.pdf !== pending.expectedSessionPdf
    ) {
      cancelPendingPassageOpen();
      return;
    }
    let activeRequest = true;
    void activateExternalSearchTarget({
      pageIndex: pending.pageIndex,
      highlightText: pending.highlightText,
      normalizedStart: pending.normalizedStart,
      normalizedEnd: pending.normalizedEnd,
    }).then((resolved) => {
      if (!activeRequest || passageOpenKeyRef.current !== pending.key) return;
      setPendingPassageOpen((current) => (current?.key === pending.key ? null : current));
      if (resolved) return;
      setTarget({ pageIndex: pending.pageIndex, top: null });
      setReaderPageIndex(pending.pageIndex);
      showToast('Match text was not selectable on this page.', 'info');
    });
    return () => {
      activeRequest = false;
    };
  }, [
    activateExternalSearchTarget,
    cancelPendingPassageOpen,
    pdfSession,
    pendingPassageOpen,
    selectedDocument?.checksum,
    selectedDocument?.id,
    showToast,
  ]);

  const closeLibraryDrawer = useCallback((restoreFocus = false) => {
    setLibraryDrawerOpen(false);
    if (restoreFocus) {
      globalThis.requestAnimationFrame(() => compactLibraryToggleRef.current?.focus());
    }
  }, []);

  const collapseDesktopLibrary = useCallback(() => {
    setDesktopLibraryCollapsed(true);
    globalThis.requestAnimationFrame(() => desktopLibraryRestoreRef.current?.focus());
  }, []);

  const showDesktopLibrary = useCallback(() => {
    setDesktopLibraryCollapsed(false);
    globalThis.requestAnimationFrame(() => {
      (sidebarMode === 'contents' ? contentsTabRef : libraryTabRef).current?.focus();
    });
  }, [sidebarMode]);

  const openContentsSearch = useCallback(() => {
    drawerInitialFocusRef.current = 'search';
    setSidebarMode('contents');
    setDesktopLibraryCollapsed(false);
    setLibraryDrawerOpen(true);
    if (libraryDrawerOpen) {
      globalThis.requestAnimationFrame(() => contentsSearchRef.current?.focus());
    }
  }, [libraryDrawerOpen]);

  useEffect(() => {
    if (!libraryDrawerOpen) return;
    const frame = globalThis.requestAnimationFrame(() => {
      if (drawerInitialFocusRef.current === 'search') {
        contentsSearchRef.current?.focus();
      } else {
        (sidebarMode === 'contents' ? contentsTabRef : libraryTabRef).current?.focus();
      }
      drawerInitialFocusRef.current = 'tab';
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeLibraryDrawer(true);
    };
    globalThis.addEventListener('keydown', handleKeyDown);
    return () => {
      globalThis.cancelAnimationFrame(frame);
      globalThis.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeLibraryDrawer, libraryDrawerOpen, sidebarMode]);

  useEffect(() => {
    if (!active || view !== 'reader' || managementOpen) return;
    const handleFind = (event: KeyboardEvent) => {
      if (event.key.toLocaleLowerCase('en-US') !== 'f' || (!event.metaKey && !event.ctrlKey)) {
        return;
      }
      event.preventDefault();
      openContentsSearch();
    };
    globalThis.addEventListener('keydown', handleFind);
    return () => globalThis.removeEventListener('keydown', handleFind);
  }, [active, managementOpen, openContentsSearch, view]);

  useEffect(() => {
    onLibraryCountChange?.(hasLoadedSnapshot && !error ? documents.length : null);
  }, [documents.length, error, hasLoadedSnapshot, onLibraryCountChange]);

  useEffect(() => {
    let disposed = false;
    if (globalThis.api?.getKnowledgeIndexStatus) {
      void globalThis.api
        .getKnowledgeIndexStatus()
        .then((status) => {
          if (!disposed) setIndexStatus(status);
        })
        .catch(() => {
          // Realtime metadata remains usable when the optional status read is unavailable.
        });
    }
    const unsubscribe = globalThis.api?.onKnowledgeIndexStatusChanged?.((status) => {
      if (!disposed) setIndexStatus(status);
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    const openDocument = (request: KnowledgeOpenRequest): boolean => {
      const { documentId, headingId, pageIndex } = request;
      const document = documents.find((candidate) => candidate.id === documentId);
      if (!document) return false;
      const heading = headingId
        ? document.outline.find((candidate) => candidate.id === headingId)
        : undefined;
      const safePageIndex = clampKnowledgePageIndex(pageIndex, document.pageCount);
      const pageTarget = safePageIndex === null ? null : { pageIndex: safePageIndex, top: null };
      setQuery('');
      setSelectedDocumentId(documentId);
      setActiveHeadingId(heading?.id ?? null);
      setTarget(pageTarget ?? (heading ? { ...heading } : null));
      setReaderPageIndex(pageTarget?.pageIndex ?? heading?.pageIndex ?? 0);
      queuePassageOpen(request, document, safePageIndex);
      setView('reader');
      setSidebarMode('contents');
      setLibraryDrawerOpen(false);
      acknowledgeKnowledgeDocumentOpen(documentId);
      return true;
    };
    const handleOpenRequest = (event: Event) => {
      const detail = (event as CustomEvent<Partial<KnowledgeOpenRequest>>).detail;
      if (typeof detail?.documentId === 'string') {
        openDocument({
          documentId: detail.documentId,
          headingId: typeof detail.headingId === 'string' ? detail.headingId : undefined,
          pageIndex: typeof detail.pageIndex === 'number' ? detail.pageIndex : undefined,
          highlightText:
            typeof detail.highlightText === 'string' ? detail.highlightText : undefined,
          normalizedStart:
            typeof detail.normalizedStart === 'number' ? detail.normalizedStart : undefined,
          normalizedEnd:
            typeof detail.normalizedEnd === 'number' ? detail.normalizedEnd : undefined,
        });
      }
    };
    globalThis.addEventListener(OPEN_KNOWLEDGE_DOCUMENT_EVENT, handleOpenRequest);
    const pendingRequest = getPendingKnowledgeDocumentOpen();
    if (pendingRequest) openDocument(pendingRequest);
    return () => globalThis.removeEventListener(OPEN_KNOWLEDGE_DOCUMENT_EVENT, handleOpenRequest);
  }, [documents, queuePassageOpen]);

  const handleSelectHeading = (heading: KnowledgeOutlineNode) => {
    cancelPendingPassageOpen();
    setActiveHeadingId(heading.id);
    setTarget({ ...heading, top: null });
    setLibraryDrawerOpen(false);
  };

  const handlePageChange = useCallback(
    (pageIndex: number) => {
      if (pageIndex !== readerPageIndex) cancelPendingPassageOpen();
      setReaderPageIndex(pageIndex);
      if (!selectedDocument) return;
      const heading = selectedDocument.outline
        .filter((node) => node.pageIndex <= pageIndex)
        .sort((left, right) => left.pageIndex - right.pageIndex)
        .at(-1);
      setActiveHeadingId(heading?.id ?? null);
    },
    [cancelPendingPassageOpen, readerPageIndex, selectedDocument],
  );

  const resolveUrl = useCallback(
    (url: string): KnowledgeResolvedLink =>
      selectedDocument
        ? resolveKnowledgeLink({ rawUrl: url, currentDocument: selectedDocument, documents })
        : { kind: 'unavailable', reason: 'unsupported' },
    [documents, selectedDocument],
  );

  const handleActivateResolvedLink = useCallback(
    (link: KnowledgeResolvedLink) => {
      if (link.kind === 'unavailable') {
        showToast(unavailableLinkMessage(link.reason), 'error');
        return;
      }

      if (link.kind === 'web') {
        void (async () => {
          try {
            const result = await globalThis.api?.openKnowledgeWebLink(link.url);
            if (result?.ok) return;
          } catch {
            // The same approved message covers bridge and system-browser failures.
          }
          showToast('Relay could not open this website in the system browser.', 'error');
        })();
        return;
      }

      if (
        !selectedDocument ||
        selectedDocumentIdRef.current !== selectedDocument.id ||
        !documentsRef.current.some((document) => document.id === selectedDocument.id)
      ) {
        showToast('Linked guide not found.', 'error');
        return;
      }

      if (link.kind === 'same-document') {
        cancelPendingPassageOpen();
        const nextTarget = { pageIndex: link.pageIndex, top: null };
        const heading = headingForTarget(selectedDocument, nextTarget);
        setActiveHeadingId(heading?.id ?? null);
        setTarget(nextTarget);
        return;
      }

      const linkedDocument = documentsRef.current.find(
        (document) => document.id === link.documentId,
      );
      if (!linkedDocument) {
        showToast('Linked guide not found.', 'error');
        return;
      }
      const nextTarget = { pageIndex: link.pageIndex, top: null };
      const heading = headingForTarget(linkedDocument, nextTarget);
      setQuery('');
      cancelPendingPassageOpen();
      setSelectedDocumentId(linkedDocument.id);
      setActiveHeadingId(heading?.id ?? null);
      setTarget(nextTarget);
      setReaderPageIndex(nextTarget.pageIndex);
      setFocusRequestKey((current) => current + 1);
      setView('reader');
      setSidebarMode('contents');
    },
    [cancelPendingPassageOpen, selectedDocument, showToast],
  );

  const handleDestinationChange = useCallback(
    (nextTarget: KnowledgeViewerTarget) => {
      cancelPendingPassageOpen();
      const heading = selectedDocument ? headingForTarget(selectedDocument, nextTarget) : undefined;
      setActiveHeadingId(heading?.id ?? null);
      setTarget(nextTarget);
      setReaderPageIndex(nextTarget.pageIndex);
    },
    [cancelPendingPassageOpen, selectedDocument],
  );

  if (managementOpen && canManage) {
    return (
      <KnowledgeManagementWorkspace
        onExit={() => setManagementOpen(false)}
        onLibraryChanged={refetch}
      />
    );
  }

  if (loading && !hasLoadedSnapshot && !selectedDocument) {
    return (
      <div className="knowledge-tab knowledge-tab--loading" aria-busy="true">
        <div className="knowledge-skeleton knowledge-skeleton--title" />
        <div className="knowledge-skeleton-grid">
          <div className="knowledge-skeleton" />
          <div className="knowledge-skeleton" />
        </div>
      </div>
    );
  }

  if (documents.length === 0 && !selectedDocument) {
    return (
      <KnowledgeEmptyState
        relayMode={relayMode}
        canManage={canManage}
        indexStatus={indexStatus}
        error={error}
        onManage={() => setManagementOpen(true)}
      />
    );
  }

  if (showsKnowledgeCatalog(view, selectedDocument)) {
    return (
      <div className="knowledge-tab knowledge-tab--catalog" data-motion="panel">
        <KnowledgeLibrary
          documents={documents}
          categories={categories}
          canManage={canManage}
          onManage={() => setManagementOpen(true)}
          onOpenDocument={(request) => {
            const document = documents.find((candidate) => candidate.id === request.documentId);
            if (!document) return;
            const heading = request.headingId
              ? document.outline.find((candidate) => candidate.id === request.headingId)
              : undefined;
            const pageIndex = clampKnowledgePageIndex(request.pageIndex, document.pageCount);
            let nextTarget: KnowledgeViewerTarget | null = null;
            if (pageIndex !== null) nextTarget = { pageIndex, top: null };
            else if (heading) nextTarget = { ...heading };
            setSelectedDocumentId(request.documentId);
            setActiveHeadingId(heading?.id ?? null);
            setTarget(nextTarget);
            setReaderPageIndex(pageIndex ?? heading?.pageIndex ?? 0);
            queuePassageOpen(request, document, pageIndex);
            setSidebarMode('contents');
            setView('reader');
          }}
        />
      </div>
    );
  }

  const categoryCount = new Set(documents.map((document) => document.category)).size;
  const shownCount = library.reduce((count, group) => count + group.documents.length, 0);
  const hasQuery = query.trim().length > 0;
  const shownCategoryCount = hasQuery ? library.length : categoryCount;
  const latestDocumentIndex = documents
    .map((document) => document.indexedAt)
    .sort((left, right) => right.localeCompare(left))[0];
  const currentIndexLabel = indexLabel(indexStatus, latestDocumentIndex);

  return (
    <div className="knowledge-tab">
      <div
        className="knowledge-workspace"
        role="region"
        aria-label="Wiki reader workspace"
        data-library-drawer={libraryDrawerOpen ? 'open' : 'closed'}
        data-library-collapsed={String(desktopLibraryCollapsed)}
      >
        <button
          type="button"
          className="knowledge-drawer-backdrop"
          aria-label="Close Wiki reader sidebar backdrop"
          tabIndex={-1}
          onClick={() => closeLibraryDrawer()}
        />
        <aside
          id="knowledge-library-drawer"
          className="knowledge-drawer"
          aria-label="Wiki reader sidebar"
        >
          <div className="knowledge-drawer__heading">
            <div className="knowledge-drawer__title">
              <span>{selectedDocument.category}</span>
              <h1>{selectedDocument.displayTitle}</h1>
            </div>
            <div className="knowledge-drawer__actions">
              {canManage && (
                <TactileButton
                  className="knowledge-drawer__manage"
                  size="sm"
                  variant="secondary"
                  aria-label="Manage Wiki"
                  onClick={() => {
                    cancelPendingPassageOpen();
                    setLibraryDrawerOpen(false);
                    setManagementOpen(true);
                  }}
                >
                  Manage
                </TactileButton>
              )}
              <button
                type="button"
                className="knowledge-drawer__collapse"
                aria-label="Collapse Wiki reader sidebar"
                onClick={collapseDesktopLibrary}
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
                  <rect x="3" y="4" width="18" height="16" rx="1" />
                  <path d="M9 4v16" />
                  <path d="m15 9-3 3 3 3" />
                </svg>
              </button>
              <button
                type="button"
                className="knowledge-drawer__close"
                aria-label="Close Wiki reader sidebar"
                onClick={() => closeLibraryDrawer(true)}
              >
                ×
              </button>
            </div>
          </div>
          <KnowledgeReaderSidebarBody
            mode={sidebarMode}
            contentsTabRef={contentsTabRef}
            libraryTabRef={libraryTabRef}
            contentsSearchRef={contentsSearchRef}
            librarySearchRef={librarySearchRef}
            contentsSearch={documentSearch}
            libraryQuery={query}
            groups={library}
            documents={documents}
            selectedDocument={selectedDocument}
            activeHeadingId={activeHeadingId}
            shownCount={shownCount}
            shownCategoryCount={shownCategoryCount}
            indexState={indexStatus?.state ?? 'idle'}
            indexLabel={currentIndexLabel}
            onModeChange={(mode) => {
              cancelPendingPassageOpen();
              setSidebarMode(mode);
            }}
            onLibraryQueryChange={setQuery}
            onContentsEscape={() => {
              if (libraryDrawerOpen) closeLibraryDrawer(true);
            }}
            onSelectDocument={(document) => {
              cancelPendingPassageOpen();
              setSelectedDocumentId(document.id);
              setReaderPageIndex(0);
              setView('reader');
              setActiveHeadingId(null);
              setTarget(null);
              setSidebarMode('contents');
              setLibraryDrawerOpen(false);
            }}
            onSelectHeading={handleSelectHeading}
          />
        </aside>

        <KnowledgePdfViewer
          document={selectedDocument}
          active={active}
          target={target}
          currentSection={activeHeading?.label ?? (target ? 'Document section' : null)}
          focusRequestKey={focusRequestKey}
          toolbarLeading={
            <>
              <button
                type="button"
                className="knowledge-reader-back"
                aria-label="Back to Wiki"
                onClick={() => {
                  cancelPendingPassageOpen();
                  setView('catalog');
                  setSidebarMode('contents');
                  setLibraryDrawerOpen(false);
                }}
              >
                <span aria-hidden="true">←</span>
                <span className="knowledge-reader-back__label">Back</span>
              </button>
              <button
                ref={desktopLibraryRestoreRef}
                type="button"
                className="knowledge-library-toggle knowledge-library-toggle--desktop"
                aria-label="Show Wiki reader sidebar"
                aria-controls="knowledge-library-drawer"
                aria-expanded="false"
                onClick={showDesktopLibrary}
              >
                <KnowledgeIcon />
                <span>{sidebarMode === 'contents' ? 'Contents' : 'Library'}</span>
              </button>
              <button
                ref={compactLibraryToggleRef}
                type="button"
                className="knowledge-library-toggle knowledge-library-toggle--compact"
                aria-label="Wiki reader sidebar"
                aria-controls="knowledge-library-drawer"
                aria-expanded={libraryDrawerOpen}
                onClick={() => {
                  drawerInitialFocusRef.current = 'tab';
                  setLibraryDrawerOpen(true);
                }}
              >
                <KnowledgeIcon />
                <span>{sidebarMode === 'contents' ? 'Contents' : 'Library'}</span>
              </button>
            </>
          }
          resolveUrl={resolveUrl}
          onActivateResolvedLink={handleActivateResolvedLink}
          onDestinationChange={handleDestinationChange}
          onPageChange={handlePageChange}
          onPdfSessionChange={setPdfSession}
          searchNavigationRequest={documentSearch.navigationRequest}
          searchMatches={documentSearch.highlightMatches}
        />
      </div>
    </div>
  );
}
