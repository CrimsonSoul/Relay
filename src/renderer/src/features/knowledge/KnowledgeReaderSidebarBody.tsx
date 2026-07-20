import { Component, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type {
  KnowledgeDocumentRecord,
  KnowledgeIndexStatus,
  KnowledgeOutlineNode,
} from '@shared/knowledge';
import type { KnowledgeCategoryGroup } from './knowledgeModel';
import { KnowledgeContents } from './KnowledgeContents';
import {
  KnowledgeDocumentSearchFuzzyResults,
  KnowledgeDocumentSearchResults,
} from './KnowledgeDocumentSearchResults';
import { KnowledgeTree } from './KnowledgeTree';
import { SearchInput } from '../../components/SearchInput';
import type { KnowledgeDocumentSearchModel } from './useKnowledgeDocumentSearch';
import { loggers } from '../../utils/logger';

type SidebarMode = 'contents' | 'library';

type FuzzyBoundaryProps = {
  generationKey: string;
  onFailure: (generationKey: string) => void;
  children: ReactNode;
};

class KnowledgeDocumentFuzzyBoundary extends Component<FuzzyBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    const errorClass =
      typeof error === 'object' &&
      error !== null &&
      typeof (error as { constructor?: { name?: unknown } }).constructor?.name === 'string'
        ? (error as { constructor: { name: string } }).constructor.name
        : 'UnknownError';
    loggers.ui.error('Enhanced Wiki search rendering failed', { errorClass });
    this.props.onFailure(this.props.generationKey);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

type ReaderSidebarProps = {
  mode: SidebarMode;
  contentsTabRef: RefObject<HTMLButtonElement | null>;
  libraryTabRef: RefObject<HTMLButtonElement | null>;
  contentsSearchRef: RefObject<HTMLInputElement | null>;
  librarySearchRef: RefObject<HTMLInputElement | null>;
  contentsSearch: KnowledgeDocumentSearchModel;
  libraryQuery: string;
  groups: KnowledgeCategoryGroup[];
  documents: KnowledgeDocumentRecord[];
  selectedDocument: KnowledgeDocumentRecord;
  activeHeadingId: string | null;
  shownCount: number;
  shownCategoryCount: number;
  indexState: KnowledgeIndexStatus['state'] | 'idle';
  indexLabel: string;
  onModeChange: (mode: SidebarMode) => void;
  onLibraryQueryChange: (query: string) => void;
  onContentsEscape: () => void;
  onSelectDocument: (document: KnowledgeDocumentRecord) => void;
  onSelectHeading: (heading: KnowledgeOutlineNode) => void;
};

function modeForKey(key: string): SidebarMode | null {
  if (key === 'ArrowLeft' || key === 'Home') return 'contents';
  if (key === 'ArrowRight' || key === 'End') return 'library';
  return null;
}

function KnowledgeSidebarPanel({
  mode,
  contentsSearch,
  groups,
  selectedDocument,
  activeHeadingId,
  onSelectDocument,
  onSelectHeading,
}: Readonly<
  Pick<
    ReaderSidebarProps,
    | 'mode'
    | 'contentsSearch'
    | 'groups'
    | 'selectedDocument'
    | 'activeHeadingId'
    | 'onSelectDocument'
    | 'onSelectHeading'
  >
>) {
  if (mode === 'contents') {
    return (
      <div
        id="knowledge-sidebar-contents-panel"
        role="tabpanel"
        aria-labelledby="knowledge-sidebar-contents-tab"
      >
        {contentsSearch.query.trim() ? (
          <KnowledgeDocumentSearchResults
            snapshot={contentsSearch.snapshot}
            results={contentsSearch.results}
            enhancedUnavailable={contentsSearch.enhancedUnavailable}
            activeResultIndex={contentsSearch.activeResultIndex}
            onActivate={contentsSearch.activateResult}
            onPrevious={contentsSearch.activatePrevious}
            onNext={contentsSearch.activateNext}
            fuzzyContent={
              <KnowledgeDocumentFuzzyBoundary
                key={`${selectedDocument.id}:${contentsSearch.query}:${contentsSearch.enhancedGenerationKey}`}
                generationKey={contentsSearch.enhancedGenerationKey}
                onFailure={contentsSearch.hideEnhancedResults}
              >
                <KnowledgeDocumentSearchFuzzyResults
                  results={contentsSearch.results}
                  activeResultIndex={contentsSearch.activeResultIndex}
                  allResults={contentsSearch.results}
                  onActivate={contentsSearch.activateResult}
                />
              </KnowledgeDocumentFuzzyBoundary>
            }
          />
        ) : (
          <KnowledgeContents
            document={selectedDocument}
            activeHeadingId={activeHeadingId}
            onSelectHeading={onSelectHeading}
          />
        )}
      </div>
    );
  }

  if (groups.length > 0) {
    return (
      <div
        id="knowledge-sidebar-library-panel"
        role="tabpanel"
        aria-labelledby="knowledge-sidebar-library-tab"
      >
        <KnowledgeTree
          groups={groups}
          selectedDocumentId={selectedDocument.id}
          activeHeadingId={activeHeadingId}
          onSelectDocument={onSelectDocument}
          onSelectHeading={onSelectHeading}
        />
      </div>
    );
  }

  return (
    <div
      id="knowledge-sidebar-library-panel"
      role="tabpanel"
      aria-labelledby="knowledge-sidebar-library-tab"
      className="knowledge-no-results"
    >
      <span>No matching guides</span>
      <p>Try a document name, category, or section heading.</p>
    </div>
  );
}

export function KnowledgeReaderSidebarBody({
  mode,
  contentsTabRef,
  libraryTabRef,
  contentsSearchRef,
  librarySearchRef,
  contentsSearch,
  libraryQuery,
  groups,
  documents,
  selectedDocument,
  activeHeadingId,
  shownCount,
  shownCategoryCount,
  indexState,
  indexLabel,
  onModeChange,
  onLibraryQueryChange,
  onContentsEscape,
  onSelectDocument,
  onSelectHeading,
}: Readonly<ReaderSidebarProps>) {
  const handleModeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const nextMode = modeForKey(event.key);
    if (!nextMode) return;
    event.preventDefault();
    onModeChange(nextMode);
    globalThis.requestAnimationFrame(() => {
      (nextMode === 'contents' ? contentsTabRef : libraryTabRef).current?.focus();
    });
  };
  const hasLibraryQuery = libraryQuery.trim().length > 0;

  const handleScopedSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (mode !== 'contents') return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.shiftKey ? contentsSearch.activatePrevious() : contentsSearch.activateNext();
      return;
    }
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (contentsSearch.query) {
      contentsSearch.clear();
      return;
    }
    onContentsEscape();
  };

  return (
    <>
      <div className="knowledge-drawer__modes" role="tablist" aria-label="Wiki sidebar mode">
        <button
          ref={contentsTabRef}
          id="knowledge-sidebar-contents-tab"
          type="button"
          role="tab"
          aria-controls="knowledge-sidebar-contents-panel"
          aria-selected={mode === 'contents'}
          tabIndex={mode === 'contents' ? 0 : -1}
          onClick={() => onModeChange('contents')}
          onKeyDown={handleModeKeyDown}
        >
          Contents
        </button>
        <button
          ref={libraryTabRef}
          id="knowledge-sidebar-library-tab"
          type="button"
          role="tab"
          aria-controls="knowledge-sidebar-library-panel"
          aria-selected={mode === 'library'}
          tabIndex={mode === 'library' ? 0 : -1}
          onClick={() => onModeChange('library')}
          onKeyDown={handleModeKeyDown}
        >
          Library
        </button>
      </div>
      <div className="knowledge-search scoped-search-control scoped-search-control--compact">
        <SearchInput
          ref={mode === 'contents' ? contentsSearchRef : librarySearchRef}
          type="search"
          aria-label={mode === 'contents' ? 'Search this guide' : 'Filter library'}
          value={mode === 'contents' ? contentsSearch.query : libraryQuery}
          onChange={(event) =>
            mode === 'contents'
              ? contentsSearch.setQuery(event.target.value)
              : onLibraryQueryChange(event.target.value)
          }
          onKeyDown={handleScopedSearchKeyDown}
          placeholder={mode === 'contents' ? 'Search this guide' : 'Filter library'}
          className="scoped-search-input"
        />
      </div>
      <div className="knowledge-drawer__scroll">
        <KnowledgeSidebarPanel
          mode={mode}
          contentsSearch={contentsSearch}
          groups={groups}
          selectedDocument={selectedDocument}
          activeHeadingId={activeHeadingId}
          onSelectDocument={onSelectDocument}
          onSelectHeading={onSelectHeading}
        />
      </div>
      <footer className="knowledge-drawer__footer">
        {mode === 'contents' ? (
          <span>
            {selectedDocument.pageCount} pages ·{' '}
            {selectedDocument.documentType === 'sop' ? 'SOP guide' : 'Cheatsheet'}
          </span>
        ) : (
          <span>
            {hasLibraryQuery ? `${shownCount} matching` : `${documents.length} documents`} across{' '}
            {shownCategoryCount} {shownCategoryCount === 1 ? 'category' : 'categories'}
          </span>
        )}
        <span data-state={indexState}>{indexLabel}</span>
      </footer>
    </>
  );
}
