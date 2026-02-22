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

  it('provides setContactNote function', () => {
    const { result } = renderHook(() => useNotesContext(), { wrapper });
    expect(result.current.setContactNote).toBe(mockNotesState.setContactNote);
  });

  it('provides setServerNote function', () => {
    const { result } = renderHook(() => useNotesContext(), { wrapper });
    expect(result.current.setServerNote).toBe(mockNotesState.setServerNote);
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
