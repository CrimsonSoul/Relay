import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicRelayConfig } from '@shared/ipc';
import type {
  KnowledgeDocumentRecord,
  KnowledgeIndexStatus,
  KnowledgeOutlineNode,
} from '@shared/knowledge';
import { useToast } from '../../components/Toast';
import { TactileButton } from '../../components/TactileButton';
import { usePrivilegedAccess } from '../../contexts/PrivilegedAccessContext';
import { buildKnowledgeLibrary } from './knowledgeModel';
import { useKnowledgeLibrary } from './useKnowledgeLibrary';
import { KnowledgeTree } from './KnowledgeTree';
import { KnowledgePdfViewer } from './KnowledgePdfViewer';
import { KnowledgeManagementWorkspace } from './KnowledgeManagementWorkspace';
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
  const { documents, loading, error, hasLoadedSnapshot, refetch } = useKnowledgeLibrary();
  const { session } = usePrivilegedAccess();
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [target, setTarget] = useState<KnowledgeViewerTarget | null>(null);
  const [focusRequestKey, setFocusRequestKey] = useState(0);
  const [indexStatus, setIndexStatus] = useState<KnowledgeIndexStatus | null>(null);
  const [removedDocumentTitle, setRemovedDocumentTitle] = useState<string | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const lastSelectedTitleRef = useRef<string | null>(null);
  const documentsRef = useRef(documents);
  const selectedDocumentIdRef = useRef(selectedDocumentId);
  documentsRef.current = documents;
  selectedDocumentIdRef.current = selectedDocumentId;
  const library = useMemo(() => buildKnowledgeLibrary(documents, query), [documents, query]);
  const selectedDocument = documents.find((document) => document.id === selectedDocumentId) ?? null;
  const activeHeading = selectedDocument?.outline.find((node) => node.id === activeHeadingId);
  const selectedExistsInLibrary = selectedDocumentId
    ? documents.some((document) => document.id === selectedDocumentId)
    : true;
  const canManage = session.state === 'active' && session.capabilities.includes('knowledge.manage');

  useEffect(() => {
    onLibraryCountChange?.(hasLoadedSnapshot && !error ? documents.length : null);
  }, [documents.length, error, hasLoadedSnapshot, onLibraryCountChange]);

  useEffect(() => {
    if (selectedDocument) lastSelectedTitleRef.current = selectedDocument.title;
  }, [selectedDocument]);

  useEffect(() => {
    if (selectedDocumentId && !selectedExistsInLibrary) {
      setRemovedDocumentTitle(lastSelectedTitleRef.current ?? 'The selected guide');
      setSelectedDocumentId(null);
      setActiveHeadingId(null);
      setTarget(null);
      return;
    }
    if (removedDocumentTitle || selectedDocument) return;
    const firstDocument = library[0]?.documents[0];
    if (!firstDocument) return;
    setSelectedDocumentId(firstDocument.id);
    setActiveHeadingId(null);
    setTarget(null);
  }, [
    library,
    removedDocumentTitle,
    selectedDocument,
    selectedDocumentId,
    selectedExistsInLibrary,
  ]);

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
    const openDocument = ({ documentId, headingId }: KnowledgeOpenRequest): boolean => {
      const document = documents.find((candidate) => candidate.id === documentId);
      if (!document) return false;
      const heading = headingId
        ? document.outline.find((candidate) => candidate.id === headingId)
        : undefined;
      setQuery('');
      setSelectedDocumentId(documentId);
      setRemovedDocumentTitle(null);
      setActiveHeadingId(heading?.id ?? null);
      setTarget(heading ? { ...heading } : null);
      acknowledgeKnowledgeDocumentOpen(documentId);
      return true;
    };
    const handleOpenRequest = (event: Event) => {
      const detail = (event as CustomEvent<Partial<KnowledgeOpenRequest>>).detail;
      if (typeof detail?.documentId === 'string') {
        openDocument({
          documentId: detail.documentId,
          headingId: typeof detail.headingId === 'string' ? detail.headingId : undefined,
        });
      }
    };
    globalThis.addEventListener(OPEN_KNOWLEDGE_DOCUMENT_EVENT, handleOpenRequest);
    const pendingRequest = getPendingKnowledgeDocumentOpen();
    if (pendingRequest) openDocument(pendingRequest);
    return () => globalThis.removeEventListener(OPEN_KNOWLEDGE_DOCUMENT_EVENT, handleOpenRequest);
  }, [documents]);

  const handleSelectHeading = (heading: KnowledgeOutlineNode) => {
    setActiveHeadingId(heading.id);
    setTarget({ ...heading });
  };

  const handlePageChange = useCallback(
    (pageIndex: number) => {
      if (!selectedDocument) return;
      const heading = selectedDocument.outline
        .filter((node) => node.pageIndex <= pageIndex)
        .sort((left, right) => left.pageIndex - right.pageIndex)
        .at(-1);
      setActiveHeadingId(heading?.id ?? null);
    },
    [selectedDocument],
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
      setSelectedDocumentId(linkedDocument.id);
      setActiveHeadingId(heading?.id ?? null);
      setTarget(nextTarget);
      setRemovedDocumentTitle(null);
      setFocusRequestKey((current) => current + 1);
    },
    [selectedDocument, showToast],
  );

  const handleDestinationChange = useCallback(
    (nextTarget: KnowledgeViewerTarget) => {
      const heading = selectedDocument ? headingForTarget(selectedDocument, nextTarget) : undefined;
      setActiveHeadingId(heading?.id ?? null);
      setTarget(nextTarget);
    },
    [selectedDocument],
  );

  if (managementOpen && canManage) {
    return (
      <KnowledgeManagementWorkspace
        onExit={() => setManagementOpen(false)}
        onLibraryChanged={refetch}
      />
    );
  }

  if (loading && !hasLoadedSnapshot) {
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

  if (documents.length === 0) {
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
      <header className="knowledge-tab__header">
        <div>
          <span className="knowledge-tab__kicker">Operations reference</span>
          <h1>Wiki</h1>
          <p>Find the guide, jump to the procedure, and stay in the flow.</p>
        </div>
        <div className="knowledge-tab__header-actions">
          <div className="knowledge-tab__mode" aria-label="Library permissions">
            <span className="knowledge-tab__mode-dot" aria-hidden="true" />
            Read only
          </div>
          {canManage && (
            <TactileButton size="sm" variant="primary" onClick={() => setManagementOpen(true)}>
              Manage Wiki
            </TactileButton>
          )}
        </div>
      </header>

      <div className="knowledge-workspace">
        <aside className="knowledge-drawer" aria-label="Wiki library">
          <div className="knowledge-drawer__heading">
            <div>
              <span>Library</span>
              <strong>{documents.length}</strong>
            </div>
            <span>{categoryCount} categories</span>
          </div>
          <label className="knowledge-search">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              type="search"
              aria-label="Search Wiki"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search guides and sections"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear knowledge search"
              >
                ×
              </button>
            )}
          </label>
          <div className="knowledge-drawer__scroll">
            {library.length > 0 ? (
              <KnowledgeTree
                groups={library}
                selectedDocumentId={selectedDocument?.id ?? null}
                activeHeadingId={activeHeadingId}
                onSelectDocument={(document) => {
                  setSelectedDocumentId(document.id);
                  setRemovedDocumentTitle(null);
                  setActiveHeadingId(null);
                  setTarget(null);
                }}
                onSelectHeading={handleSelectHeading}
              />
            ) : (
              <div className="knowledge-no-results">
                <span>No matching guides</span>
                <p>Try a document name, category, or section heading.</p>
              </div>
            )}
          </div>
          <footer className="knowledge-drawer__footer">
            <span>
              {hasQuery ? `${shownCount} matching` : `${documents.length} documents`} across{' '}
              {shownCategoryCount} {shownCategoryCount === 1 ? 'category' : 'categories'}
            </span>
            <span data-state={indexStatus?.state ?? 'idle'}>{currentIndexLabel}</span>
          </footer>
        </aside>

        {removedDocumentTitle ? (
          <div className="knowledge-viewer-state" role="status">
            <span className="knowledge-viewer-state__eyebrow">Library updated</span>
            <h2>{removedDocumentTitle} was removed</h2>
            <p>Choose another guide from the library to continue.</p>
          </div>
        ) : (
          <KnowledgePdfViewer
            document={selectedDocument}
            active={active}
            target={target}
            currentSection={activeHeading?.label ?? (target ? 'Document section' : null)}
            focusRequestKey={focusRequestKey}
            resolveUrl={resolveUrl}
            onActivateResolvedLink={handleActivateResolvedLink}
            onDestinationChange={handleDestinationChange}
            onPageChange={handlePageChange}
          />
        )}
      </div>
    </div>
  );
}
