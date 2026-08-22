import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { KnowledgeDocumentSearchSnapshot } from './knowledgeDocumentSearch';
import type { KnowledgeDocumentSearchDisplayResult } from './useKnowledgeDocumentSearch';

type RowProps = {
  results: readonly KnowledgeDocumentSearchDisplayResult[];
  activeResultIndex: number;
  allResults: readonly KnowledgeDocumentSearchDisplayResult[];
  onActivate: (index: number) => void;
};

type Props = {
  snapshot: KnowledgeDocumentSearchSnapshot;
  results: readonly KnowledgeDocumentSearchDisplayResult[];
  enhancedUnavailable: boolean;
  activeResultIndex: number;
  onActivate: (index: number) => void;
  onPrevious: () => void;
  onNext: () => void;
  fuzzyContent?: ReactNode;
};

function statusLabel(snapshot: KnowledgeDocumentSearchSnapshot, resultCount: number): string {
  if (snapshot.state === 'unavailable') {
    return 'This PDF has no searchable text. Relay does not run OCR.';
  }
  if (snapshot.state === 'indexing') {
    if (snapshot.completedPages === 0) return 'Searching…';
    return `${resultCount} matches · ${snapshot.completedPages} of ${snapshot.totalPages} pages searched`;
  }
  if (snapshot.state === 'partial') {
    return `${resultCount} matches · ${snapshot.failedPageIndices.length} pages unavailable`;
  }
  if (snapshot.state === 'ready' && resultCount === 0) {
    return 'No matches in this guide';
  }
  return `${resultCount} matches`;
}

function displayText(result: KnowledgeDocumentSearchDisplayResult): {
  section: string;
  excerpt: string;
  pageIndex: number;
} {
  if (result.source === 'local-exact') {
    return {
      section: result.match.sectionLabel ?? 'Document text',
      excerpt: result.match.snippet,
      pageIndex: result.match.pageIndex,
    };
  }
  return {
    section: result.match.heading ?? 'Document text',
    excerpt: result.match.excerpt,
    pageIndex: result.match.pageIndex,
  };
}

export function KnowledgeDocumentSearchResultRows({
  results,
  activeResultIndex,
  allResults,
  onActivate,
}: Readonly<RowProps>) {
  return results.map((result) => {
    const index = allResults.indexOf(result);
    const content = displayText(result);
    return (
      <li key={result.id}>
        <button
          type="button"
          aria-current={index === activeResultIndex ? 'location' : undefined}
          aria-label={`Page ${content.pageIndex + 1}, ${content.section}, ${content.excerpt}`}
          onClick={() => onActivate(index)}
        >
          <span className="knowledge-document-search__row-heading">
            <span>{content.section}</span>
            {result.source === 'fuzzy' && (
              <span className="knowledge-document-search__match-kind">Close match</span>
            )}
          </span>
          <strong>{content.excerpt}</strong>
          <span>Page {content.pageIndex + 1}</span>
        </button>
      </li>
    );
  });
}

export function KnowledgeDocumentSearchFuzzyResults({
  results,
  activeResultIndex,
  allResults,
  onActivate,
}: Readonly<RowProps>) {
  return (
    <KnowledgeDocumentSearchResultRows
      results={results.filter((result) => result.source === 'fuzzy')}
      activeResultIndex={activeResultIndex}
      allResults={allResults}
      onActivate={onActivate}
    />
  );
}

export function KnowledgeDocumentSearchResults({
  snapshot,
  results,
  enhancedUnavailable,
  activeResultIndex,
  onActivate,
  onPrevious,
  onNext,
  fuzzyContent,
}: Readonly<Props>) {
  const hasResults = results.length > 0;
  const localResults = results.filter((result) => result.source === 'local-exact');
  const resultsRef = useRef<HTMLUListElement>(null);
  const activeResultId = results[activeResultIndex]?.id ?? null;

  useLayoutEffect(() => {
    if (!activeResultId) return;
    const scrollContainer = resultsRef.current?.closest<HTMLElement>('.knowledge-drawer__scroll');
    if (activeResultIndex === 0 && scrollContainer) {
      if (typeof scrollContainer.scrollTo === 'function') {
        scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        scrollContainer.scrollTop = 0;
      }
      return;
    }
    resultsRef.current
      ?.querySelector<HTMLElement>('button[aria-current="location"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeResultId, activeResultIndex]);

  return (
    <section className="knowledge-document-search" aria-label="Search results">
      <div className="knowledge-document-search__controls">
        <div className="knowledge-document-search__status" role="status" aria-live="polite">
          {statusLabel(snapshot, results.length)}
        </div>
        <div className="knowledge-document-search__navigation" aria-label="Match navigation">
          <button
            type="button"
            aria-label="Previous match"
            disabled={!hasResults}
            onClick={onPrevious}
          >
            ↑
          </button>
          <span>
            {activeResultIndex >= 0
              ? `${activeResultIndex + 1} of ${results.length}`
              : `${results.length} matches`}
          </span>
          <button type="button" aria-label="Next match" disabled={!hasResults} onClick={onNext}>
            ↓
          </button>
        </div>
      </div>
      {snapshot.state === 'partial' && (
        <p className="knowledge-document-search__partial">
          Unavailable pages:{' '}
          {snapshot.failedPageIndices.map((pageIndex) => pageIndex + 1).join(', ')}
        </p>
      )}
      {enhancedUnavailable && (
        <p className="knowledge-document-search__enhanced-unavailable">
          Full-text close matches are unavailable.
        </p>
      )}
      <ul ref={resultsRef} className="knowledge-document-search__results" aria-label="Matches">
        <KnowledgeDocumentSearchResultRows
          results={localResults}
          activeResultIndex={activeResultIndex}
          allResults={results}
          onActivate={onActivate}
        />
        {fuzzyContent ?? (
          <KnowledgeDocumentSearchFuzzyResults
            results={results}
            activeResultIndex={activeResultIndex}
            allResults={results}
            onActivate={onActivate}
          />
        )}
      </ul>
    </section>
  );
}
