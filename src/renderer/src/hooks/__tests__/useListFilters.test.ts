import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useListFilters, type FilterDef } from '../useListFilters';

type Item = { id: string };

describe('useListFilters', () => {
  const items: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  const notesById: Record<string, { tags?: string[] } | undefined> = {
    a: { tags: ['zeta', 'alpha'] },
    b: { tags: ['beta'] },
    c: undefined,
  };

  const getNote = (item: Item) => notesById[item.id];

  const extraFilters: FilterDef<Item>[] = [
    {
      key: 'is-a',
      label: 'Only A',
      predicate: (item) => item.id === 'a',
    },
  ];

  it('collects sorted tags and applies note/tag/extra filters', () => {
    const { result } = renderHook(() =>
      useListFilters({ items, getNote, extraFilters, tagSourceItems: items }),
    );

    expect(result.current.availableTags).toEqual(['alpha', 'beta', 'zeta']);
    expect(result.current.filteredItems.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.isAnyFilterActive).toBe(false);

    act(() => {
      result.current.toggleHasNotes();
    });
    expect(result.current.filteredItems.map((i) => i.id)).toEqual(['a', 'b']);

    act(() => {
      result.current.toggleTag('alpha');
    });
    expect(result.current.filteredItems.map((i) => i.id)).toEqual(['a']);

    act(() => {
      result.current.toggleExtra('is-a');
    });
    expect(result.current.filteredItems.map((i) => i.id)).toEqual(['a']);
    expect(result.current.isAnyFilterActive).toBe(true);

    act(() => {
      result.current.clearAll();
    });
    expect(result.current.filteredItems.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(result.current.selectedTags.size).toBe(0);
    expect(result.current.activeExtras.size).toBe(0);
    expect(result.current.hasNotesFilter).toBe(false);
  });

  it('prunes selected tags when tags disappear from source items', () => {
    const { result, rerender } = renderHook(
      ({ currentItems }: { currentItems: Item[] }) =>
        useListFilters({ items: currentItems, getNote, tagSourceItems: currentItems }),
      { initialProps: { currentItems: items } },
    );

    act(() => {
      result.current.toggleTag('beta');
    });
    expect(result.current.selectedTags.has('beta')).toBe(true);

    const onlyA = [{ id: 'a' }];
    rerender({ currentItems: onlyA });

    expect(result.current.availableTags).toEqual(['alpha', 'zeta']);
    expect(result.current.selectedTags.has('beta')).toBe(false);
  });

  it('toggles tags and extras off when selected twice', () => {
    const { result } = renderHook(() => useListFilters({ items, getNote, extraFilters }));

    act(() => {
      result.current.toggleTag('alpha');
      result.current.toggleExtra('is-a');
    });

    expect(result.current.selectedTags.has('alpha')).toBe(true);
    expect(result.current.activeExtras.has('is-a')).toBe(true);

    act(() => {
      result.current.toggleTag('alpha');
      result.current.toggleExtra('is-a');
    });

    expect(result.current.selectedTags.has('alpha')).toBe(false);
    expect(result.current.activeExtras.has('is-a')).toBe(false);
  });
});
