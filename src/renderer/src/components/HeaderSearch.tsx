import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Contact, Server, BridgeGroup } from '@shared/ipc';
import type { KnowledgeDocumentRecord } from '@shared/knowledge';
import type { KnowledgeSearchResult } from '@shared/knowledgeSearch';
import { useSearchContext } from '../contexts/SearchContext';
import { useCommandSearch, SearchResult, ResultType } from '../hooks/useCommandSearch';
import {
  ContactIcon,
  GroupIcon,
  ServerIcon,
  KnowledgeIcon,
  ActionIcon,
} from './command-palette/CommandIcons';
import { Tooltip } from './Tooltip';
import { useKnowledgeLibrary } from '../features/knowledge/useKnowledgeLibrary';
import { KnowledgeSearchBoundary } from '../features/knowledge/KnowledgeSearchBoundary';
import { useKnowledgePassageSearch } from '../features/knowledge/useKnowledgePassageSearch';
import type { KnowledgeOpenRequest } from '../features/knowledge/knowledgeNavigation';
import {
  isKnowledgeContentDestination,
  type KnowledgeContentDestination,
} from '../features/knowledge/knowledgeWorkspaceNavigation';

const FILTERABLE_TABS: Record<string, ResultType[]> = {
  Compose: ['server'],
  Personnel: ['contact', 'group', 'server'],
};
const IMMEDIATE_RESULT_LIMIT = 15;

type WikiPassageSearchResult = SearchResult & {
  source: 'wiki-passage';
  data: KnowledgeSearchResult;
};

export type HeaderSearchActions = {
  onAddContactToBridge: (email: string) => void;
  onToggleGroup: (groupId: string) => void;
  onNavigateToTab: (tab: string) => void;
  onOpenKnowledgeDestination: (destination: KnowledgeContentDestination) => void;
  onOpenAddContact: (email?: string) => void;
  onOpenKnowledgeDocument: (request: KnowledgeOpenRequest) => void;
};

type HeaderSearchProps = {
  activeTab: string;
  preferredResultType?: ResultType;
  contacts: Contact[];
  servers: Server[];
  groups: BridgeGroup[];
  knowledgeDocuments?: KnowledgeDocumentRecord[];
  actions: HeaderSearchActions;
};

const RenderIcon: React.FC<{ result: SearchResult }> = ({ result }) => {
  switch (result.type) {
    case 'contact':
      return <ContactIcon name={result.title} />;
    case 'group':
      return <GroupIcon />;
    case 'server':
      return <ServerIcon />;
    case 'knowledge':
      return <KnowledgeIcon />;
    case 'action':
      return <ActionIcon type={result.iconType} />;
    default:
      return null;
  }
};

function destinationKey(documentId: string, pageIndex: number, headingId: string | null): string {
  return JSON.stringify([documentId, pageIndex, headingId]);
}

function immediateKnowledgeDestinationKey(result: SearchResult): string | null {
  if (result.type !== 'knowledge') return null;
  const selection = result.data as {
    document?: Pick<KnowledgeDocumentRecord, 'id' | 'outline'>;
    headingId?: string;
  };
  if (!selection.document?.id) return null;
  const heading = selection.headingId
    ? selection.document.outline?.find((node) => node.id === selection.headingId)
    : undefined;
  return destinationKey(
    selection.document.id,
    heading?.pageIndex ?? 0,
    selection.headingId ?? null,
  );
}

function mapWikiPassageResults(
  immediateResults: SearchResult[],
  passageResults: KnowledgeSearchResult[],
): WikiPassageSearchResult[] {
  const destinations = new Set(
    immediateResults.map(immediateKnowledgeDestinationKey).filter((key): key is string => !!key),
  );

  return passageResults.flatMap((passage) => {
    const key = destinationKey(passage.documentId, passage.pageIndex, passage.headingId);
    if (destinations.has(key)) return [];
    destinations.add(key);
    return [
      {
        id: `wiki-passage-${passage.id}`,
        type: 'knowledge' as const,
        source: 'wiki-passage' as const,
        title: passage.title,
        subtitle: passage.excerpt,
        iconType: 'knowledge',
        data: passage,
      },
    ];
  });
}

