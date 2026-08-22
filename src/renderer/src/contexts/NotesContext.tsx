import React, { createContext, useCallback, useContext, useMemo, ReactNode } from 'react';
import { useNotes } from '../hooks/useNotes';
import type { NotesData, NoteEntry, IpcResult } from '@shared/ipc';

type NotesContextType = {
  notes: NotesData;
  loading: boolean;
  setContactNote: (email: string, note: string, tags: string[]) => Promise<IpcResult<void>>;
  setServerNote: (name: string, note: string, tags: string[]) => Promise<IpcResult<void>>;
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

  // `useNotes` reports success as a bare boolean, but every consumer of this
  // context reads `.success` off the result. Handing the boolean through
  // unchanged made `result?.success` undefined on a *successful* save, so the
  // notes dialog stayed open as if the write had failed.
  const setContactNoteResult = useCallback<NotesContextType['setContactNote']>(
    async (email, note, tags) => ({ success: await setContactNote(email, note, tags) }),
    [setContactNote],
  );
  const setServerNoteResult = useCallback<NotesContextType['setServerNote']>(
    async (name, note, tags) => ({ success: await setServerNote(name, note, tags) }),
    [setServerNote],
  );

  const value = useMemo<NotesContextType>(
    () => ({
      notes,
      loading,
      setContactNote: setContactNoteResult,
      setServerNote: setServerNoteResult,
      getContactNote,
      getServerNote,
      reloadNotes,
    }),
    [
      notes,
      loading,
      setContactNoteResult,
      setServerNoteResult,
      getContactNote,
      getServerNote,
      reloadNotes,
    ],
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
