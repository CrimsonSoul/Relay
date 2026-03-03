import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { OnCallRow } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';

const getWeekRange = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  const sunday = new Date(now.getFullYear(), now.getMonth(), diff + 6);
  const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
  return `${monday.toLocaleDateString(undefined, options)} - ${sunday.toLocaleDateString(
    undefined,
    options,
  )}, ${sunday.getFullYear()}`;
};

function getApi() {
  const api = globalThis.api;
  if (!api) throw new Error('API not initialized');
  return api;
}

export function useOnCallManager(onCall: OnCallRow[], dismissAlert: (type: string) => void) {
  const { showToast } = useToast();
  const [localOnCall, setLocalOnCall] = useState<OnCallRow[]>(onCall);
  const [weekRange, setWeekRange] = useState(getWeekRange());

  // Track pending API calls to distinguish local optimistic updates from external pushes
  const pendingMutationsRef = useRef(0);

  // Ref to always hold the latest localOnCall to avoid stale closures in callbacks
  const localOnCallRef = useRef(localOnCall);
  localOnCallRef.current = localOnCall;

  // Sync with external updates only when no local mutations are in-flight
  useEffect(() => {
    if (pendingMutationsRef.current === 0) {
      setLocalOnCall(onCall);
    }
  }, [onCall]);

  // Keep weekRange up to date
  useEffect(() => {
    const interval = setInterval(() => {
      setWeekRange(getWeekRange());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const teams = useMemo(() => {
    const map = new Map<string, OnCallRow[]>();
    localOnCall.forEach((row) => {
      if (!map.has(row.team)) map.set(row.team, []);
      map.get(row.team)?.push(row);
    });
    return Array.from(map.keys());
  }, [localOnCall]);

  // Ref for teams to avoid stale closures in callbacks that depend on frequently-changing values
  const teamsRef = useRef(teams);
  teamsRef.current = teams;

  const handleUpdateRows = useCallback(
    async (team: string, rows: OnCallRow[]) => {
      const day = new Date().getDay();
      const lowerTeam = team.toLowerCase();

      if (day === 0 && lowerTeam.includes('first responder')) dismissAlert('first-responder');
      if (day === 1) dismissAlert('general');
      if (day === 3 && lowerTeam.includes('sql')) dismissAlert('sql');
      if (day === 4 && lowerTeam.includes('oracle')) dismissAlert('oracle');

      pendingMutationsRef.current++;
      const previousList = [...localOnCallRef.current];

      const buildReorderedList = (prev: OnCallRow[]) => {
        const teamOrder = Array.from(new Set(prev.map((r) => r.team)));
        if (!teamOrder.includes(team)) return [...prev, ...rows];
        const newFlatList: OnCallRow[] = [];
        for (const t of teamOrder) {
          newFlatList.push(...(t === team ? rows : prev.filter((r) => r.team === t)));
        }
        return newFlatList;
      };
      setLocalOnCall(buildReorderedList);

      try {
        const success = await getApi().updateOnCallTeam(team, rows);
        if (!success) {
          setLocalOnCall(previousList);
          showToast('Failed to save changes', 'error');
        }
      } finally {
        pendingMutationsRef.current--;
      }
    },
    [dismissAlert, showToast],
  );

  const handleRemoveTeam = useCallback(
    async (team: string) => {
      pendingMutationsRef.current++;
      try {
        const success = await getApi().removeOnCallTeam(team);
        if (success) {
          setLocalOnCall((prev) => prev.filter((r) => r.team !== team));
          showToast(`Removed ${team}`, 'success');
        } else {
          showToast('Failed to remove team', 'error');
        }
      } finally {
        pendingMutationsRef.current--;
      }
    },
    [showToast],
  );

  const handleRenameTeam = useCallback(
    async (oldName: string, newName: string) => {
      pendingMutationsRef.current++;
      try {
        const success = await getApi().renameOnCallTeam(oldName, newName);
        if (success) {
          setLocalOnCall((prev) =>
            prev.map((r) => (r.team === oldName ? { ...r, team: newName } : r)),
          );
          showToast(`Renamed ${oldName} to ${newName}`, 'success');
        } else {
          showToast('Failed to rename team', 'error');
        }
      } finally {
        pendingMutationsRef.current--;
      }
    },
    [showToast],
  );

  const handleAddTeam = useCallback(
    async (name: string) => {
      const initialRow: OnCallRow = {
        id: crypto.randomUUID(),
        team: name,
        role: 'Primary',
        name: '',
        contact: '',
        timeWindow: '',
      };
      pendingMutationsRef.current++;

      // 1. Update local state optimistically
      const nextList = [...localOnCallRef.current, initialRow];
      setLocalOnCall(nextList);

      // 2. Perform API calls outside the setter
      try {
        const success = await getApi().updateOnCallTeam(name, [initialRow]);
        if (success) {
          const currentTeams = Array.from(new Set(nextList.map((r) => r.team)));
          await getApi().reorderOnCallTeams(currentTeams, {});
          showToast(`Added team ${name}`, 'success');
        } else {
          throw new Error('API call failed');
        }
      } catch (err: unknown) {
        // Rollback local state
        setLocalOnCall((p) => p.filter((r) => r.id !== initialRow.id));
        showToast('Failed to add team', 'error');
        loggers.app.warn('[useOnCallManager] Failed to add team', { error: err });
      } finally {
        pendingMutationsRef.current--;
      }
    },
    [showToast],
  );

  const handleReorderTeams = useCallback(
    async (oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return;

      const currentTeams = [...teamsRef.current];
      const [movedTeam] = currentTeams.splice(oldIndex, 1);
      if (movedTeam === undefined) return;
      currentTeams.splice(newIndex, 0, movedTeam);

      const current = localOnCallRef.current;
      const newFlatList: OnCallRow[] = [];
      currentTeams.forEach((t) => {
        newFlatList.push(...current.filter((r) => r.team === t));
      });

      pendingMutationsRef.current++;
      const oldFlatList = [...current];
      setLocalOnCall(newFlatList);

      try {
        const success = await getApi().reorderOnCallTeams(currentTeams, {});
        if (success) {
          showToast('Teams reordered', 'success');
        } else {
          setLocalOnCall(oldFlatList);
          showToast('Failed to save team order', 'error');
        }
      } finally {
        pendingMutationsRef.current--;
      }
    },
    [showToast],
  );

  return {
    localOnCall,
    weekRange,
    teams,
    handleUpdateRows,
    handleRemoveTeam,
    handleRenameTeam,
    handleAddTeam,
    handleReorderTeams,
    setLocalOnCall,
  };
}
