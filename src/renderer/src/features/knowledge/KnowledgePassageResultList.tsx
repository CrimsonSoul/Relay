import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import type { KnowledgeSearchResult } from '@shared/knowledgeSearch';
import { KnowledgeSearchBoundary } from './KnowledgeSearchBoundary';
import type { KnowledgeOpenRequest } from './knowledgeNavigation';
import { useKnowledgeCover } from './useKnowledgeCover';

type Props = {
  documentsById: ReadonlyMap<string, KnowledgeDocumentRecord>;
  localResults: readonly KnowledgeSearchResult[];
  enhancedResults: readonly KnowledgeSearchResult[];
  loading: boolean;
  unavailable: boolean;
  searchIdentity: string;
  settled: boolean;
  onOpen: (request: KnowledgeOpenRequest) => void;
};

const UNAVAILABLE_MESSAGE = 'Full-text search unavailable. Showing title and section matches.';

function documentTypeLabel(documentType: KnowledgeDocumentRecord['documentType']): string {
  return documentType === 'cheatsheet' ? 'Quick Guide' : 'SOP Manual';
}

function ResultCover({ document }: Readonly<{ document: KnowledgeDocumentRecord }>) {
  const cover = useKnowledgeCover({ documentId: document.id, checksum: document.checksum });
  const fallback = documentTypeLabel(document.documentType);
  return (
    <span ref={cover.ref} className="knowledge-passage-result__cover" data-state={cover.state}>
      {cover.url && cover.state !== 'error' ? (
        <img src={cover.url} alt="" onLoad={cover.onImageLoad} onError={cover.onImageError} />
      ) : (
        <span className="knowledge-passage-result__cover-fallback" aria-hidden="true">
          <span>{fallback}</span>
          <strong>{document.displayTitle.slice(0, 1)}</strong>
        </span>
      )}
    </span>
  );
}

function ResultRow({
  document,
  result,
  onOpen,
}: Readonly<{
  document: KnowledgeDocumentRecord;
  result: KnowledgeSearchResult;
  onOpen: (request: KnowledgeOpenRequest) => void;
}>) {
  const pageNumber = result.pageIndex + 1;
  const heading = result.heading?.trim() || 'Document text';
  return (
    <li className="knowledge-passage-result">
      <button
        type="button"
        className="knowledge-passage-result__button"
        aria-label={`Open ${document.displayTitle}, ${heading}, page ${pageNumber}`}
        onClick={() =>
          onOpen({
            documentId: result.documentId,
            ...(result.headingId ? { headingId: result.headingId } : {}),
            pageIndex: result.pageIndex,
            highlightText: result.highlightText,
            normalizedStart: result.normalizedStart,
            normalizedEnd: result.normalizedEnd,
          })
        }
      >
        <ResultCover document={document} />
        <span className="knowledge-passage-result__content">
          <span className="knowledge-passage-result__identity">
            <span>{documentTypeLabel(document.documentType)}</span>
            <strong>{document.displayTitle}</strong>
            <span>{document.category}</span>
          </span>
          <span className="knowledge-passage-result__destination">
            <strong>{heading}</strong>
            <span className="knowledge-passage-result__page">Page {pageNumber}</span>
            {result.matchKind === 'fuzzy' && (
              <span className="knowledge-passage-result__match">Close match</span>
            )}
          </span>
          <span className="knowledge-passage-result__excerpt">{result.excerpt}</span>
        </span>
        <span className="knowledge-passage-result__arrow" aria-hidden="true">
          →
        </span>
      </button>
    </li>
  );
}

function ResultRows({
  documentsById,
  results,
  onOpen,
}: Readonly<{
  documentsById: ReadonlyMap<string, KnowledgeDocumentRecord>;
  results: readonly KnowledgeSearchResult[];
  onOpen: (request: KnowledgeOpenRequest) => void;
}>) {
  return results.map((result) => {
    const document = documentsById.get(result.documentId);
    return document ? (
      <ResultRow key={result.id} document={document} result={result} onOpen={onOpen} />
    ) : null;
  });
}

function UnavailableNotice() {
  return (
    <li className="knowledge-passage-results__notice" role="status">
      {UNAVAILABLE_MESSAGE}
    </li>
  );
}

