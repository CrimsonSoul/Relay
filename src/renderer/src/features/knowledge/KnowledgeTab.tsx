import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicRelayConfig } from '@shared/ipc';
import type { KnowledgeDocumentRecord, KnowledgeIndexStatus } from '@shared/knowledge';
import { TactileButton } from '../../components/TactileButton';
import { KnowledgeIcon } from '../../components/sidebar/SidebarIcons';
import { usePrivilegedAccess } from '../../contexts/PrivilegedAccessContext';
import { buildKnowledgeLibrary } from './knowledgeModel';
import { useKnowledgeLibrary } from './useKnowledgeLibrary';
import { KnowledgeReaderSidebarBody } from './KnowledgeReaderSidebarBody';
import { KnowledgePdfViewer } from './KnowledgePdfViewer';
import { KnowledgeManagementWorkspace } from './KnowledgeManagementWorkspace';
import { KnowledgeLibrary } from './KnowledgeLibrary';
import { useKnowledgeReaderNavigation } from './useKnowledgeReaderNavigation';

type Props = {
  active: boolean;
  relayMode?: PublicRelayConfig['mode'];
  onLibraryCountChange?: (count: number | null) => void;
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

function emptyLibraryDescription(isServer: boolean, canManage: boolean): string {
  if (!isServer) {
    return 'The Relay server has not shared any Wiki documents yet. They will appear here automatically when available.';
  }
  if (canManage) {
    return 'Use the protected management workspace to stage and publish PDF guides for your Relay team.';
  }
  return 'A designated Wiki publisher can add PDF guides from their signed-in Relay workstation.';
}

function showsKnowledgeCatalog(
  view: 'catalog' | 'reader',
  selectedDocument: KnowledgeDocumentRecord | null,
): boolean {
  return view === 'catalog' || !selectedDocument;
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
  const { documents, categories, loading, error, hasLoadedSnapshot, refetch } = libraryData;
  const { session } = usePrivilegedAccess();
  const [query, setQuery] = useState('');
  const [indexStatus, setIndexStatus] = useState<KnowledgeIndexStatus | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const [libraryDrawerOpen, setLibraryDrawerOpen] = useState(false);
  const [desktopLibraryCollapsed, setDesktopLibraryCollapsed] = useState(false);
  const compactLibraryToggleRef = useRef<HTMLButtonElement>(null);
  const desktopLibraryRestoreRef = useRef<HTMLButtonElement>(null);
  const contentsTabRef = useRef<HTMLButtonElement>(null);
  const libraryTabRef = useRef<HTMLButtonElement>(null);
  const contentsSearchRef = useRef<HTMLInputElement>(null);
  const librarySearchRef = useRef<HTMLInputElement>(null);
  const drawerInitialFocusRef = useRef<'tab' | 'search'>('tab');
  const closeLibraryDrawer = useCallback((restoreFocus = false) => {
    setLibraryDrawerOpen(false);
    if (restoreFocus) {
      globalThis.requestAnimationFrame(() => compactLibraryToggleRef.current?.focus());
    }
  }, []);
  const clearLibraryQuery = useCallback(() => setQuery(''), []);
  const {
    view,
    selectedDocument,
    activeHeading,
    activeHeadingId,
    target,
    focusRequestKey,
    sidebarMode,
    setSidebarMode,
    documentSearch,
    cancelPendingPassageOpen,
    openCatalogDocument,
    selectDocument,
    selectSidebarMode,
    returnToCatalog,
    handleSelectHeading,
    handlePageChange,
    resolveUrl,
    handleActivateResolvedLink,
    handleDestinationChange,
    setPdfSession,
  } = useKnowledgeReaderNavigation({
    documents,
    loading,
    error,
    hasLoadedSnapshot,
    refetch,
    onClearLibraryQuery: clearLibraryQuery,
    onCloseLibraryDrawer: closeLibraryDrawer,
  });
  const library = useMemo(() => buildKnowledgeLibrary(documents, query), [documents, query]);
  const canManage = session.state === 'active' && session.capabilities.includes('knowledge.manage');

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
  }, [libraryDrawerOpen, setSidebarMode]);

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

  // The `!selectedDocument` arm is spelled out here as well as inside showsKnowledgeCatalog so the
  // reader below is known to have a document; the two conditions are equivalent by construction.
  if (!selectedDocument || showsKnowledgeCatalog(view, selectedDocument)) {
    return (
      <div className="knowledge-tab knowledge-tab--catalog" data-motion="panel">
        <KnowledgeLibrary
          documents={documents}
          categories={categories}
          canManage={canManage}
          onManage={() => setManagementOpen(true)}
          onOpenDocument={openCatalogDocument}
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
      <section
        className="knowledge-workspace"
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
            onModeChange={selectSidebarMode}
            onLibraryQueryChange={setQuery}
            onContentsEscape={() => {
              if (libraryDrawerOpen) closeLibraryDrawer(true);
            }}
            onSelectDocument={selectDocument}
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
                onClick={returnToCatalog}
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
      </section>
    </div>
  );
}
