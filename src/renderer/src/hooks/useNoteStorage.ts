import { useState, useCallback } from 'react';
import type { StandaloneNote, NoteColor } from '@shared/ipc';
import { secureStorage } from '../utils/secureStorage';

const STORAGE_KEY = 'relay-notepad';
const NOTE_COLOR_SET = new Set<NoteColor>(['amber', 'blue', 'green', 'red', 'purple', 'slate']);

function normalizeStoredNotes(raw: unknown): StandaloneNote[] {
  if (!Array.isArray(raw)) return [];

  const now = Date.now();
  return raw.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return [];

    const note = candidate as Partial<StandaloneNote>;

    const id = typeof note.id === 'string' && note.id.trim() ? note.id : crypto.randomUUID();
    const title = typeof note.title === 'string' ? note.title : '';
    const content = typeof note.content === 'string' ? note.content : '';
    const color = NOTE_COLOR_SET.has(note.color as NoteColor) ? (note.color as NoteColor) : 'amber';
    const tags = Array.isArray(note.tags)
      ? note.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];

    const fallbackTime = now - index;
    const createdAt =
      typeof note.createdAt === 'number' && Number.isFinite(note.createdAt)
        ? note.createdAt
        : fallbackTime;
    const updatedAt =
      typeof note.updatedAt === 'number' && Number.isFinite(note.updatedAt)
        ? note.updatedAt
        : createdAt;

    return [{ id, title, content, color, tags, createdAt, updatedAt }];
  });
}

function getSampleNotes(): StandaloneNote[] {
  const now = Date.now();
  return [
    {
      id: crypto.randomUUID(),
      title: 'Bridge Call Checklist',
      content:
        '- Confirm all required participants\n- Verify Teams link is active\n- Prepare incident timeline\n- Assign note-taker\n- Send summary within 30 min',
      color: 'amber',
      tags: ['process', 'bridge'],
      createdAt: now - 86_400_000 * 3,
      updatedAt: now - 3_600_000,
    },
    {
      id: crypto.randomUUID(),
      title: 'DB Failover Runbook',
      content:
        'Primary: db-prod-east-01\nSecondary: db-prod-west-02\n\nSteps:\n- Check replication lag\n- Notify on-call DBA\n- Initiate failover via orchestrator\n- Verify application connectivity\n- Update DNS if needed',
      color: 'red',
      tags: ['runbook', 'database'],
      createdAt: now - 86_400_000 * 7,
      updatedAt: now - 86_400_000 * 2,
    },
    {
      id: crypto.randomUUID(),
      title: 'Weekly Ops Review Notes',
      content:
        'Topics to cover:\n- Open incidents from last week\n- SLA compliance metrics\n- Upcoming maintenance windows\n- Team capacity and on-call rotations',
      color: 'blue',
      tags: ['meeting', 'weekly'],
      createdAt: now - 86_400_000 * 5,
      updatedAt: now - 86_400_000,
    },
    {
      id: crypto.randomUUID(),
      title: 'Monitoring Improvements',
      content:
        'Ideas:\n- Add latency percentile alerts (p95, p99)\n- Set up synthetic monitoring for login flow\n- Create dashboard for API error rates by endpoint\n- Review alert fatigue — consolidate noisy alerts',
      color: 'green',
      tags: ['ideas', 'monitoring'],
      createdAt: now - 86_400_000 * 10,
      updatedAt: now - 86_400_000 * 4,
    },
    {
      id: crypto.randomUUID(),
      title: 'Vendor Contacts',
      content:
        'CloudFlare: support@cloudflare.com (Enterprise)\nDatadog: am-team@datadoghq.com\nPagerDuty: enterprise-support@pagerduty.com',
      color: 'purple',
      tags: ['contacts', 'vendor'],
      createdAt: now - 86_400_000 * 14,
      updatedAt: now - 86_400_000 * 6,
    },
  ];
}

