import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useDebounce } from '../hooks/useDebounce';

type SearchContextValue = {
  query: string;
  setQuery: (q: string) => void;
  debouncedQuery: string;
  isSearchFocused: boolean;
  setIsSearchFocused: (v: boolean) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  focusSearch: () => void;
  clearSearch: () => void;
};

const SearchContext = createContext<SearchContextValue | null>(null);

export function SearchProvider({
  activeTab,
  searchInputRef,
  children,
}: Readonly<{
  activeTab: string;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  children: ReactNode;
}>) {
  const [query, setQuery] = useState('');
  // Clear search when switching tabs. Resetting during render keeps the new tab from ever
  // rendering with the old query.
  const [queryTab, setQueryTab] = useState(activeTab);
  const [tabVisit, setTabVisit] = useState(0);
  if (queryTab !== activeTab) {
    setQueryTab(activeTab);
    setTabVisit((visit) => visit + 1);
    setQuery('');
  }
  // The debounced query belongs to the tab visit it was typed in; a later visit, even to the
  // same tab, never filters by it.
  const pendingSearch = useMemo(() => ({ query, tabVisit }), [query, tabVisit]);
  const debouncedSearch = useDebounce(pendingSearch, 300);
  const debouncedQuery = debouncedSearch.tabVisit === tabVisit ? debouncedSearch.query : '';
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const clearSearch = useCallback(() => setQuery(''), []);
  const focusSearch = useCallback(() => searchInputRef.current?.focus(), [searchInputRef]);

  const value = useMemo(
    () => ({
      query,
      setQuery,
      debouncedQuery,
      isSearchFocused,
      setIsSearchFocused,
      searchInputRef,
      focusSearch,
      clearSearch,
    }),
    // setQuery and setIsSearchFocused are React state setters (guaranteed stable) and omitted
    [query, debouncedQuery, isSearchFocused, searchInputRef, focusSearch, clearSearch],
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearchContext() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearchContext must be used within SearchProvider');
  return ctx;
}

/** For surfaces that may render outside the app shell (isolated tests, previews). */
export function useOptionalSearchContext() {
  return useContext(SearchContext);
}