type SearchResultItemProps = {
  result: SearchResult;
  index: number;
  selectedIndex: number;
  onSelect: (result: SearchResult) => void;
  onHover: (index: number) => void;
};

const SearchResultItem: React.FC<SearchResultItemProps> = ({
  result,
  index,
  selectedIndex,
  onSelect,
  onHover,
}) => {
  const passage = result.source === 'wiki-passage' ? (result.data as KnowledgeSearchResult) : null;
  return (
    <li // NOSONAR - combobox pattern requires role="option" on li
      className={`search-dropdown-item ${index === selectedIndex ? 'is-selected' : ''}`}
      role="option"
      aria-selected={index === selectedIndex}
    >
      <button
        type="button"
        data-index={index}
        id={`search-result-${index}`}
        className="search-dropdown-hitbox"
        onMouseDown={(event) => {
          event.preventDefault();
          onSelect(result);
        }}
        onMouseEnter={() => onHover(index)}
      >
        <div className="search-dropdown-result-icon">
          <RenderIcon result={result} />
        </div>
        <div className="search-dropdown-result-info">
          <div className="search-dropdown-result-title">{result.title}</div>
          {passage ? (
            <>
              <div className="search-dropdown-result-meta">
                <span>Page {passage.pageIndex + 1}</span>
                <span>{passage.category}</span>
                {passage.heading && <span>{passage.heading}</span>}
                {passage.matchKind === 'fuzzy' && (
                  <span className="search-dropdown-close-match">Close match</span>
                )}
              </div>
              <div className="search-dropdown-result-subtitle">{passage.excerpt}</div>
            </>
          ) : (
            result.subtitle && (
              <div className="search-dropdown-result-subtitle">{result.subtitle}</div>
            )
          )}
        </div>
        <div className="search-dropdown-result-type">{passage ? 'Wiki' : result.type}</div>
      </button>
    </li>
  );
};

type WikiPassageResultsProps = {
  results: WikiPassageSearchResult[];
  startIndex: number;
  selectedIndex: number;
  onSelect: (result: SearchResult) => void;
  onHover: (index: number) => void;
};

const WikiPassageResults: React.FC<WikiPassageResultsProps> = ({
  results,
  startIndex,
  selectedIndex,
  onSelect,
  onHover,
}) => {
  if (results.length === 0) return null;
  return (
    <>
      <li role="presentation" className="search-dropdown-group-label">
        Wiki passages
      </li>
      {results.map((result, offset) => (
        <SearchResultItem
          key={result.id}
          result={result}
          index={startIndex + offset}
          selectedIndex={selectedIndex}
          onSelect={onSelect}
          onHover={onHover}
        />
      ))}
    </>
  );
};

const WikiPassageRenderFailure: React.FC<{
  generationKey: string;
  onFailure: (generationKey: string) => void;
}> = ({ generationKey, onFailure }) => {
  useLayoutEffect(() => onFailure(generationKey), [generationKey, onFailure]);
  return null;
};

