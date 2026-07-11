import { useState, useCallback, useMemo } from 'react';
import type { NoteColor } from '@shared/ipc';
import type { FontSize } from '../tabs/notes/types';
import { useSearchContext } from '../contexts/SearchContext';
import { useNoteStorage } from './useNoteStorage';
import { secureStorage } from '../utils/secureStorage';

const FONT_SIZE_KEY = 'notepad-fontsize';

function loadFontSize(): FontSize {
  try {
    const raw = secureStorage.getItemSync<string>(FONT_SIZE_KEY);
    if (raw === 'sm' || raw === 'md' || raw === 'lg') return raw;
  } catch {
    /* ignore */
  }
  return 'md';
}

/**
 * Orchestrates notepad UI state (search, tag filter, font size) on top of
 * the underlying note CRUD provided by useNoteStorage.
 */
export function useNotepad() {
  const { debouncedQuery } = useSearchContext();
  const storage = useNoteStorage();
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [fontSize, setFontSizeRaw] = useState<FontSize>(loadFontSize); // NOSONAR - wrapper setFontSize below persists to localStorage

  const setFontSize = useCallback((size: FontSize) => {
    setFontSizeRaw(size);
    try {
      secureStorage.setItemSync(FONT_SIZE_KEY, size);
    } catch {
      /* ignore */
    }
  }, []);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    storage.notes.forEach((n) => n.tags.forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [storage.notes]);

  const filteredNotes = useMemo(() => {
    let result = [...storage.notes];

    // Filter by global search
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase();
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    // Filter by tag
    if (activeTag) {
      result = result.filter((n) => n.tags.includes(activeTag));
    }

    return result;
  }, [storage.notes, debouncedQuery, activeTag]);

  return {
    notes: filteredNotes,
    totalCount: storage.notes.length,
    allTags,
    activeTag,
    setActiveTag,
    fontSize,
    setFontSize,
    addNote: storage.addNote,
    updateNote: storage.updateNote,
    deleteNote: storage.deleteNote,
    duplicateNote: storage.duplicateNote,
    reorderNotes: storage.reorderNotes,
    setVisibleOrder: storage.setVisibleOrder,
  };
}

export const NOTE_COLORS: { value: NoteColor; label: string; hex: string }[] = [
  { value: 'amber', label: 'Amber', hex: '#ffb000' },
  { value: 'blue', label: 'Blue', hex: '#42a5f5' },
  { value: 'green', label: 'Green', hex: '#2bb24c' },
  { value: 'red', label: 'Red', hex: '#ff4539' },
  { value: 'purple', label: 'Purple', hex: '#c084fc' },
  { value: 'slate', label: 'Slate', hex: '#928a90' },
];
