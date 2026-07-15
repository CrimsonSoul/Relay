import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PublicRelayConfig } from '@shared/ipc';
import type { KnowledgeIndexStatus, KnowledgeOutlineNode } from '@shared/knowledge';
import { buildKnowledgeLibrary, findKnowledgeDocument } from './knowledgeModel';
import { useKnowledgeLibrary } from './useKnowledgeLibrary';
import { KnowledgeTree } from './KnowledgeTree';
import { KnowledgePdfViewer } from './KnowledgePdfViewer';
import {
  acknowledgeKnowledgeDocumentOpen,
  getPendingKnowledgeDocumentOpen,
  type KnowledgeOpenRequest,
  OPEN_KNOWLEDGE_DOCUMENT_EVENT,
} from './knowledgeNavigation';

type Props = {
  active: boolean;
  relayMode?: PublicRelayConfig['mode'];
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

export function KnowledgeTab({ active, relayMode }: Readonly<Props>) {
  const { documents, loading, error, hasLoadedSnapshot } = useKnowledgeLibrary();
  const [query, setQuery] = useState('');
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [target, setTarget] = useState<KnowledgeOutlineNode | null>(null);
  const [indexStatus, setIndexStatus] = useState<KnowledgeIndexStatus | null>(null);
  const [removedDocumentTitle, setRemovedDocumentTitle] = useState<string | null>(null);
  const lastSelectedTitleRef = useRef<string | null>(null);
  const library = useMemo(() => buildKnowledgeLibrary(documents, query), [documents, query]);
  const selectedDocument = findKnowledgeDocument(library, selectedDocumentId);
  const activeHeading = selectedDocument?.outline.find((node) => node.id === activeHeadingId);
  const selectedExistsInLibrary = selectedDocumentId
    ? documents.some((document) => document.id === selectedDocumentId)
    : true;

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
        .toSorted((left, right) => left.pageIndex - right.pageIndex)
        .at(-1);
      setActiveHeadingId(heading?.id ?? null);
    },
    [selectedDocument],
  );

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
    const isServer = relayMode === 'server';
    return (
      <div className="knowledge-tab knowledge-tab--empty">
        <div className="knowledge-empty">
          <div className="knowledge-empty__glyph" aria-hidden="true">
            KB
          </div>
          <span className="knowledge-empty__eyebrow">Read-only reference library</span>
          <h1>No knowledge documents yet</h1>
          <p>
            {isServer
              ? 'Add PDF guides to the server knowledge-base folder. Relay will organize them by folder and extract usable section headings automatically.'
              : 'The Relay server has not shared any knowledge documents yet. They will appear here automatically when available.'}
          </p>
          {isServer && (
            <code className="knowledge-empty__path">
              &lt;Relay config data directory&gt;/knowledge-base
            </code>
          )}
          {indexStatus?.message &&
            (indexStatus.state === 'warning' || indexStatus.state === 'error') && (
              <span className="knowledge-empty__error" role="status">
                {indexStatus.message}
              </span>
            )}
          {error && <span className="knowledge-empty__error">{error}</span>}
        </div>
      </div>
    );
  }

  const categoryCount = new Set(documents.map((document) => document.category)).size;
  const shownCount = library.reduce((count, group) => count + group.documents.length, 0);
  const hasQuery = query.trim().length > 0;
  const shownCategoryCount = hasQuery ? library.length : categoryCount;
  const latestDocumentIndex = documents
    .map((document) => document.indexedAt)
    .toSorted((left, right) => right.localeCompare(left))[0];
  const currentIndexLabel = indexLabel(indexStatus, latestDocumentIndex);

  return (
    <div className="knowledge-tab">
      <header className="knowledge-tab__header">
        <div>
          <span className="knowledge-tab__kicker">Operator reference</span>
          <h1>Knowledge base</h1>
          <p>Find the guide, jump to the procedure, and stay in the flow.</p>
        </div>
        <div className="knowledge-tab__mode" aria-label="Library permissions">
          <span className="knowledge-tab__mode-dot" aria-hidden="true" />
          Read only
        </div>
      </header>

      <div className="knowledge-workspace">
        <aside className="knowledge-drawer" aria-label="Knowledge library">
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
              aria-label="Search knowledge base"
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
            currentSection={activeHeading?.label ?? null}
            onPageChange={handlePageChange}
          />
        )}
      </div>
    </div>
  );
}