export const HeaderSearch: React.FC<HeaderSearchProps> = ({
  activeTab,
  preferredResultType,
  contacts,
  servers,
  groups,
  knowledgeDocuments,
  actions,
}) => {
  const {
    onAddContactToBridge,
    onToggleGroup,
    onNavigateToTab,
    onOpenKnowledgeDestination,
    onOpenAddContact,
    onOpenKnowledgeDocument,
  } = actions;
  const { query, setQuery, isSearchFocused, setIsSearchFocused, searchInputRef, clearSearch } =
    useSearchContext();
  const knowledgeLibrary = useKnowledgeLibrary({
    enabled: isSearchFocused || activeTab === 'Knowledge',
  });
  const searchableKnowledgeDocuments = knowledgeDocuments ?? knowledgeLibrary.documents;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [failedPassageGeneration, setFailedPassageGeneration] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce for dropdown results (faster than tab filtering)
  const [dropdownQuery, setDropdownQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDropdownQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const allResults = useCommandSearch(
    dropdownQuery,
    contacts,
    servers,
    groups,
    searchableKnowledgeDocuments,
  );
  const passageSearch = useKnowledgePassageSearch({
    query,
    scope: { kind: 'all' },
    limit: 20,
    enabled: isSearchFocused,
  });

  const rankedResults = useMemo(() => {
    if (!preferredResultType) return allResults;
    const preferred: SearchResult[] = [];
    const remaining: SearchResult[] = [];
    for (const result of allResults) {
      (result.type === preferredResultType ? preferred : remaining).push(result);
    }
    return [...preferred, ...remaining];
  }, [allResults, preferredResultType]);

  // On filterable tabs, hide results that duplicate the tab's filtered list
  const immediateResults = useMemo(() => {
    const typesToHide = FILTERABLE_TABS[activeTab] || [];
    const visibleResults =
      !typesToHide.length || !dropdownQuery
        ? rankedResults
        : rankedResults.filter((result) => !typesToHide.includes(result.type));
    return visibleResults.slice(0, IMMEDIATE_RESULT_LIMIT);
  }, [rankedResults, activeTab, dropdownQuery]);

  const passageResults = useMemo(
    () =>
      passageSearch.state === 'ready' && passageSearch.response
        ? mapWikiPassageResults(immediateResults, passageSearch.response.results)
        : [],
    [immediateResults, passageSearch.response, passageSearch.state],
  );
  const passageGenerationKey = passageSearch.generationKey || dropdownQuery;
  const visiblePassageResults = useMemo(
    () => (failedPassageGeneration === passageGenerationKey ? [] : passageResults),
    [failedPassageGeneration, passageGenerationKey, passageResults],
  );
  const dropdownResults = useMemo(
    () => [...immediateResults, ...visiblePassageResults],
    [immediateResults, visiblePassageResults],
  );
  const activeIndex =
    dropdownResults.length === 0 ? 0 : Math.min(selectedIndex, dropdownResults.length - 1);

  const handlePassageRenderFailure = useCallback((generationKey: string) => {
    setFailedPassageGeneration(generationKey);
  }, []);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [dropdownQuery]);

  useEffect(() => {
    setSelectedIndex((current) =>
      dropdownResults.length === 0 ? 0 : Math.min(current, dropdownResults.length - 1),
    );
  }, [dropdownResults.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selected = resultsRef.current.querySelector(`[data-index="${activeIndex}"]`);
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const showDropdown = isSearchFocused && dropdownResults.length > 0;

  const handleSelect = useCallback(
    (result: SearchResult) => {
      if (result.source === 'wiki-passage') {
        const passage = result.data as KnowledgeSearchResult;
        onOpenKnowledgeDocument({
          documentId: passage.documentId,
          ...(passage.headingId ? { headingId: passage.headingId } : {}),
          pageIndex: passage.pageIndex,
          highlightText: passage.highlightText,
          normalizedStart: passage.normalizedStart,
          normalizedEnd: passage.normalizedEnd,
        });
        clearSearch();
        searchInputRef.current?.blur();
        return;
      }
      switch (result.type) {
        case 'contact': {
          const contact = result.data as Contact;
          onAddContactToBridge(contact.email);
          break;
        }
        case 'group': {
          const group = result.data as BridgeGroup;
          onToggleGroup(group.id);
          break;
        }
        case 'server': {
          onOpenKnowledgeDestination('servers');
          break;
        }
        case 'knowledge': {
          const selection = result.data as {
            document: KnowledgeDocumentRecord;
            headingId?: string;
          };
          onOpenKnowledgeDocument({
            documentId: selection.document.id,
            ...(selection.headingId ? { headingId: selection.headingId } : {}),
          });
          break;
        }
        case 'action': {
          const action = result.data as {
            action: string;
            tab?: string;
            value?: string;
            destination?: unknown;
          };
          if (action.action === 'navigate' && action.tab) {
            onNavigateToTab(action.tab);
          } else if (
            action.action === 'open-knowledge' &&
            isKnowledgeContentDestination(action.destination)
          ) {
            onOpenKnowledgeDestination(action.destination);
          } else if (action.action === 'create-contact') {
            onOpenAddContact(action.value);
          } else if (action.action === 'add-manual' && action.value) {
            onAddContactToBridge(action.value);
          }
          break;
        }
      }
      clearSearch();
      searchInputRef.current?.blur();
    },
    [
      onAddContactToBridge,
      onToggleGroup,
      onNavigateToTab,
      onOpenKnowledgeDestination,
      onOpenAddContact,
      onOpenKnowledgeDocument,
      clearSearch,
      searchInputRef,
    ],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (query) {
          clearSearch();
        } else {
          searchInputRef.current?.blur();
        }
        return;
      }

      if (!showDropdown) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, dropdownResults.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (dropdownResults[activeIndex]) {
            handleSelect(dropdownResults[activeIndex]);
          }
          break;
      }
    },
    [query, showDropdown, dropdownResults, activeIndex, handleSelect, clearSearch, searchInputRef],
  );

  const handleFocus = useCallback(() => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = undefined;
    }
    setIsSearchFocused(true);
  }, [setIsSearchFocused]);

  const handleBlur = useCallback(() => {
    // Delay to allow dropdown click to register
    blurTimeoutRef.current = setTimeout(() => {
      setIsSearchFocused(false);
    }, 200);
  }, [setIsSearchFocused]);

  // Cleanup blur timeout on unmount
  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    };
  }, []);

  // Get dropdown position anchored below the search bar
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  useEffect(() => {
    if (showDropdown && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 8,
        left: rect.left,
        width: Math.min(480, Math.max(rect.width, 360), window.innerWidth - rect.left - 20),
        zIndex: 10002,
      });
    }
  }, [showDropdown, query]);

  const isMac =
    typeof globalThis.api?.platform === 'string' ? globalThis.api.platform === 'darwin' : true;

  return (
    <>
      <div className="header-search-bar" ref={containerRef}>
        <svg
          className="header-search-bar-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={searchInputRef}
          className="header-search-bar-input"
          type="text"
          role="combobox"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="Search Relay..."
          aria-label="Search Relay"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? 'header-search-dropdown' : undefined}
          aria-activedescendant={
            showDropdown && dropdownResults.length > 0 ? `search-result-${activeIndex}` : undefined
          }
        />
        {query ? (
          <Tooltip content="Clear search" position="bottom">
            <button
              type="button"
              className="header-search-bar-clear"
              onClick={clearSearch}
              onMouseDown={(e) => e.preventDefault()}
              aria-label="Clear search"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Tooltip>
        ) : (
          <kbd className="header-search-bar-shortcut">{isMac ? '\u2318K' : 'Ctrl+K'}</kbd>
        )}
      </div>

      {showDropdown &&
        createPortal(
          <div
            className="search-dropdown"
            id="header-search-dropdown"
            style={dropdownStyle}
            data-motion="popover"
          >
            {/* Custom combobox dropdown requires ARIA roles - no semantic HTML equivalent */}
            <ul ref={resultsRef} className="search-dropdown-results" role="listbox">
              {/* NOSONAR */}
              {immediateResults.map((result, index) => (
                <SearchResultItem
                  key={result.id}
                  result={result}
                  index={index}
                  selectedIndex={activeIndex}
                  onSelect={handleSelect}
                  onHover={setSelectedIndex}
                />
              ))}
              <KnowledgeSearchBoundary
                key={passageGenerationKey}
                fallback={
                  <WikiPassageRenderFailure
                    generationKey={passageGenerationKey}
                    onFailure={handlePassageRenderFailure}
                  />
                }
              >
                <WikiPassageResults
                  results={visiblePassageResults}
                  startIndex={immediateResults.length}
                  selectedIndex={activeIndex}
                  onSelect={handleSelect}
                  onHover={setSelectedIndex}
                />
              </KnowledgeSearchBoundary>
            </ul>
            <div className="search-dropdown-footer">
              <span>
                <kbd className="kbd-key">&uarr;&darr;</kbd> Navigate
              </span>
              <span>
                <kbd className="kbd-key">&crarr;</kbd> Select
              </span>
              <span>
                <kbd className="kbd-key">esc</kbd> Close
              </span>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
