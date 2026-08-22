import React from 'react';
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NotesProvider, useNotesContext } from '../NotesContext';
import type { NotesData } from '@shared/ipc';

// Mock useNotes so we control what the context provides
vi.mock('../../hooks/useNotes', () => ({
  useNotes: vi.fn(),
}));

import { useNotes } from '../../hooks/useNotes';

const mockNotesState = {
  notes: { contacts: {}, servers: {} } as NotesData,
  loading: false,
  setContactNote: vi.fn(),
  setServerNote: vi.fn(),
  getContactNote: vi.fn(),
  getServerNote: vi.fn(),
  reloadNotes: vi.fn(),
};

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(NotesProvider, null, children);

describe('NotesContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useNotes as ReturnType<typeof vi.fn>).mockReturnValue(mockNotesState);
  });

  it('throws when useNotesContext used outside provider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useNotesContext())).toThrow(
      'useNotesContext must be used within NotesProvider',
    );
    consoleError.mockRestore();
  });

  it('provides notes state from useNotes', () => {
    const { result } = renderHook(() => useNotesContext(), { wrapper });
    expect(result.current.notes).toEqual({ contacts: {}, servers: {} });
    expect(result.current.loading).toBe(false);
  });

  it('forwards setContactNote arguments to useNotes', async () => {
    mockNotesState.setContactNote.mockResolvedValue(true);
    const { result } = renderHook(() => useNotesContext(), { wrapper });
    await result.current.setContactNote('a@b.com', 'note', ['tag']);
    expect(mockNotesState.setContactNote).toHaveBeenCalledWith('a@b.com', 'note', ['tag']);
  });

  it('forwards setServerNote arguments to useNotes', async () => {
    mockNotesState.setServerNote.mockResolvedValue(true);
    const { result } = renderHook(() => useNotesContext(), { wrapper });
    await result.current.setServerNote('Alpha', 'note', ['tag']);
    expect(mockNotesState.setServerNote).toHaveBeenCalledWith('Alpha', 'note', ['tag']);
  });

  // Regression: `useNotes` reports success as a bare boolean while every
  // consumer reads `result.success`. Passing the boolean through unchanged made
  // `saved?.success` undefined on a *successful* write, so the notes dialog
  // treated every save as a failure and never closed.
  it.each([
    ['setContactNote' as const, 'a@b.com'],
    ['setServerNote' as const, 'Alpha'],
  ])('reports %s success as an IpcResult, not a bare boolean', async (method, key) => {
    mockNotesState[method].mockResolvedValue(true);
    const { result } = renderHook(() => useNotesContext(), { wrapper });

    const saved = await result.current[method](key, 'note', []);

    expect(saved).toEqual({ success: true });
    expect(saved?.success).toBe(true);
  });

  it.each([
    ['setContactNote' as const, 'a@b.com'],
    ['setServerNote' as const, 'Alpha'],
  ])('reports %s failure as an unsuccessful IpcResult', async (method, key) => {
    mockNotesState[method].mockResolvedValue(false);
    const { result } = renderHook(() => useNotesContext(), { wrapper });

    const saved = await result.current[method](key, 'note', []);

    expect(saved?.success).toBe(false);
  });

  it('provides getContactNote function', () => {
    const { result } = renderHook(() => useNotesContext(), { wrapper });
    expect(result.current.getContactNote).toBe(mockNotesState.getContactNote);
  });

  it('provides getServerNote function', () => {
    const { result } = renderHook(() => useNotesContext(), { wrapper });
    expect(result.current.getServerNote).toBe(mockNotesState.getServerNote);
  });

  it('provides reloadNotes function', () => {
    const { result } = renderHook(() => useNotesContext(), { wrapper });
    expect(result.current.reloadNotes).toBe(mockNotesState.reloadNotes);
  });
});
