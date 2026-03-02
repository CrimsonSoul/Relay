import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
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
  const debouncedQuery = useDebounce(query, 300);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const clearSearch = useCallback(() => setQuery(''), []);
  const focusSearch = useCallback(() => searchInputRef.current?.focus(), [searchInputRef]);

  // Clear search when switching tabs
  useEffect(() => {
    setQuery('');
  }, [activeTab]);

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
    [
      query,
      setQuery,
      debouncedQuery,
      isSearchFocused,
      setIsSearchFocused,
      searchInputRef,
      focusSearch,
      clearSearch,
    ],
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearchContext() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error('useSearchContext must be used within SearchProvider');
  return ctx;
}
