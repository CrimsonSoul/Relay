import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SearchProvider, useSearchContext } from '../SearchContext';

const searchInputRef = { current: null };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

let activeTab = 'Compose';

function renderSearch() {
  return renderHook(() => useSearchContext(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <SearchProvider activeTab={activeTab} searchInputRef={searchInputRef}>
        {children}
      </SearchProvider>
    ),
  });
}

function switchTab(rerender: () => void, tab: string) {
  activeTab = tab;
  rerender();
}

it('never filters a newly opened tab by the previous tab query', () => {
  activeTab = 'Compose';
  const view = renderSearch();
  act(() => view.result.current.setQuery('oracle'));
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(view.result.current.debouncedQuery).toBe('oracle');

  switchTab(view.rerender, 'Servers');
  expect(view.result.current.query).toBe('');
  expect(view.result.current.debouncedQuery).toBe('');

  // Returning to the original tab before the debounce settles must not revive the old query.
  switchTab(view.rerender, 'Compose');
  expect(view.result.current.debouncedQuery).toBe('');
});
