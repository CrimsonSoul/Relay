import { useState, useCallback, useMemo } from 'react';
import type { StandaloneNote, NoteColor } from '@shared/ipc';
import type { NoteSort, FontSize } from '../tabs/notes/types';
import { useSearchContext } from '../contexts/SearchContext';

const STORAGE_KEY = 'relay-notepad';

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
      pinned: true,
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
      pinned: false,
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
      pinned: false,
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
      pinned: false,
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
      pinned: false,
      createdAt: now - 86_400_000 * 14,
      updatedAt: now - 86_400_000 * 6,
    },
  ];
}

function loadFromStorage(): StandaloneNote[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StandaloneNote[];
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    // Storage full or unavailable — silently fail
  }
}

const FONT_SIZE_KEY = 'relay-notepad-fontsize';

function loadFontSize(): FontSize {
  try {
    const raw = localStorage.getItem(FONT_SIZE_KEY);
    if (raw === 'sm' || raw === 'md' || raw === 'lg') return raw;
  } catch {
    /* ignore */
  }
  return 'md';
}

export function useNotepad() {
  const { debouncedQuery } = useSearchContext();
  const [notes, setNotes] = useState<StandaloneNote[]>(loadFromStorage);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sort, setSort] = useState<NoteSort>({ key: 'updatedAt', direction: 'desc' });
  const [fontSize, setFontSizeState] = useState<FontSize>(loadFontSize);

  const setFontSize = useCallback((size: FontSize) => {
    setFontSizeState(size);
    try {
      localStorage.setItem(FONT_SIZE_KEY, size);
    } catch {
      /* ignore */
    }
  }, []);

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
          pinned: false,
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

  const togglePin = useCallback(
    (id: string) => {
      persistUpdate((prev) =>
        prev.map((n) => (n.id === id ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n)),
      );
    },
    [persistUpdate],
  );

  const reorderNotes = useCallback(
    (activeId: string, overId: string) => {
      persistUpdate((prev) => {
        const oldIndex = prev.findIndex((n) => n.id === activeId);
        const newIndex = prev.findIndex((n) => n.id === overId);
        if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return prev;
        const updated = [...prev];
        const [moved] = updated.splice(oldIndex, 1);
        updated.splice(newIndex, 0, moved);
        return updated;
      });
    },
    [persistUpdate],
  );

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    notes.forEach((n) => n.tags.forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
  }, [notes]);

  const sortedAndFiltered = useMemo(() => {
    let result = [...notes];

    // Filter by global search
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase();
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    // Filter by tag
    if (activeTag) {
      result = result.filter((n) => n.tags.includes(activeTag));
    }

    // Partition pinned and unpinned
    const pinned = result.filter((n) => n.pinned);
    const unpinned = result.filter((n) => !n.pinned);

    // Sort each partition
    const compareFn = (a: StandaloneNote, b: StandaloneNote) => {
      const dir = sort.direction === 'asc' ? 1 : -1;
      switch (sort.key) {
        case 'title':
          return a.title.localeCompare(b.title) * dir;
        case 'createdAt':
          return (a.createdAt - b.createdAt) * dir;
        case 'color':
          return a.color.localeCompare(b.color) * dir;
        case 'updatedAt':
        default:
          return (a.updatedAt - b.updatedAt) * dir;
      }
    };

    pinned.sort(compareFn);
    unpinned.sort(compareFn);

    return [...pinned, ...unpinned];
  }, [notes, debouncedQuery, activeTag, sort]);

  return {
    notes: sortedAndFiltered,
    totalCount: notes.length,
    allTags,
    activeTag,
    setActiveTag,
    sort,
    setSort,
    fontSize,
    setFontSize,
    addNote,
    updateNote,
    deleteNote,
    duplicateNote,
    togglePin,
    reorderNotes,
  };
}

export const NOTE_COLORS: { value: NoteColor; label: string; hex: string }[] = [
  { value: 'amber', label: 'Amber', hex: '#f59e0b' },
  { value: 'blue', label: 'Blue', hex: '#3b82f6' },
  { value: 'green', label: 'Green', hex: '#22c55e' },
  { value: 'red', label: 'Red', hex: '#ef4444' },
  { value: 'purple', label: 'Purple', hex: '#a855f7' },
  { value: 'slate', label: 'Slate', hex: '#64748b' },
];
