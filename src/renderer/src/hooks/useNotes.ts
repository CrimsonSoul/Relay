import { useCallback, useMemo } from 'react';
import type { NotesData, NoteEntry } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import { useCollection } from './useCollection';
import { setNote as pbSetNote } from '../services/notesService';
import type { NoteRecord } from '../services/notesService';

function buildNotesData(records: NoteRecord[]): NotesData {
  const contacts: Record<string, NoteEntry> = {};
  const servers: Record<string, NoteEntry> = {};
  for (const r of records) {
    const entry: NoteEntry = {
      note: r.note,
      tags: r.tags || [],
      updatedAt: new Date(r.updated).getTime(),
    };
    if (r.entityType === 'contact') {
      contacts[r.entityKey.toLowerCase()] = entry;
    } else if (r.entityType === 'server') {
      servers[r.entityKey.toLowerCase()] = entry;
    }
  }
  return { contacts, servers };
}

export function useNotes() {
  const { showToast } = useToast();
  const {
    data: noteRecords,
    loading,
    refetch: reloadNotes,
  } = useCollection<NoteRecord>('notes', { sort: '-updated' });

  const notes = useMemo(() => buildNotesData(noteRecords), [noteRecords]);

  const setContactNote = useCallback(
    async (email: string, note: string, tags: string[]) => {
      try {
        await pbSetNote('contact', email.toLowerCase(), note, tags);
        return true;
      } catch (e) {
        loggers.app.error('Failed to set contact note', { error: e });
        showToast('Failed to save contact note', 'error');
        return false;
      }
    },
    [showToast],
  );

  const setServerNote = useCallback(
    async (name: string, note: string, tags: string[]) => {
      try {
        await pbSetNote('server', name.toLowerCase(), note, tags);
        return true;
      } catch (e) {
        loggers.app.error('Failed to set server note', { error: e });
        showToast('Failed to save server note', 'error');
        return false;
      }
    },
    [showToast],
  );

  const getContactNote = useCallback(
    (email: string): NoteEntry | undefined => {
      return notes.contacts[email.toLowerCase()];
    },
    [notes.contacts],
  );

  const getServerNote = useCallback(
    (name: string): NoteEntry | undefined => {
      return notes.servers[name.toLowerCase()];
    },
    [notes.servers],
  );

  return {
    notes,
    loading,
    setContactNote,
    setServerNote,
    getContactNote,
    getServerNote,
    reloadNotes,
  };
}
