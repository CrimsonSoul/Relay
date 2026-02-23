import { renderHook, act, waitFor } from '@testing-library/react';
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

describe('useNotes', () => {
  const api = {
    getNotes: vi.fn(),
    setContactNote: vi.fn(),
    setServerNote: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as Window & { api?: typeof api }).api = api;
  });

  it('loads notes on mount and supports lookups', async () => {
    api.getNotes.mockResolvedValue({
      contacts: { 'alpha@test.com': { note: 'hello', tags: ['x'], updatedAt: 1 } },
      servers: { alpha: { note: 'server', tags: ['s'], updatedAt: 2 } },
    });

    const { result } = renderHook(() => useNotes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.getContactNote('ALPHA@test.com')?.note).toBe('hello');
    expect(result.current.getServerNote('Alpha')?.note).toBe('server');
  });

  it('handles load errors and reload fallback', async () => {
    api.getNotes.mockRejectedValueOnce(new Error('load failed')).mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useNotes());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(appLoggerError).toHaveBeenCalled();

    await act(async () => {
      await result.current.reloadNotes();
    });

    expect(result.current.notes).toEqual({ contacts: {}, servers: {} });
  });

  it('sets and removes contact notes', async () => {
    api.getNotes.mockResolvedValue({ contacts: {}, servers: {} });
    api.setContactNote.mockResolvedValue(true);

    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success = false;
    await act(async () => {
      success = await result.current.setContactNote('alpha@test.com', 'note', ['tag']);
    });
    expect(success).toBe(true);
    expect(result.current.getContactNote('alpha@test.com')?.note).toBe('note');

    await act(async () => {
      await result.current.setContactNote('alpha@test.com', '', []);
    });
    expect(result.current.getContactNote('alpha@test.com')).toBeUndefined();
  });

  it('sets and removes server notes and returns false on failed writes', async () => {
    api.getNotes.mockResolvedValue({ contacts: {}, servers: {} });
    api.setServerNote.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const { result } = renderHook(() => useNotes());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let success = false;
    await act(async () => {
      success = await result.current.setServerNote('Alpha', 'server note', ['prod']);
    });
    expect(success).toBe(true);
    expect(result.current.getServerNote('alpha')?.note).toBe('server note');

    let failed = true;
    await act(async () => {
      failed = await result.current.setServerNote('Alpha', '', []);
    });
    expect(failed).toBe(false);
    expect(result.current.getServerNote('alpha')?.note).toBe('server note');
  });
});
