import { useState, useMemo, useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { NoteEntry } from '@shared/ipc';

export type FilterDef<T> = {
  key: string;
  label: string;
  icon?: ReactNode;
  predicate: (item: T) => boolean;
};

type UseListFiltersOptions<T> = {
  items: T[];
  tagSourceItems?: T[];
  getNote: (item: T) => NoteEntry | undefined;
  extraFilters?: FilterDef<T>[];
};

export function useListFilters<T>({
  items,
  tagSourceItems,
  getNote,
  extraFilters = [],
}: UseListFiltersOptions<T>) {
  const [hasNotesFilter, setHasNotesFilter] = useState(false);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [activeExtras, setActiveExtras] = useState<Set<string>>(new Set());

  // Collect tags from a stable source list so tag selections survive list search/filtering.
  const availableTags = useMemo(() => {
    const sourceItems = tagSourceItems ?? items;
    const tags = new Set<string>();
    for (const item of sourceItems) {
      const note = getNote(item);
      if (note?.tags) {
        for (const tag of note.tags) tags.add(tag);
      }
    }
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [items, tagSourceItems, getNote]);

  // Auto-prune selected tags that no longer exist in the data
  useEffect(() => {
    const available = new Set(availableTags);
    setSelectedTags((prev) => {
      let changed = false;
      for (const tag of prev) {
        if (!available.has(tag)) {
          changed = true;
          break;
        }
      }
      if (!changed) return prev;
      const next = new Set<string>();
      for (const tag of prev) {
        if (available.has(tag)) next.add(tag);
      }
      return next;
    });
  }, [availableTags]);

  const isAnyFilterActive = hasNotesFilter || selectedTags.size > 0 || activeExtras.size > 0;

  const filteredItems = useMemo(() => {
    if (!isAnyFilterActive) return items;
    return items.filter((item) => {
      const note = getNote(item);
      if (hasNotesFilter && !note) return false;
      if (selectedTags.size > 0) {
        if (!note?.tags) return false;
        for (const tag of selectedTags) {
          if (!note.tags.includes(tag)) return false;
        }
      }
      for (const filter of extraFilters) {
        if (activeExtras.has(filter.key) && !filter.predicate(item)) return false;
      }
      return true;
    });
  }, [items, hasNotesFilter, selectedTags, activeExtras, getNote, extraFilters, isAnyFilterActive]);

  const toggleHasNotes = useCallback(() => setHasNotesFilter((prev) => !prev), []);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const toggleExtra = useCallback((key: string) => {
    setActiveExtras((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setHasNotesFilter(false);
    setSelectedTags(new Set());
    setActiveExtras(new Set());
  }, []);

  return {
    hasNotesFilter,
    selectedTags,
    activeExtras,
    filteredItems,
    availableTags,
    extraFilters,
    isAnyFilterActive,
    toggleHasNotes,
    toggleTag,
    toggleExtra,
    clearAll,
  };
}