function EnhancedResultRows({
  identity,
  documentsById,
  results,
  onOpen,
  onRendered,
}: Readonly<{
  identity: string;
  documentsById: ReadonlyMap<string, KnowledgeDocumentRecord>;
  results: readonly KnowledgeSearchResult[];
  onOpen: (request: KnowledgeOpenRequest) => void;
  onRendered: (identity: string) => void;
}>) {
  useLayoutEffect(() => {
    onRendered(identity);
  }, [identity, onRendered]);

  return <ResultRows documentsById={documentsById} results={results} onOpen={onOpen} />;
}

function EnhancedRenderFailure({
  identity,
  onFailure,
}: Readonly<{
  identity: string;
  onFailure: (identity: string) => void;
}>) {
  useLayoutEffect(() => {
    onFailure(identity);
  }, [identity, onFailure]);

  return <UnavailableNotice />;
}

export function KnowledgePassageResultList({
  documentsById,
  localResults,
  enhancedResults,
  loading,
  unavailable,
  searchIdentity,
  settled,
  onOpen,
}: Readonly<Props>) {
  const [enhancedRender, setEnhancedRender] = useState<{
    identity: string;
    status: 'ready' | 'failed';
  } | null>(null);
  const markEnhancedRendered = useCallback((identity: string) => {
    setEnhancedRender((current) =>
      current?.identity === identity && current.status === 'ready'
        ? current
        : { identity, status: 'ready' },
    );
  }, []);
  const markEnhancedFailed = useCallback((identity: string) => {
    setEnhancedRender((current) =>
      current?.identity === identity && current.status === 'failed'
        ? current
        : { identity, status: 'failed' },
    );
  }, []);
  const hasEnhancedResults = enhancedResults.length > 0;
  let enhancedRenderStatus: 'ready' | 'failed' | 'pending' = 'ready';
  if (hasEnhancedResults) {
    enhancedRenderStatus =
      enhancedRender?.identity === searchIdentity ? enhancedRender.status : 'pending';
  }
  const enhancedRenderFailed = enhancedRenderStatus === 'failed';
  const total = localResults.length + (enhancedRenderFailed ? 0 : enhancedResults.length);
  const announcementSettled =
    settled && (!hasEnhancedResults || enhancedRenderStatus !== 'pending');
  const [announcement, setAnnouncement] = useState<{
    identity: string;
    message: string;
  } | null>(null);
  const lastAnnouncedIdentity = useRef<string | null>(null);

  useEffect(() => {
    if (!announcementSettled || lastAnnouncedIdentity.current === searchIdentity) return;
    lastAnnouncedIdentity.current = searchIdentity;
    setAnnouncement({
      identity: searchIdentity,
      message: `${total} Wiki search ${total === 1 ? 'result' : 'results'}`,
    });
  }, [announcementSettled, searchIdentity, total]);

  const announcementMessage =
    announcementSettled && announcement?.identity === searchIdentity ? announcement.message : '';

  return (
    <section className="knowledge-passage-results" aria-label="Wiki search">
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcementMessage && <span key={searchIdentity}>{announcementMessage}</span>}
      </div>
      <ul className="knowledge-passage-results__list" aria-label="Wiki search results">
        <ResultRows documentsById={documentsById} results={localResults} onOpen={onOpen} />
        {unavailable && <UnavailableNotice />}
        <KnowledgeSearchBoundary
          key={searchIdentity}
          fallback={
            <EnhancedRenderFailure identity={searchIdentity} onFailure={markEnhancedFailed} />
          }
        >
          <EnhancedResultRows
            identity={searchIdentity}
            documentsById={documentsById}
            results={enhancedResults}
            onOpen={onOpen}
            onRendered={markEnhancedRendered}
          />
        </KnowledgeSearchBoundary>
        {loading && total === 0 && (
          <li className="knowledge-passage-results__state" role="status">
            Searching full text…
          </li>
        )}
        {!loading && total === 0 && !unavailable && !enhancedRenderFailed && (
          <li className="knowledge-passage-results__state" role="status">
            <strong>No matching pages.</strong>
            <span>Try a title, section, filename, or procedure phrase.</span>
          </li>
        )}
      </ul>
    </section>
  );
}
