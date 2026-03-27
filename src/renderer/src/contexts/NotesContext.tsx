import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { useNotes } from '../hooks/useNotes';
import type { NotesData, NoteEntry, IpcResult } from '@shared/ipc';

type NotesContextType = {
  notes: NotesData;
  loading: boolean;
  setContactNote: (
    email: string,
    note: string,
    tags: string[],
  ) => Promise<IpcResult<void> | undefined>;
  setServerNote: (
    name: string,
    note: string,
    tags: string[],
  ) => Promise<IpcResult<void> | undefined>;
  getContactNote: (email: string) => NoteEntry | undefined;
  getServerNote: (name: string) => NoteEntry | undefined;
  reloadNotes: () => Promise<void>;
};

const NotesContext = createContext<NotesContextType | null>(null);

export function NotesProvider({ children }: { readonly children: ReactNode }) {
  const {
    notes,
    loading,
    setContactNote,
    setServerNote,
    getContactNote,
    getServerNote,
    reloadNotes,
  } = useNotes();
  const value = useMemo<NotesContextType>(
    () => ({
      notes,
      loading,
      setContactNote,
      setServerNote,
      getContactNote,
      getServerNote,
      reloadNotes,
    }),
    [notes, loading, setContactNote, setServerNote, getContactNote, getServerNote, reloadNotes],
  );
  return <NotesContext.Provider value={value}>{children}</NotesContext.Provider>;
}

export function useNotesContext() {
  const context = useContext(NotesContext);
  if (!context) {
    throw new Error('useNotesContext must be used within NotesProvider');
  }
  return context;
}
