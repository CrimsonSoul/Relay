import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { StandaloneNote } from '@shared/ipc';

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

// ---------------------------------------------------------------------------
// Mock useNoteStorage — the PB-backed note CRUD layer
// ---------------------------------------------------------------------------

let mockNotes: StandaloneNote[] = [];
const mockAddNote = vi.fn();
const mockUpdateNote = vi.fn();
const mockDeleteNote = vi.fn();
const mockDuplicateNote = vi.fn();
const mockReorderNotes = vi.fn();
const mockSetVisibleOrder = vi.fn();

vi.mock('../useNoteStorage', () => ({
  useNoteStorage: () => ({
    notes: mockNotes,
    addNote: mockAddNote,
    updateNote: mockUpdateNote,
    deleteNote: mockDeleteNote,
    duplicateNote: mockDuplicateNote,
    reorderNotes: mockReorderNotes,
    setVisibleOrder: mockSetVisibleOrder,
  }),
}));

// Mock secureStorage (still used for font size)
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

function makeNote(overrides: Record<string, unknown> = {}): StandaloneNote {
  return {
    id: `note-${Date.now()}-${crypto.randomUUID()}`,
    title: 'Test Note',
    content: 'Some content',
    color: 'blue' as const,
    tags: [] as string[],
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  } as StandaloneNote;
}

function setSearchQuery(query: string) {
  vi.mocked(useSearchContext).mockReturnValue(createSearchContextValue(query));
}

function seedNotes(notes: StandaloneNote[]) {
  mockNotes = notes;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  secureStore.clear();
  mockNotes = [];
  uuidCounter = 0;
  setSearchQuery('');

  // Default addNote mock returns a note object
  mockAddNote.mockImplementation(
    (input: Omit<StandaloneNote, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = Date.now();
      return {
        ...input,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      } as StandaloneNote;
    },
  );
});

// ===========================================================================
// Tests
// ===========================================================================

