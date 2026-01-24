import { useState, useEffect, useCallback } from "react";
import type { NotesData, NoteEntry } from "@shared/ipc";
import { loggers } from "../utils/logger";

export function useNotes() {
  const [notes, setNotes] = useState<NotesData>({ contacts: {}, servers: {} });
  const [loading, setLoading] = useState(true);

  const loadNotes = useCallback(async () => {
    try {
      const data = await window.api?.getNotes();
      setNotes(data || { contacts: {}, servers: {} });
    } catch (e) {
      loggers.app.error("Failed to load notes", { error: e });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const setContactNote = useCallback(
    async (email: string, note: string, tags: string[]) => {
      const success = await window.api?.setContactNote(email, note, tags);
      if (success) {
        const key = email.toLowerCase();
        setNotes((prev) => {
          const newContacts = { ...prev.contacts };
          if (!note && tags.length === 0) {
            delete newContacts[key];
          } else {
            newContacts[key] = { note, tags, updatedAt: Date.now() };
          }
          return { ...prev, contacts: newContacts };
        });
      }
      return success;
    },
    []
  );

  const setServerNote = useCallback(
    async (name: string, note: string, tags: string[]) => {
      const success = await window.api?.setServerNote(name, note, tags);
      if (success) {
        const key = name.toLowerCase();
        setNotes((prev) => {
          const newServers = { ...prev.servers };
          if (!note && tags.length === 0) {
            delete newServers[key];
          } else {
            newServers[key] = { note, tags, updatedAt: Date.now() };
          }
          return { ...prev, servers: newServers };
        });
      }
      return success;
    },
    []
  );

  const getContactNote = useCallback(
    (email: string): NoteEntry | undefined => {
      return notes.contacts[email.toLowerCase()];
    },
    [notes.contacts]
  );

  const getServerNote = useCallback(
    (name: string): NoteEntry | undefined => {
      return notes.servers[name.toLowerCase()];
    },
    [notes.servers]
  );

  return {
    notes,
    loading,
    setContactNote,
    setServerNote,
    getContactNote,
    getServerNote,
    reloadNotes: loadNotes,
  };
}
