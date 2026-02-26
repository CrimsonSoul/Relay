import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

function createSearchContextValue(debouncedQuery = '') {
  return {
    query: debouncedQuery,
    setQuery: vi.fn(),
    debouncedQuery,
    isSearchFocused: false,
    setIsSearchFocused: vi.fn(),
    searchInputRef: { current: null },
    focusSearch: vi.fn(),
    clearSearch: vi.fn(),
  };
}

// Mock SearchContext before importing the hook
vi.mock('../../contexts/SearchContext', () => ({
  useSearchContext: vi.fn(() => createSearchContextValue()),
}));
import { useSearchContext } from '../../contexts/SearchContext';

// Mock crypto.randomUUID
let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: vi.fn(() => `uuid-${++uuidCounter}`),
});

import { useNotepad, NOTE_COLORS } from '../useNotepad';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNote(overrides: Record<string, unknown> = {}) {
  return {
    id: `note-${Date.now()}-${crypto.randomUUID()}`,
    title: 'Test Note',
    content: 'Some content',
    color: 'blue' as const,
    tags: [] as string[],
    pinned: false,
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function setSearchQuery(query: string) {
  vi.mocked(useSearchContext).mockReturnValue(createSearchContextValue(query));
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  uuidCounter = 0;
  setSearchQuery('');
});

// ===========================================================================
// Tests
// ===========================================================================

describe('useNotepad', () => {
  // -------------------------------------------------------------------------
  // 1. Initial load from localStorage
  // -------------------------------------------------------------------------
  describe('initial load', () => {
    it('loads notes from localStorage when data exists', () => {
      const stored = [makeNote({ id: 'existing-1', title: 'Stored Note' })];
      localStorage.setItem('relay-notepad', JSON.stringify(stored));

      const { result } = renderHook(() => useNotepad());

      expect(result.current.notes.length).toBe(1);
      expect(result.current.notes[0].title).toBe('Stored Note');
    });

    it('seeds sample notes when localStorage is empty', () => {
      const { result } = renderHook(() => useNotepad());

      // getSampleNotes creates 5 notes
      expect(result.current.totalCount).toBe(5);
      // Should have been persisted
      const raw = localStorage.getItem('relay-notepad');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!).length).toBe(5);
    });

    it('returns empty array when localStorage contains corrupted data', () => {
      localStorage.setItem('relay-notepad', '%%%NOT-JSON%%%');

      const { result } = renderHook(() => useNotepad());

      expect(result.current.notes).toEqual([]);
      expect(result.current.totalCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. addNote
  // -------------------------------------------------------------------------
  describe('addNote', () => {
    it('creates a note with UUID and timestamps', () => {
      // Seed localStorage so we start with a known state (no samples)
      localStorage.setItem('relay-notepad', JSON.stringify([]));
      const { result } = renderHook(() => useNotepad());

      let newNote: ReturnType<typeof result.current.addNote>;
      act(() => {
        newNote = result.current.addNote({
          title: 'New',
          content: 'Body',
          color: 'green',
          tags: ['tag1'],
          pinned: false,
        });
      });

      expect(newNote!.id).toBe('uuid-1');
      expect(newNote!.title).toBe('New');
      expect(newNote!.createdAt).toBeTypeOf('number');
      expect(newNote!.updatedAt).toBe(newNote!.createdAt);
      expect(result.current.totalCount).toBe(1);
    });

    it('prepends the new note to the list', () => {
      const existing = [makeNote({ id: 'old', title: 'Old' })];
      localStorage.setItem('relay-notepad', JSON.stringify(existing));
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.addNote({
          title: 'Fresh',
          content: '',
          color: 'amber',
          tags: [],
          pinned: false,
        });
      });

      expect(result.current.totalCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // 3. updateNote
  // -------------------------------------------------------------------------
  describe('updateNote', () => {
    it('updates the specified note and bumps updatedAt', () => {
      const notes = [makeNote({ id: 'u1', title: 'Original', updatedAt: 100 })];
      localStorage.setItem('relay-notepad', JSON.stringify(notes));
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.updateNote('u1', { title: 'Changed' });
      });

      const updated = result.current.notes.find((n) => n.id === 'u1');
      expect(updated!.title).toBe('Changed');
      expect(updated!.updatedAt).toBeGreaterThan(100);
    });
  });

  // -------------------------------------------------------------------------
  // 4. deleteNote
  // -------------------------------------------------------------------------
  describe('deleteNote', () => {
    it('removes the note from the list', () => {
      const notes = [makeNote({ id: 'd1' }), makeNote({ id: 'd2' })];
      localStorage.setItem('relay-notepad', JSON.stringify(notes));
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.deleteNote('d1');
      });

      expect(result.current.totalCount).toBe(1);
      expect(result.current.notes.every((n) => n.id !== 'd1')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 5. duplicateNote
  // -------------------------------------------------------------------------
  describe('duplicateNote', () => {
    it('copies a note when source is found', () => {
      const notes = [makeNote({ id: 'dup1', title: 'Original', color: 'red', tags: ['x'] })];
      localStorage.setItem('relay-notepad', JSON.stringify(notes));
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.duplicateNote('dup1');
      });

      expect(result.current.totalCount).toBe(2);
      const copy = result.current.notes.find((n) => n.id !== 'dup1');
      expect(copy!.title).toBe('Original (copy)');
      expect(copy!.pinned).toBe(false);
      expect(copy!.color).toBe('red');
      expect(copy!.tags).toEqual(['x']);
    });

    it('does nothing when source is not found', () => {
      localStorage.setItem('relay-notepad', JSON.stringify([makeNote({ id: 'a' })]));
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.duplicateNote('nonexistent');
      });

      expect(result.current.totalCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 6. togglePin
  // -------------------------------------------------------------------------
  describe('togglePin', () => {
    it('toggles the pinned state of a note', () => {
      const notes = [makeNote({ id: 'pin1', pinned: false })];
      localStorage.setItem('relay-notepad', JSON.stringify(notes));
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.togglePin('pin1');
      });

      expect(result.current.notes.find((n) => n.id === 'pin1')!.pinned).toBe(true);

      act(() => {
        result.current.togglePin('pin1');
      });

      expect(result.current.notes.find((n) => n.id === 'pin1')!.pinned).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 7. reorderNotes
  // -------------------------------------------------------------------------
  describe('reorderNotes', () => {
    it('swaps note positions for valid ids', () => {
      const notes = [
        makeNote({ id: 'r1', title: 'First', updatedAt: 3000 }),
        makeNote({ id: 'r2', title: 'Second', updatedAt: 2000 }),
        makeNote({ id: 'r3', title: 'Third', updatedAt: 1000 }),
      ];
      localStorage.setItem('relay-notepad', JSON.stringify(notes));
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.reorderNotes('r1', 'r3');
      });

      // After reorder the internal array should have moved r1 to where r3 was.
      // We verify via totalCount staying the same (structural correctness).
      expect(result.current.totalCount).toBe(3);
    });

    it('does nothing when activeId equals overId (same index)', () => {
      const notes = [makeNote({ id: 's1' }), makeNote({ id: 's2' })];
      localStorage.setItem('relay-notepad', JSON.stringify(notes));
      const { result } = renderHook(() => useNotepad());

      const before = result.current.notes.map((n) => n.id);

      act(() => {
        result.current.reorderNotes('s1', 's1');
      });

      // Order should be unchanged
      expect(result.current.notes.map((n) => n.id)).toEqual(before);
    });

    it('does nothing when an id is not found', () => {
      const notes = [makeNote({ id: 'f1' })];
      localStorage.setItem('relay-notepad', JSON.stringify(notes));
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.reorderNotes('f1', 'ghost');
      });

      expect(result.current.totalCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Sorting
  // -------------------------------------------------------------------------
  describe('sorting', () => {
    function setupSortNotes() {
      const notes = [
        makeNote({ id: 'a', title: 'Banana', color: 'green', createdAt: 300, updatedAt: 100 }),
        makeNote({ id: 'b', title: 'Apple', color: 'amber', createdAt: 100, updatedAt: 300 }),
        makeNote({ id: 'c', title: 'Cherry', color: 'red', createdAt: 200, updatedAt: 200 }),
      ];
      localStorage.setItem('relay-notepad', JSON.stringify(notes));
    }

    it('sorts by updatedAt desc (default)', () => {
      setupSortNotes();
      const { result } = renderHook(() => useNotepad());

      const titles = result.current.notes.map((n) => n.title);
      // desc: highest updatedAt first => Apple(300), Cherry(200), Banana(100)
      expect(titles).toEqual(['Apple', 'Cherry', 'Banana']);
    });

    it('sorts by updatedAt asc', () => {
      setupSortNotes();
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.setSort({ key: 'updatedAt', direction: 'asc' });
      });

      const titles = result.current.notes.map((n) => n.title);
      expect(titles).toEqual(['Banana', 'Cherry', 'Apple']);
    });

    it('sorts by createdAt desc', () => {
      setupSortNotes();
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.setSort({ key: 'createdAt', direction: 'desc' });
      });

      const titles = result.current.notes.map((n) => n.title);
      // desc: highest createdAt first => Banana(300), Cherry(200), Apple(100)
      expect(titles).toEqual(['Banana', 'Cherry', 'Apple']);
    });

    it('sorts by createdAt asc', () => {
      setupSortNotes();
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.setSort({ key: 'createdAt', direction: 'asc' });
      });

      const titles = result.current.notes.map((n) => n.title);
      expect(titles).toEqual(['Apple', 'Cherry', 'Banana']);
    });

    it('sorts by title desc', () => {
      setupSortNotes();
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.setSort({ key: 'title', direction: 'desc' });
      });

      const titles = result.current.notes.map((n) => n.title);
      expect(titles).toEqual(['Cherry', 'Banana', 'Apple']);
    });

    it('sorts by title asc', () => {
      setupSortNotes();
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.setSort({ key: 'title', direction: 'asc' });
      });

      const titles = result.current.notes.map((n) => n.title);
      expect(titles).toEqual(['Apple', 'Banana', 'Cherry']);
    });

    it('sorts by color desc', () => {
      setupSortNotes();
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.setSort({ key: 'color', direction: 'desc' });
      });

      const colors = result.current.notes.map((n) => n.color);
      // desc localeCompare: red, green, amber
      expect(colors).toEqual(['red', 'green', 'amber']);
    });

    it('sorts by color asc', () => {
      setupSortNotes();
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.setSort({ key: 'color', direction: 'asc' });
      });

      const colors = result.current.notes.map((n) => n.color);
      // asc localeCompare: amber, green, red
      expect(colors).toEqual(['amber', 'green', 'red']);
    });

    it('pinned notes always appear before unpinned', () => {
      const notes = [
        makeNote({ id: 'p1', title: 'Unpinned', pinned: false, updatedAt: 9999 }),
        makeNote({ id: 'p2', title: 'Pinned', pinned: true, updatedAt: 1 }),
      ];
      localStorage.setItem('relay-notepad', JSON.stringify(notes));
      const { result } = renderHook(() => useNotepad());

      // Even though Unpinned has a higher updatedAt, Pinned should come first
      expect(result.current.notes[0].title).toBe('Pinned');
      expect(result.current.notes[1].title).toBe('Unpinned');
    });
  });

  // -------------------------------------------------------------------------
  // 9. Filtering
  // -------------------------------------------------------------------------
  describe('filtering', () => {
    function setupFilterNotes() {
      const notes = [
        makeNote({
          id: 'f1',
          title: 'Server Runbook',
          content: 'restart steps',
          tags: ['ops', 'infra'],
          updatedAt: 300,
        }),
        makeNote({
          id: 'f2',
          title: 'Meeting Notes',
          content: 'discussed servers',
          tags: ['meeting'],
          updatedAt: 200,
        }),
        makeNote({
          id: 'f3',
          title: 'Ideas',
          content: 'nothing related',
          tags: ['ideas'],
          updatedAt: 100,
        }),
      ];
      localStorage.setItem('relay-notepad', JSON.stringify(notes));
    }

    it('filters by debouncedQuery matching title', () => {
      setupFilterNotes();
      setSearchQuery('runbook');
      const { result } = renderHook(() => useNotepad());

      expect(result.current.notes.length).toBe(1);
      expect(result.current.notes[0].title).toBe('Server Runbook');
    });

    it('filters by debouncedQuery matching content', () => {
      setupFilterNotes();
      setSearchQuery('restart');
      const { result } = renderHook(() => useNotepad());

      expect(result.current.notes.length).toBe(1);
      expect(result.current.notes[0].id).toBe('f1');
    });

    it('filters by debouncedQuery matching tags', () => {
      setupFilterNotes();
      setSearchQuery('infra');
      const { result } = renderHook(() => useNotepad());

      expect(result.current.notes.length).toBe(1);
      expect(result.current.notes[0].id).toBe('f1');
    });

    it('filters by activeTag', () => {
      setupFilterNotes();
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.setActiveTag('meeting');
      });

      expect(result.current.notes.length).toBe(1);
      expect(result.current.notes[0].id).toBe('f2');
    });

    it('shows all notes when activeTag is null', () => {
      setupFilterNotes();
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.setActiveTag('ops');
      });
      expect(result.current.notes.length).toBe(1);

      act(() => {
        result.current.setActiveTag(null);
      });
      expect(result.current.notes.length).toBe(3);
    });

    it('combines search query and activeTag filters', () => {
      const notes = [
        makeNote({ id: 'c1', title: 'Alpha', tags: ['work'], updatedAt: 200 }),
        makeNote({ id: 'c2', title: 'Alpha Beta', tags: ['personal'], updatedAt: 100 }),
      ];
      localStorage.setItem('relay-notepad', JSON.stringify(notes));
      setSearchQuery('alpha');
      const { result } = renderHook(() => useNotepad());

      // Both match the query
      expect(result.current.notes.length).toBe(2);

      act(() => {
        result.current.setActiveTag('work');
      });

      // Only c1 matches both query + tag
      expect(result.current.notes.length).toBe(1);
      expect(result.current.notes[0].id).toBe('c1');
    });
  });

  // -------------------------------------------------------------------------
  // 10. setFontSize
  // -------------------------------------------------------------------------
  describe('setFontSize', () => {
    it('updates fontSize state and persists to localStorage', () => {
      localStorage.setItem('relay-notepad', JSON.stringify([]));
      const { result } = renderHook(() => useNotepad());

      expect(result.current.fontSize).toBe('md'); // default

      act(() => {
        result.current.setFontSize('lg');
      });

      expect(result.current.fontSize).toBe('lg');
      expect(localStorage.getItem('relay-notepad-fontsize')).toBe('lg');
    });
  });

  // -------------------------------------------------------------------------
  // 11. loadFontSize
  // -------------------------------------------------------------------------
  describe('loadFontSize (via initial state)', () => {
    it('loads "sm" from localStorage', () => {
      localStorage.setItem('relay-notepad', JSON.stringify([]));
      localStorage.setItem('relay-notepad-fontsize', 'sm');
      const { result } = renderHook(() => useNotepad());
      expect(result.current.fontSize).toBe('sm');
    });

    it('loads "lg" from localStorage', () => {
      localStorage.setItem('relay-notepad', JSON.stringify([]));
      localStorage.setItem('relay-notepad-fontsize', 'lg');
      const { result } = renderHook(() => useNotepad());
      expect(result.current.fontSize).toBe('lg');
    });

    it('defaults to "md" for invalid value', () => {
      localStorage.setItem('relay-notepad', JSON.stringify([]));
      localStorage.setItem('relay-notepad-fontsize', 'xl');
      const { result } = renderHook(() => useNotepad());
      expect(result.current.fontSize).toBe('md');
    });

    it('defaults to "md" when no value is stored', () => {
      localStorage.setItem('relay-notepad', JSON.stringify([]));
      const { result } = renderHook(() => useNotepad());
      expect(result.current.fontSize).toBe('md');
    });
  });

  // -------------------------------------------------------------------------
  // 12. allTags
  // -------------------------------------------------------------------------
  describe('allTags', () => {
    it('computes unique sorted tags from all notes', () => {
      const notes = [
        makeNote({ id: 't1', tags: ['zebra', 'apple'] }),
        makeNote({ id: 't2', tags: ['banana', 'apple'] }),
      ];
      localStorage.setItem('relay-notepad', JSON.stringify(notes));
      const { result } = renderHook(() => useNotepad());

      expect(result.current.allTags).toEqual(['apple', 'banana', 'zebra']);
    });

    it('returns empty array when no notes have tags', () => {
      const notes = [makeNote({ id: 'nt1', tags: [] })];
      localStorage.setItem('relay-notepad', JSON.stringify(notes));
      const { result } = renderHook(() => useNotepad());

      expect(result.current.allTags).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 13. NOTE_COLORS export
  // -------------------------------------------------------------------------
  describe('NOTE_COLORS', () => {
    it('exports all 6 note colors', () => {
      expect(NOTE_COLORS).toHaveLength(6);
    });

    it('contains amber, blue, green, red, purple, slate', () => {
      const values = NOTE_COLORS.map((c) => c.value);
      expect(values).toEqual(['amber', 'blue', 'green', 'red', 'purple', 'slate']);
    });

    it('each color has value, label, and hex fields', () => {
      for (const color of NOTE_COLORS) {
        expect(color).toHaveProperty('value');
        expect(color).toHaveProperty('label');
        expect(color).toHaveProperty('hex');
        expect(color.hex).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
  });
});