function loadFromStorage(): StandaloneNote[] {
  try {
    const raw = secureStorage.getItemSync<unknown>(STORAGE_KEY);
    if (raw) {
      const normalized = normalizeStoredNotes(raw);

      if (Array.isArray(raw)) {
        if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
          saveToStorage(normalized);
        }
        return normalized;
      }

      return [];
    }

    // Seed with sample notes on first load
    const samples = getSampleNotes();
    saveToStorage(samples);
    return samples;
  } catch {
    return [];
  }
}

function saveToStorage(notes: StandaloneNote[]) {
  try {
    secureStorage.setItemSync(STORAGE_KEY, notes);
  } catch {
    // Storage full or unavailable — silently fail
  }
}

function swapInList(list: StandaloneNote[], fromId: string, toId: string): StandaloneNote[] {
  const oldIndex = list.findIndex((n) => n.id === fromId);
  const newIndex = list.findIndex((n) => n.id === toId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return list;
  const updated = [...list];
  [updated[oldIndex], updated[newIndex]] = [updated[newIndex], updated[oldIndex]];
  return updated;
}

/**
 * Manages note CRUD operations: load, save, delete, duplicate, and reorder.
 * All mutations are automatically persisted to localStorage.
 */
export function useNoteStorage() {
  const [notes, setNotes] = useState<StandaloneNote[]>(loadFromStorage);

  const persistUpdate = useCallback((updater: (prev: StandaloneNote[]) => StandaloneNote[]) => {
    setNotes((prev) => {
      const updated = updater(prev);
      saveToStorage(updated);
      return updated;
    });
  }, []);

  const addNote = useCallback(
    (note: Omit<StandaloneNote, 'id' | 'createdAt' | 'updatedAt'>) => {
      const now = Date.now();
      const newNote: StandaloneNote = {
        ...note,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      persistUpdate((prev) => [newNote, ...prev]);
      return newNote;
    },
    [persistUpdate],
  );

  const updateNote = useCallback(
    (id: string, updates: Partial<Omit<StandaloneNote, 'id' | 'createdAt'>>) => {
      persistUpdate((prev) =>
        prev.map((n) => (n.id === id ? { ...n, ...updates, updatedAt: Date.now() } : n)),
      );
    },
    [persistUpdate],
  );

  const deleteNote = useCallback(
    (id: string) => {
      persistUpdate((prev) => prev.filter((n) => n.id !== id));
    },
    [persistUpdate],
  );

  const duplicateNote = useCallback(
    (id: string) => {
      persistUpdate((prev) => {
        const source = prev.find((n) => n.id === id);
        if (!source) return prev;
        const now = Date.now();
        const copy: StandaloneNote = {
          ...source,
          id: crypto.randomUUID(),
          title: `${source.title} (copy)`,
          createdAt: now,
          updatedAt: now,
        };
        const idx = prev.indexOf(source);
        const updated = [...prev];
        updated.splice(idx + 1, 0, copy);
        return updated;
      });
    },
    [persistUpdate],
  );

  const reorderNotes = useCallback(
    (activeId: string, overId: string, visibleIds?: string[]) => {
      persistUpdate((prev) => {
        if (activeId === overId) return prev;

        if (!visibleIds || visibleIds.length === 0) {
          return swapInList(prev, activeId, overId);
        }

        const visibleIdSet = new Set(visibleIds);
        if (!visibleIdSet.has(activeId) || !visibleIdSet.has(overId)) {
          return swapInList(prev, activeId, overId);
        }

        const visibleNotes = prev.filter((note) => visibleIdSet.has(note.id));
        const reorderedVisible = swapInList(visibleNotes, activeId, overId);
        if (reorderedVisible === visibleNotes) return prev;

        let visibleCursor = 0;
        return prev.map((note) =>
          visibleIdSet.has(note.id) ? reorderedVisible[visibleCursor++] : note,
        );
      });
    },
    [persistUpdate],
  );

  const setVisibleOrder = useCallback(
    (orderedVisibleIds: string[], visibleIds?: string[]) => {
      if (orderedVisibleIds.length === 0) return;

      persistUpdate((prev) => {
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
        return prev.map((note) => {
          if (!targetSet.has(note.id)) return note;
          const nextId = orderedVisibleIds[cursor++];
          return byId.get(nextId) ?? note;
        });
      });
    },
    [persistUpdate],
  );

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
