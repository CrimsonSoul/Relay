import { useCallback, useMemo } from 'react';
import type { NotesData, NoteEntry } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import { formatFailure } from '../utils/failureMessage';
import { useCollection } from './useCollection';
import { setNote as pbSetNote } from '../services/notesService';
import type { NoteRecord } from '../services/notesService';

/**
 * Notes keyed by lower-cased entity key. Historical data can hold several notes for one entity
 * (keys differing only by case); the most recently updated one is shown, whatever the input order.
 */
function buildNotesData(records: NoteRecord[]): NotesData {
  const contacts: Record<string, NoteEntry> = {};
  const servers: Record<string, NoteEntry> = {};
  for (const r of records) {
    let target: Record<string, NoteEntry> | null = null;
    if (r.entityType === 'contact') target = contacts;
    else if (r.entityType === 'server') target = servers;
    if (!target) continue;
    const entry: NoteEntry = {
      note: r.note,
      tags: r.tags || [],
      updatedAt: new Date(r.updated).getTime(),
    };
    const key = r.entityKey.toLowerCase();
    const current = target[key];
    if (!current || entry.updatedAt > current.updatedAt) target[key] = entry;
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
        showToast(
          formatFailure({ what: `Couldn't save the note for ${email}`, error: e }),
          'error',
        );
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
        showToast(formatFailure({ what: `Couldn't save the note for ${name}`, error: e }), 'error');
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
