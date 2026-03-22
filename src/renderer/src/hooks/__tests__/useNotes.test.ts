import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useNotes } from '../useNotes';

const { appLoggerError } = vi.hoisted(() => ({
  appLoggerError: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  loggers: {
    app: {
      error: appLoggerError,
      info: vi.fn(),
      warn: vi.fn(),
    },
  },
}));

// Mock useCollection
const mockRefetch = vi.fn();
const mockCollectionData = { current: [] as unknown[] };
vi.mock('../useCollection', () => ({
  useCollection: () => ({
    data: mockCollectionData.current,
    loading: false,
    error: null,
    refetch: mockRefetch,
  }),
}));

// Mock PocketBase notes service
const mockSetNote = vi.fn();
vi.mock('../../services/notesService', () => ({
  setNote: (...args: unknown[]) => mockSetNote(...args),
}));

describe('useNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollectionData.current = [];
  });

  it('loads notes from useCollection and supports lookups', () => {
    mockCollectionData.current = [
      {
        id: 'n1',
        entityType: 'contact',
        entityKey: 'alpha@test.com',
        note: 'hello',
        tags: ['x'],
        created: '2026-01-01T00:00:01Z',
        updated: '2026-01-01T00:00:01Z',
      },
      {
        id: 'n2',
        entityType: 'server',
        entityKey: 'alpha',
        note: 'server',
        tags: ['s'],
        created: '2026-01-01T00:00:02Z',
        updated: '2026-01-01T00:00:02Z',
      },
    ];

    const { result } = renderHook(() => useNotes());

    expect(result.current.loading).toBe(false);
    expect(result.current.getContactNote('ALPHA@test.com')?.note).toBe('hello');
    expect(result.current.getServerNote('Alpha')?.note).toBe('server');
  });

  it('returns empty notes when no records', () => {
    const { result } = renderHook(() => useNotes());
    expect(result.current.notes).toEqual({ contacts: {}, servers: {} });
  });

  it('sets contact notes via PocketBase service', async () => {
    mockSetNote.mockResolvedValue({
      id: 'n1',
      entityType: 'contact',
      entityKey: 'alpha@test.com',
      note: 'note',
      tags: ['tag'],
    });

    const { result } = renderHook(() => useNotes());

    let success = false;
    await act(async () => {
      success = await result.current.setContactNote('alpha@test.com', 'note', ['tag']);
    });

    expect(success).toBe(true);
    expect(mockSetNote).toHaveBeenCalledWith('contact', 'alpha@test.com', 'note', ['tag']);
  });

  it('returns false when setContactNote fails', async () => {
    mockSetNote.mockRejectedValue(new Error('write failed'));

    const { result } = renderHook(() => useNotes());

    let success = true;
    await act(async () => {
      success = await result.current.setContactNote('alpha@test.com', 'note', ['tag']);
    });

    expect(success).toBe(false);
    expect(appLoggerError).toHaveBeenCalled();
  });

  it('sets server notes via PocketBase service', async () => {
    mockSetNote.mockResolvedValue({
      id: 'n1',
      entityType: 'server',
      entityKey: 'alpha',
      note: 'server note',
      tags: ['prod'],
    });

    const { result } = renderHook(() => useNotes());

    let success = false;
    await act(async () => {
      success = await result.current.setServerNote('Alpha', 'server note', ['prod']);
    });

    expect(success).toBe(true);
    expect(mockSetNote).toHaveBeenCalledWith('server', 'alpha', 'server note', ['prod']);
  });

  it('returns false when setServerNote fails', async () => {
    mockSetNote.mockRejectedValue(new Error('write failed'));

    const { result } = renderHook(() => useNotes());

    let success = true;
    await act(async () => {
      success = await result.current.setServerNote('Alpha', '', []);
    });

    expect(success).toBe(false);
  });

  it('reloadNotes calls refetch', async () => {
    const { result } = renderHook(() => useNotes());

    await act(async () => {
      await result.current.reloadNotes();
    });

    expect(mockRefetch).toHaveBeenCalled();
  });
});
