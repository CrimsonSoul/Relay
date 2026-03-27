import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Contact, Server, BridgeGroup } from '@shared/ipc';
import { useSearchContext } from '../contexts/SearchContext';
import { useCommandSearch, SearchResult, ResultType } from '../hooks/useCommandSearch';
import { ContactIcon, GroupIcon, ServerIcon, ActionIcon } from './command-palette/CommandIcons';

const FILTERABLE_TABS: Record<string, ResultType[]> = {
  Compose: ['server'],
  People: ['contact', 'group', 'server'],
  Servers: ['contact', 'group', 'server'],
  Personnel: ['contact', 'group', 'server'],
  Weather: ['contact', 'group', 'server'],
  Radar: ['contact', 'group', 'server'],
  AI: ['contact', 'group', 'server'],
  Notes: ['contact', 'group', 'server'],
};

export type HeaderSearchActions = {
  onAddContactToBridge: (email: string) => void;
  onToggleGroup: (groupId: string) => void;
  onNavigateToTab: (tab: string) => void;
  onOpenAddContact: (email?: string) => void;
};

type HeaderSearchProps = {
  activeTab: string;
  contacts: Contact[];
  servers: Server[];
  groups: BridgeGroup[];
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
    case 'action':
      return <ActionIcon type={result.iconType} />;
    default:
      return null;
  }
};

export const HeaderSearch: React.FC<HeaderSearchProps> = ({
  activeTab,
  contacts,
  servers,
  groups,
  actions,
}) => {
  const { onAddContactToBridge, onToggleGroup, onNavigateToTab, onOpenAddContact } = actions;
  const { query, setQuery, isSearchFocused, setIsSearchFocused, searchInputRef, clearSearch } =
    useSearchContext();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  // Debounce for dropdown results (faster than tab filtering)
  const [dropdownQuery, setDropdownQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDropdownQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const allResults = useCommandSearch(dropdownQuery, contacts, servers, groups);

  // On filterable tabs, hide results that duplicate the tab's filtered list
  const dropdownResults = useMemo(() => {
    const typesToHide = FILTERABLE_TABS[activeTab] || [];
    if (!typesToHide.length || !dropdownQuery) return allResults;
    return allResults.filter((r) => !typesToHide.includes(r.type));
  }, [allResults, activeTab, dropdownQuery]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [dropdownQuery]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selected = resultsRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const isListFilteringTab = activeTab === 'People' || activeTab === 'Servers';
  const showDropdown = isSearchFocused && dropdownResults.length > 0;

  const handleSelect = useCallback(
    (result: SearchResult) => {
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
          onNavigateToTab('Servers');
          break;
        }
        case 'action': {
          const action = result.data as { action: string; tab?: string; value?: string };
          if (action.action === 'navigate' && action.tab) {
            onNavigateToTab(action.tab);
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
      onOpenAddContact,
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
          if (dropdownResults[selectedIndex]) {
            handleSelect(dropdownResults[selectedIndex]);
          }
          break;
      }
    },
    [
      query,
      showDropdown,
      dropdownResults,
      selectedIndex,
      handleSelect,
      clearSearch,
      searchInputRef,
    ],
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
          placeholder="Search..."
          aria-label="Search"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? 'header-search-dropdown' : undefined}
          aria-activedescendant={
            showDropdown && dropdownResults.length > 0
              ? `search-result-${selectedIndex}`
              : undefined
          }
        />
        {query ? (
          <button
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
        ) : (
          <kbd className="header-search-bar-shortcut">{isMac ? '\u2318K' : 'Ctrl+K'}</kbd>
        )}
      </div>

      {showDropdown &&
        createPortal(
          <div className="search-dropdown" id="header-search-dropdown" style={dropdownStyle}>
            {isListFilteringTab && query && (
              <div className="search-dropdown-context">Filtering {activeTab} list</div>
            )}
            {/* Custom combobox dropdown requires ARIA roles - no semantic HTML equivalent */}
            <ul ref={resultsRef} className="search-dropdown-results" role="listbox">
              {/* NOSONAR */}
              {dropdownResults.map((result, index) => (
                <li // NOSONAR - combobox pattern requires role="option" on li
                  key={result.id}
                  className={`search-dropdown-item ${index === selectedIndex ? 'is-selected' : ''}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                >
                  <button
                    type="button"
                    data-index={index}
                    id={`search-result-${index}`}
                    className="search-dropdown-hitbox"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelect(result);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div className="search-dropdown-result-icon">
                      <RenderIcon result={result} />
                    </div>
                    <div className="search-dropdown-result-info">
                      <div className="search-dropdown-result-title">{result.title}</div>
                      {result.subtitle && (
                        <div className="search-dropdown-result-subtitle">{result.subtitle}</div>
                      )}
                    </div>
                    <div className="search-dropdown-result-type">{result.type}</div>
                  </button>
                </li>
              ))}
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
