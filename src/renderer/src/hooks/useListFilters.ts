import { useState, useMemo, useCallback, useEffect } from 'react';
import type { NoteEntry } from '@shared/ipc';
import { secureStorage } from '../utils/secureStorage';

export type FilterDef<T> = {
  key: string;
  label: string;
  // Declared method-style on purpose. As a property-style function type this is
  // contravariant under strictFunctionTypes, so a FilterDef<Contact>[] would not
  // satisfy the FilterDef<unknown>[] that ListFilters accepts — and the only
  // in-place workaround was rewriting every predicate against `unknown`, losing
  // the compile-time link to the item type. Method syntax is bivariant, which is
  // the intended relationship here: ListFilters never calls predicate.
  predicate(item: T): boolean;
};

type UseListFiltersOptions<T> = {
  items: T[];
  tagSourceItems?: T[];
  getNote: (item: T) => NoteEntry | undefined;
  extraFilters?: FilterDef<T>[];
  /** secureStorage key that keeps this tab's chip selections across sessions. */
  storageKey: string;
};

type StoredListFilters = {
  hasNotes: boolean;
  tags: string[];
  extras: string[];
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

// Each field falls back to its default on its own, so one corrupt field never discards the rest.
function readStoredListFilters(storageKey: string): StoredListFilters {
  const stored = secureStorage.getItemSync<unknown>(storageKey);
  const record =
    typeof stored === 'object' && stored !== null ? (stored as Partial<StoredListFilters>) : {};
  return {
    hasNotes: record.hasNotes === true,
    tags: isStringArray(record.tags) ? record.tags : [],
    extras: isStringArray(record.extras) ? record.extras : [],
  };
}

export function useListFilters<T>({
  items,
  tagSourceItems,
  getNote,
  extraFilters = [],
  storageKey,
}: UseListFiltersOptions<T>) {
  const [initial] = useState(() => readStoredListFilters(storageKey));
  const [hasNotesFilter, setHasNotesFilter] = useState(initial.hasNotes);
  // Raw selection as the user set it; tags missing from the current data stay stored so a
  // restored selection survives notes loading after the list.
  const [storedTags, setStoredTags] = useState<Set<string>>(() => new Set(initial.tags));
  const [activeExtras, setActiveExtras] = useState<Set<string>>(() => new Set(initial.extras));

  useEffect(() => {
    secureStorage.setItemSync<StoredListFilters>(storageKey, {
      hasNotes: hasNotesFilter,
      tags: Array.from(storedTags),
      extras: Array.from(activeExtras),
    });
  }, [storageKey, hasNotesFilter, storedTags, activeExtras]);

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

  // Only tags that still exist in the data are applied and shown as selected.
  const selectedTags = useMemo(() => {
    const available = new Set(availableTags);
    const next = new Set<string>();
    for (const tag of storedTags) {
      if (available.has(tag)) next.add(tag);
    }
    return next;
  }, [availableTags, storedTags]);

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
    setStoredTags((prev) => {
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
    setStoredTags(new Set());
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
