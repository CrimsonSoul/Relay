import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { StandaloneNote, NoteColor } from '@shared/ipc';
import { useCollection } from './useCollection';
import type { StandaloneNoteRecord } from '../services/standaloneNoteService';
import {
  addStandaloneNote,
  updateStandaloneNote,
  deleteStandaloneNote,
  reorderStandaloneNotes,
} from '../services/standaloneNoteService';
import { loggers } from '../utils/logger';

const NOTE_COLOR_SET = new Set<NoteColor>(['amber', 'blue', 'green', 'red', 'purple', 'slate']);

function toStandaloneNote(r: StandaloneNoteRecord): StandaloneNote {
  return {
    id: r.id,
    title: r.title || '',
    content: r.content || '',
    color: NOTE_COLOR_SET.has(r.color as NoteColor) ? (r.color as NoteColor) : 'amber',
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    createdAt: new Date(r.created).getTime(),
    updatedAt: new Date(r.updated).getTime(),
  };
}

function swapInList(list: StandaloneNote[], fromId: string, toId: string): StandaloneNote[] {
  const oldIndex = list.findIndex((n) => n.id === fromId);
  const newIndex = list.findIndex((n) => n.id === toId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return list;
  const updated = [...list];
  [updated[oldIndex], updated[newIndex]] = [updated[newIndex], updated[oldIndex]];
  return updated;
}

/** Persist a newly added note to PB, replacing the temp ID with the real record. */
async function persistAddNote(
  note: Omit<StandaloneNote, 'id' | 'createdAt' | 'updatedAt'>,
  tempId: string,
  setNotes: React.Dispatch<React.SetStateAction<StandaloneNote[]>>,
  refetch: () => Promise<unknown>,
): Promise<void> {
  try {
    const created = await addStandaloneNote({
      title: note.title,
      content: note.content,
      color: note.color,
      tags: note.tags,
      sortOrder: 0,
    });
    setNotes((prev) => prev.map((n) => (n.id === tempId ? toStandaloneNote(created) : n)));
    const currentNotes = await refetch();
    if (currentNotes) {
      void persistSortOrder(currentNotes as unknown as StandaloneNote[]);
    }
  } catch (err) {
    loggers.app.error('Failed to add note', { error: err });
    setNotes((prev) => prev.filter((n) => n.id !== tempId));
  }
}

/** Persist a note update to PB. */
async function persistUpdateNote(
  id: string,
  updates: Partial<Omit<StandaloneNote, 'id' | 'createdAt'>>,
  refetch: () => Promise<unknown>,
): Promise<void> {
  try {
    const pbUpdates: Record<string, unknown> = {};
    if (updates.title !== undefined) pbUpdates.title = updates.title;
    if (updates.content !== undefined) pbUpdates.content = updates.content;
    if (updates.color !== undefined) pbUpdates.color = updates.color;
    if (updates.tags !== undefined) pbUpdates.tags = updates.tags;
    await updateStandaloneNote(id, pbUpdates);
  } catch (err) {
    loggers.app.error('Failed to update note', { error: err });
    void refetch();
  }
}

/** Persist a note deletion to PB. */
async function persistDeleteNote(id: string, refetch: () => Promise<unknown>): Promise<void> {
  try {
    await deleteStandaloneNote(id);
  } catch (err) {
    loggers.app.error('Failed to delete note', { error: err });
    void refetch();
  }
}

/** Persist a duplicated note to PB. */
async function persistDuplicateNote(
  copy: StandaloneNote,
  tempId: string,
  sortOrder: number,
  setNotes: React.Dispatch<React.SetStateAction<StandaloneNote[]>>,
): Promise<void> {
  try {
    const created = await addStandaloneNote({
      title: copy.title,
      content: copy.content,
      color: copy.color,
      tags: copy.tags,
      sortOrder,
    });
    setNotes((curr) => curr.map((n) => (n.id === tempId ? toStandaloneNote(created) : n)));
  } catch (err) {
    loggers.app.error('Failed to duplicate note', { error: err });
    setNotes((curr) => curr.filter((n) => n.id !== tempId));
  }
}

/**
 * Manages note CRUD operations backed by PocketBase.
 * Maintains the same interface as the previous localStorage-based implementation.
 */
export function useNoteStorage() {
  const {
    data: records,
    loading,
    refetch,
  } = useCollection<StandaloneNoteRecord>('standalone_notes', { sort: 'sortOrder' });

  // Derive notes from PB records, sorted by sortOrder
  const pbNotes = records.map(toStandaloneNote);

  // Local state for optimistic updates — synced from PB on load/refetch
  const [notes, setNotes] = useState<StandaloneNote[]>([]);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!loading && pbNotes.length > 0) {
      setNotes(pbNotes);
      initializedRef.current = true;
    } else if (!loading && pbNotes.length === 0 && !initializedRef.current) {
      setNotes([]);
      initializedRef.current = true;
    }
  }, [loading, records]); // eslint-disable-line react-hooks/exhaustive-deps

  const addNote = useCallback(
    (note: Omit<StandaloneNote, 'id' | 'createdAt' | 'updatedAt'>) => {
      // Optimistic: add to front of list immediately
      const tempId = crypto.randomUUID();
      const now = Date.now();
      const optimistic: StandaloneNote = {
        ...note,
        id: tempId,
        createdAt: now,
        updatedAt: now,
      };
      setNotes((prev) => [optimistic, ...prev]);
      void persistAddNote(note, tempId, setNotes, refetch);

      return optimistic;
    },
    [refetch],
  );

  const updateNote = useCallback(
    (id: string, updates: Partial<Omit<StandaloneNote, 'id' | 'createdAt'>>) => {
      setNotes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n)),
      );
      void persistUpdateNote(id, updates, refetch);
    },
    [refetch],
  );

  const deleteNote = useCallback(
    (id: string) => {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      void persistDeleteNote(id, refetch);
    },
    [refetch],
  );

  const duplicateNote = useCallback((id: string) => {
    setNotes((prev) => {
      const source = prev.find((n) => n.id === id);
      if (!source) return prev;
      const tempId = crypto.randomUUID();
      const now = Date.now();
      const copy: StandaloneNote = {
        ...source,
        id: tempId,
        title: `${source.title} (copy)`,
        createdAt: now,
        updatedAt: now,
      };
      const idx = prev.indexOf(source);
      const updated = [...prev];
      updated.splice(idx + 1, 0, copy);
      const sourceIdx = updated.findIndex((n) => n.id === id);
      void persistDuplicateNote(copy, tempId, sourceIdx + 1, setNotes);
      return updated;
    });
  }, []);

  const reorderNotes = useCallback((activeId: string, overId: string, visibleIds?: string[]) => {
    setNotes((prev) => {
      if (activeId === overId) return prev;

      let reordered: StandaloneNote[];

      if (!visibleIds || visibleIds.length === 0) {
        reordered = swapInList(prev, activeId, overId);
      } else {
        const visibleIdSet = new Set(visibleIds);
        if (!visibleIdSet.has(activeId) || !visibleIdSet.has(overId)) {
          reordered = swapInList(prev, activeId, overId);
        } else {
          const visibleNotes = prev.filter((note) => visibleIdSet.has(note.id));
          const reorderedVisible = swapInList(visibleNotes, activeId, overId);
          if (reorderedVisible === visibleNotes) return prev;

          let visibleCursor = 0;
          reordered = prev.map((note) =>
            visibleIdSet.has(note.id) ? reorderedVisible[visibleCursor++] : note,
          );
        }
      }

      if (reordered !== prev) {
        void persistSortOrder(reordered);
      }
      return reordered;
    });
  }, []);

  const setVisibleOrder = useCallback((orderedVisibleIds: string[], visibleIds?: string[]) => {
    if (orderedVisibleIds.length === 0) return;

    setNotes((prev) => {
      const targetIds = visibleIds && visibleIds.length > 0 ? visibleIds : orderedVisibleIds;
      const targetSet = new Set(targetIds);
      const currentVisibleIds = prev
        .filter((note) => targetSet.has(note.id))
        .map((note) => note.id);

      if (currentVisibleIds.length !== orderedVisibleIds.length) return prev;
      if (new Set(currentVisibleIds).size !== currentVisibleIds.length) return prev;

      const orderedSet = new Set(orderedVisibleIds);
      if (orderedSet.size !== orderedVisibleIds.length) return prev;
      for (const id of currentVisibleIds) {
        if (!orderedSet.has(id)) return prev;
      }

      const byId = new Map(prev.map((note) => [note.id, note]));
      let cursor = 0;
      const reordered = prev.map((note) => {
        if (!targetSet.has(note.id)) return note;
        const nextId = orderedVisibleIds[cursor++];
        return byId.get(nextId) ?? note;
      });

      void persistSortOrder(reordered);
      return reordered;
    });
  }, []);

  return {
    notes,
    addNote,
    updateNote,
    deleteNote,
    duplicateNote,
    reorderNotes,
    setVisibleOrder,
  };
}

/** Persist current note order to PB by updating sortOrder fields. */
async function persistSortOrder(notes: StandaloneNote[]): Promise<void> {
  try {
    const updates = notes.map((n, i) => ({ id: n.id, sortOrder: i }));
    await reorderStandaloneNotes(updates);
  } catch (err) {
    loggers.app.error('Failed to persist note order', { error: err });
  }
}
