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

// Mock secureStorage with an in-memory store
const secureStore = new Map<string, unknown>();
vi.mock('../../utils/secureStorage', () => ({
  secureStorage: {
    getItemSync: vi.fn((key: string, defaultValue?: unknown) => {
      const val = secureStore.get(key);
      return val !== undefined ? val : defaultValue;
    }),
    setItemSync: vi.fn((key: string, value: unknown) => {
      secureStore.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      secureStore.delete(key);
    }),
    clear: vi.fn(() => {
      secureStore.clear();
    }),
    getItem: vi.fn(async (key: string, defaultValue?: unknown) => {
      const val = secureStore.get(key);
      return val !== undefined ? val : defaultValue;
    }),
    setItem: vi.fn(async (key: string, value: unknown) => {
      secureStore.set(key, value);
    }),
  },
}));

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
  secureStore.clear();
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
      secureStore.set('relay-notepad', stored);

      const { result } = renderHook(() => useNotepad());

      expect(result.current.notes.length).toBe(1);
      expect(result.current.notes[0].title).toBe('Stored Note');
    });

    it('seeds sample notes when localStorage is empty', () => {
      const { result } = renderHook(() => useNotepad());

      // getSampleNotes creates 5 notes
      expect(result.current.totalCount).toBe(5);
      // Should have been persisted
      const raw = secureStore.get('relay-notepad') as unknown[];
      expect(raw).toBeDefined();
      expect(raw.length).toBe(5);
    });

    it('returns empty array when localStorage contains corrupted data', () => {
      secureStore.set('relay-notepad', '%%%NOT-JSON%%%');

      const { result } = renderHook(() => useNotepad());

      expect(result.current.notes).toEqual([]);
      expect(result.current.totalCount).toBe(0);
    });

    it('migrates legacy pinned notes on load', () => {
      secureStore.set('relay-notepad', [
        {
          id: 'legacy-1',
          title: 'Legacy note',
          content: 'legacy content',
          color: 'amber',
          tags: ['legacy'],
          pinned: true,
          createdAt: 100,
          updatedAt: 200,
        },
      ]);

      const { result } = renderHook(() => useNotepad());

      expect(result.current.notes).toHaveLength(1);
      expect('pinned' in result.current.notes[0]).toBe(false);

      const stored = secureStore.get('relay-notepad') as Record<string, unknown>[];
      expect(stored[0]).not.toHaveProperty('pinned');
    });
  });

  // -------------------------------------------------------------------------
  // 2. addNote
  // -------------------------------------------------------------------------
  describe('addNote', () => {
    it('creates a note with UUID and timestamps', () => {
      // Seed localStorage so we start with a known state (no samples)
      secureStore.set('relay-notepad', []);
      const { result } = renderHook(() => useNotepad());

      let newNote: ReturnType<typeof result.current.addNote>;
      act(() => {
        newNote = result.current.addNote({
          title: 'New',
          content: 'Body',
          color: 'green',
          tags: ['tag1'],
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
      secureStore.set('relay-notepad', existing);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.addNote({
          title: 'Fresh',
          content: '',
          color: 'amber',
          tags: [],
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
      secureStore.set('relay-notepad', notes);
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
      secureStore.set('relay-notepad', notes);
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
      secureStore.set('relay-notepad', notes);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.duplicateNote('dup1');
      });

      expect(result.current.totalCount).toBe(2);
      const copy = result.current.notes.find((n) => n.id !== 'dup1');
      expect(copy!.title).toBe('Original (copy)');
      expect(copy!.color).toBe('red');
      expect(copy!.tags).toEqual(['x']);
    });

    it('does nothing when source is not found', () => {
      secureStore.set('relay-notepad', [makeNote({ id: 'a' })]);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.duplicateNote('nonexistent');
      });

      expect(result.current.totalCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 6. reorderNotes
  // -------------------------------------------------------------------------
  describe('reorderNotes', () => {
    it('swaps notes for valid ids', () => {
      const notes = [
        makeNote({ id: 'r1', title: 'First' }),
        makeNote({ id: 'r2', title: 'Second' }),
        makeNote({ id: 'r3', title: 'Third' }),
      ];
      secureStore.set('relay-notepad', notes);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.reorderNotes('r1', 'r3');
      });

      expect(result.current.notes.map((n) => n.id)).toEqual(['r3', 'r2', 'r1']);
    });

    it('does nothing when activeId equals overId (same index)', () => {
      const notes = [makeNote({ id: 's1' }), makeNote({ id: 's2' })];
      secureStore.set('relay-notepad', notes);
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
      secureStore.set('relay-notepad', notes);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.reorderNotes('f1', 'ghost');
      });

      expect(result.current.totalCount).toBe(1);
    });

    it('reorders only visible notes when visibleIds are provided', () => {
      const notes = [
        makeNote({ id: 'a', tags: ['ops'] }),
        makeNote({ id: 'b', tags: ['infra'] }),
        makeNote({ id: 'c', tags: ['ops'] }),
        makeNote({ id: 'd', tags: ['infra'] }),
      ];
      secureStore.set('relay-notepad', notes);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.reorderNotes('c', 'a', ['a', 'c']);
      });

      expect(result.current.notes.map((n) => n.id)).toEqual(['c', 'b', 'a', 'd']);
    });
  });

  // -------------------------------------------------------------------------
  // 7. setVisibleOrder
  // -------------------------------------------------------------------------
  describe('setVisibleOrder', () => {
    it('applies full visible order when all notes are visible', () => {
      const notes = [makeNote({ id: 'a' }), makeNote({ id: 'b' }), makeNote({ id: 'c' })];
      secureStore.set('relay-notepad', notes);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.setVisibleOrder(['b', 'c', 'a']);
      });

      expect(result.current.notes.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    });

    it('applies ordered visible subset while keeping hidden notes in place', () => {
      const notes = [
        makeNote({ id: 'a', tags: ['ops'] }),
        makeNote({ id: 'b', tags: ['infra'] }),
        makeNote({ id: 'c', tags: ['ops'] }),
        makeNote({ id: 'd', tags: ['infra'] }),
      ];
      secureStore.set('relay-notepad', notes);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.setVisibleOrder(['c', 'a'], ['a', 'c']);
      });

      expect(result.current.notes.map((n) => n.id)).toEqual(['c', 'b', 'a', 'd']);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Filtering
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
      secureStore.set('relay-notepad', notes);
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
      secureStore.set('relay-notepad', notes);
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
      secureStore.set('relay-notepad', []);
      const { result } = renderHook(() => useNotepad());

      expect(result.current.fontSize).toBe('md'); // default

      act(() => {
        result.current.setFontSize('lg');
      });

      expect(result.current.fontSize).toBe('lg');
      expect(secureStore.get('notepad-fontsize')).toBe('lg');
    });
  });

  // -------------------------------------------------------------------------
  // 11. loadFontSize
  // -------------------------------------------------------------------------
  describe('loadFontSize (via initial state)', () => {
    it('loads "sm" from secureStorage', () => {
      secureStore.set('relay-notepad', []);
      secureStore.set('notepad-fontsize', 'sm');
      const { result } = renderHook(() => useNotepad());
      expect(result.current.fontSize).toBe('sm');
    });

    it('loads "lg" from secureStorage', () => {
      secureStore.set('relay-notepad', []);
      secureStore.set('notepad-fontsize', 'lg');
      const { result } = renderHook(() => useNotepad());
      expect(result.current.fontSize).toBe('lg');
    });

    it('defaults to "md" for invalid value', () => {
      secureStore.set('relay-notepad', []);
      secureStore.set('notepad-fontsize', 'xl');
      const { result } = renderHook(() => useNotepad());
      expect(result.current.fontSize).toBe('md');
    });

    it('defaults to "md" when no value is stored', () => {
      secureStore.set('relay-notepad', []);
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
      secureStore.set('relay-notepad', notes);
      const { result } = renderHook(() => useNotepad());

      expect(result.current.allTags).toEqual(['apple', 'banana', 'zebra']);
    });

    it('returns empty array when no notes have tags', () => {
      const notes = [makeNote({ id: 'nt1', tags: [] })];
      secureStore.set('relay-notepad', notes);
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
