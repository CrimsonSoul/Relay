import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNoteStorage } from '../useNoteStorage';

vi.mock('../../utils/logger', () => ({
  loggers: {
    app: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  },
}));

// Mock useCollection with controllable data/loading
const mockRefetch = vi.fn(async () => null);
const mockCollection = {
  data: [] as unknown[],
  loading: false,
};
vi.mock('../useCollection', () => ({
  useCollection: () => ({
    data: mockCollection.data,
    loading: mockCollection.loading,
    error: null,
    refetch: mockRefetch,
  }),
}));

// Mock PocketBase standalone note service
const mockAddStandaloneNote = vi.fn();
const mockUpdateStandaloneNote = vi.fn(async () => ({}));
const mockDeleteStandaloneNote = vi.fn(async () => undefined);
const mockReorderStandaloneNotes = vi.fn(async () => undefined);
vi.mock('../../services/standaloneNoteService', () => ({
  addStandaloneNote: (...args: unknown[]) => mockAddStandaloneNote(...args),
  updateStandaloneNote: (...args: unknown[]) => mockUpdateStandaloneNote(...args),
  deleteStandaloneNote: (...args: unknown[]) => mockDeleteStandaloneNote(...args),
  reorderStandaloneNotes: (...args: unknown[]) => mockReorderStandaloneNotes(...args),
}));

function makeRecord(id: string, title: string, sortOrder = 0) {
  return {
    id,
    title,
    content: 'body',
    color: 'amber',
    tags: [],
    sortOrder,
    created: '2026-01-01T00:00:01Z',
    updated: '2026-01-01T00:00:01Z',
  };
}

describe('useNoteStorage server→local sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.data = [];
    mockCollection.loading = false;
  });

  it('loads notes from the server collection', () => {
    mockCollection.data = [makeRecord('a1', 'first')];
    const { result } = renderHook(() => useNoteStorage());
    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0].id).toBe('a1');
  });

  it('clears notes when the server collection becomes empty after initialization', () => {
    mockCollection.data = [makeRecord('a1', 'first')];
    const { result, rerender } = renderHook(() => useNoteStorage());
    expect(result.current.notes).toHaveLength(1);

    // Another client deletes the last note; realtime refresh yields []
    mockCollection.data = [];
    rerender();

    expect(result.current.notes).toEqual([]);
  });

  it('keeps an optimistic note while its persist is in flight', () => {
    mockCollection.data = [makeRecord('a1', 'first')];
    // Persist never resolves during the test — note stays "pending"
    mockAddStandaloneNote.mockReturnValue(new Promise(() => {}));

    const { result, rerender } = renderHook(() => useNoteStorage());

    act(() => {
      result.current.addNote({ title: 'x', content: '', color: 'amber', tags: [] });
    });
    expect(result.current.notes).toHaveLength(2);
    const tempId = result.current.notes[0].id;

    // Simulate a realtime refresh: new records array identity, same server data
    mockCollection.data = [makeRecord('a1', 'first')];
    rerender();

    const ids = result.current.notes.map((n) => n.id);
    expect(ids).toContain(tempId);
    expect(ids).toContain('a1');
    expect(result.current.notes).toHaveLength(2);
  });

  it('swaps the temp note for the persisted record once the persist resolves', async () => {
    mockCollection.data = [];
    mockAddStandaloneNote.mockResolvedValue(makeRecord('real1', 'x'));

    const { result, rerender } = renderHook(() => useNoteStorage());

    act(() => {
      result.current.addNote({ title: 'x', content: '', color: 'amber', tags: [] });
    });

    await waitFor(() => {
      expect(result.current.notes).toHaveLength(1);
      expect(result.current.notes[0].id).toBe('real1');
    });

    // Once persisted, the note is no longer pending — a refresh with empty
    // server data (note deleted elsewhere) must clear it
    mockCollection.data = [];
    rerender();
    expect(result.current.notes).toEqual([]);
  });

  it('drops the temp id when persist fails so the next sync is server-authoritative', async () => {
    mockCollection.data = [];
    mockAddStandaloneNote.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useNoteStorage());

    act(() => {
      result.current.addNote({ title: 'x', content: '', color: 'amber', tags: [] });
    });

    await waitFor(() => {
      expect(result.current.notes).toEqual([]);
    });
  });

  it('keeps an optimistic duplicate while its persist is in flight', () => {
    mockCollection.data = [makeRecord('a1', 'first')];
    mockAddStandaloneNote.mockReturnValue(new Promise(() => {}));

    const { result, rerender } = renderHook(() => useNoteStorage());

    act(() => {
      result.current.duplicateNote('a1');
    });
    expect(result.current.notes).toHaveLength(2);
    const tempId = result.current.notes.find((n) => n.id !== 'a1')!.id;

    mockCollection.data = [makeRecord('a1', 'first')];
    rerender();

    const ids = result.current.notes.map((n) => n.id);
    expect(ids).toContain(tempId);
    expect(ids).toContain('a1');
  });
});