describe('useNotepad', () => {
  // -------------------------------------------------------------------------
  // 1. Initial load
  // -------------------------------------------------------------------------
  describe('initial load', () => {
    it('loads notes from storage when data exists', () => {
      seedNotes([makeNote({ id: 'existing-1', title: 'Stored Note' })]);

      const { result } = renderHook(() => useNotepad());

      expect(result.current.notes.length).toBe(1);
      expect(result.current.notes[0].title).toBe('Stored Note');
    });

    it('returns empty array when storage is empty', () => {
      seedNotes([]);
      const { result } = renderHook(() => useNotepad());

      expect(result.current.notes).toEqual([]);
      expect(result.current.totalCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 2. addNote — delegates to storage
  // -------------------------------------------------------------------------
  describe('addNote', () => {
    it('creates a note with UUID and timestamps', () => {
      seedNotes([]);
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
    });

    it('delegates to storage.addNote', () => {
      seedNotes([makeNote({ id: 'old', title: 'Old' })]);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.addNote({
          title: 'Fresh',
          content: '',
          color: 'amber',
          tags: [],
        });
      });

      expect(mockAddNote).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Fresh', color: 'amber' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // 3. updateNote — delegates to storage
  // -------------------------------------------------------------------------
  describe('updateNote', () => {
    it('delegates to storage.updateNote with correct args', () => {
      seedNotes([makeNote({ id: 'u1', title: 'Original', updatedAt: 100 })]);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.updateNote('u1', { title: 'Changed' });
      });

      expect(mockUpdateNote).toHaveBeenCalledWith('u1', { title: 'Changed' });
    });
  });

  // -------------------------------------------------------------------------
  // 4. deleteNote — delegates to storage
  // -------------------------------------------------------------------------
  describe('deleteNote', () => {
    it('delegates to storage.deleteNote', () => {
      seedNotes([makeNote({ id: 'd1' }), makeNote({ id: 'd2' })]);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.deleteNote('d1');
      });

      expect(mockDeleteNote).toHaveBeenCalledWith('d1');
    });
  });

  // -------------------------------------------------------------------------
  // 5. duplicateNote — delegates to storage
  // -------------------------------------------------------------------------
  describe('duplicateNote', () => {
    it('delegates to storage.duplicateNote', () => {
      seedNotes([makeNote({ id: 'dup1', title: 'Original', color: 'red', tags: ['x'] })]);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.duplicateNote('dup1');
      });

      expect(mockDuplicateNote).toHaveBeenCalledWith('dup1');
    });

    it('does nothing for nonexistent note (delegates to storage)', () => {
      seedNotes([makeNote({ id: 'a' })]);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.duplicateNote('nonexistent');
      });

      expect(mockDuplicateNote).toHaveBeenCalledWith('nonexistent');
    });
  });

  // -------------------------------------------------------------------------
  // 6. reorderNotes — delegates to storage
  // -------------------------------------------------------------------------
  describe('reorderNotes', () => {
    it('delegates to storage.reorderNotes', () => {
      seedNotes([
        makeNote({ id: 'r1', title: 'First' }),
        makeNote({ id: 'r2', title: 'Second' }),
        makeNote({ id: 'r3', title: 'Third' }),
      ]);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.reorderNotes('r1', 'r3');
      });

      expect(mockReorderNotes).toHaveBeenCalledWith('r1', 'r3');
    });

    it('delegates same-id reorder to storage', () => {
      seedNotes([makeNote({ id: 's1' }), makeNote({ id: 's2' })]);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.reorderNotes('s1', 's1');
      });

      expect(mockReorderNotes).toHaveBeenCalledWith('s1', 's1');
    });

    it('delegates reorder with visibleIds to storage', () => {
      seedNotes([
        makeNote({ id: 'a', tags: ['ops'] }),
        makeNote({ id: 'b', tags: ['infra'] }),
        makeNote({ id: 'c', tags: ['ops'] }),
        makeNote({ id: 'd', tags: ['infra'] }),
      ]);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.reorderNotes('c', 'a', ['a', 'c']);
      });

      expect(mockReorderNotes).toHaveBeenCalledWith('c', 'a', ['a', 'c']);
    });
  });

  // -------------------------------------------------------------------------
  // 7. setVisibleOrder — delegates to storage
  // -------------------------------------------------------------------------
  describe('setVisibleOrder', () => {
    it('delegates to storage.setVisibleOrder', () => {
      seedNotes([makeNote({ id: 'a' }), makeNote({ id: 'b' }), makeNote({ id: 'c' })]);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.setVisibleOrder(['b', 'c', 'a']);
      });

      expect(mockSetVisibleOrder).toHaveBeenCalledWith(['b', 'c', 'a']);
    });

    it('delegates with visibleIds to storage', () => {
      seedNotes([
        makeNote({ id: 'a', tags: ['ops'] }),
        makeNote({ id: 'b', tags: ['infra'] }),
        makeNote({ id: 'c', tags: ['ops'] }),
        makeNote({ id: 'd', tags: ['infra'] }),
      ]);
      const { result } = renderHook(() => useNotepad());

      act(() => {
        result.current.setVisibleOrder(['c', 'a'], ['a', 'c']);
      });

      expect(mockSetVisibleOrder).toHaveBeenCalledWith(['c', 'a'], ['a', 'c']);
    });
  });

  // -------------------------------------------------------------------------
  // 8. Filtering (useNotepad's own logic)
  // -------------------------------------------------------------------------
  describe('filtering', () => {
    function setupFilterNotes() {
      seedNotes([
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
      ]);
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
      seedNotes([
        makeNote({ id: 'c1', title: 'Alpha', tags: ['work'], updatedAt: 200 }),
        makeNote({ id: 'c2', title: 'Alpha Beta', tags: ['personal'], updatedAt: 100 }),
      ]);
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
    it('updates fontSize state and persists to secureStorage', () => {
      seedNotes([]);
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
      seedNotes([]);
      secureStore.set('notepad-fontsize', 'sm');
      const { result } = renderHook(() => useNotepad());
      expect(result.current.fontSize).toBe('sm');
    });

    it('loads "lg" from secureStorage', () => {
      seedNotes([]);
      secureStore.set('notepad-fontsize', 'lg');
      const { result } = renderHook(() => useNotepad());
      expect(result.current.fontSize).toBe('lg');
    });

    it('defaults to "md" for invalid value', () => {
      seedNotes([]);
      secureStore.set('notepad-fontsize', 'xl');
      const { result } = renderHook(() => useNotepad());
      expect(result.current.fontSize).toBe('md');
    });

    it('defaults to "md" when no value is stored', () => {
      seedNotes([]);
      const { result } = renderHook(() => useNotepad());
      expect(result.current.fontSize).toBe('md');
    });
  });

  // -------------------------------------------------------------------------
  // 12. allTags
  // -------------------------------------------------------------------------
  describe('allTags', () => {
    it('computes unique sorted tags from all notes', () => {
      seedNotes([
        makeNote({ id: 't1', tags: ['zebra', 'apple'] }),
        makeNote({ id: 't2', tags: ['banana', 'apple'] }),
      ]);
      const { result } = renderHook(() => useNotepad());

      expect(result.current.allTags).toEqual(['apple', 'banana', 'zebra']);
    });

    it('returns empty array when no notes have tags', () => {
      seedNotes([makeNote({ id: 'nt1', tags: [] })]);
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
