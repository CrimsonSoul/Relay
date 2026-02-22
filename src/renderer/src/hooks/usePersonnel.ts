import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { OnCallRow } from '@shared/ipc';
import { useToast } from '../components/Toast';

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

export function usePersonnel(onCall: OnCallRow[]) {
  const { showToast } = useToast();
  const [localOnCall, setLocalOnCall] = useState<OnCallRow[]>(onCall);
  const [weekRange, setWeekRange] = useState(getWeekRange());
  const [currentDay, setCurrentDay] = useState(new Date().getDay());
  const [tick, setTick] = useState(Date.now());

  // Track pending API calls to distinguish local optimistic updates from external pushes
  const pendingMutationsRef = useRef(0);

  // Sync with external updates only when no local mutations are in-flight
  useEffect(() => {
    if (pendingMutationsRef.current === 0) {
      setLocalOnCall(onCall);
    }
  }, [onCall]);

  // Alert Logic
  const getAlertKey = useCallback((type: string) => {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${type}`;
  }, []);

  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => {
    const check = [
      getAlertKey('first-responder'),
      getAlertKey('general'),
      getAlertKey('sql'),
      getAlertKey('oracle'),
    ];
    const saved = new Set<string>();
    check.forEach((k) => {
      if (localStorage.getItem(`dismissed-${k}`)) saved.add(k);
    });
    return saved;
  });

  const dismissAlert = useCallback(
    (type: string) => {
      const key = getAlertKey(type);
      localStorage.setItem(`dismissed-${key}`, 'true');
      setDismissedAlerts((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    },
    [getAlertKey],
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setWeekRange(getWeekRange());
      setTick(Date.now());
      const newDay = new Date().getDay();
      if (newDay !== currentDay) {
        setCurrentDay(newDay);
        const types = ['first-responder', 'general', 'sql', 'oracle'];
        const saved = new Set<string>();
        types.forEach((type) => {
          const key = getAlertKey(type);
          if (localStorage.getItem(`dismissed-${key}`)) saved.add(key);
        });
        setDismissedAlerts(saved);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [currentDay, getAlertKey]);

  const teams = useMemo(() => {
    const map = new Map<string, OnCallRow[]>();
    localOnCall.forEach((row) => {
      if (!map.has(row.team)) map.set(row.team, []);
      map.get(row.team)?.push(row);
    });
    return Array.from(map.keys());
  }, [localOnCall]);

  const handleUpdateRows = async (team: string, rows: OnCallRow[]) => {
    const day = new Date().getDay();
    const lowerTeam = team.toLowerCase();

    if (day === 0 && lowerTeam.includes('first responder')) dismissAlert('first-responder');
    if (day === 1) dismissAlert('general');
    if (day === 3 && lowerTeam.includes('sql')) dismissAlert('sql');
    if (day === 4 && lowerTeam.includes('oracle')) dismissAlert('oracle');

    pendingMutationsRef.current++;

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
      const success = await globalThis.api!.updateOnCallTeam(team, rows);
      if (!success) {
        showToast('Failed to save changes', 'error');
      }
    } finally {
      pendingMutationsRef.current--;
    }
  };

  const handleRemoveTeam = async (team: string) => {
    pendingMutationsRef.current++;
    try {
      const success = await globalThis.api!.removeOnCallTeam(team);
      if (success) {
        setLocalOnCall((prev) => prev.filter((r) => r.team !== team));
        showToast(`Removed ${team}`, 'success');
      } else {
        showToast('Failed to remove team', 'error');
      }
    } finally {
      pendingMutationsRef.current--;
    }
  };

  const handleRenameTeam = async (oldName: string, newName: string) => {
    pendingMutationsRef.current++;
    try {
      const success = await globalThis.api!.renameOnCallTeam(oldName, newName);
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
  };

  const handleAddTeam = async (name: string) => {
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
    const nextList = [...localOnCall, initialRow];
    setLocalOnCall(nextList);

    // 2. Perform API calls outside the setter
    try {
      const success = await globalThis.api!.updateOnCallTeam(name, [initialRow]);
      if (success) {
        const currentTeams = Array.from(new Set(nextList.map((r) => r.team)));
        await globalThis.api!.reorderOnCallTeams(currentTeams, {});
        showToast(`Added team ${name}`, 'success');
      } else {
        throw new Error('API call failed');
      }
    } catch (err: unknown) {
      // Rollback local state
      setLocalOnCall((p) => p.filter((r) => r.id !== initialRow.id));
      showToast('Failed to add team', 'error');
      // Log for diagnostics

      console.warn('[usePersonnel] Failed to add team:', err);
    } finally {
      pendingMutationsRef.current--;
    }
  };

  const handleReorderTeams = async (oldIndex: number, newIndex: number) => {
    if (oldIndex === newIndex) return;

    const currentTeams = [...teams];
    const [movedTeam] = currentTeams.splice(oldIndex, 1);
    if (movedTeam === undefined) return;
    currentTeams.splice(newIndex, 0, movedTeam);

    const newFlatList: OnCallRow[] = [];
    currentTeams.forEach((t) => {
      newFlatList.push(...localOnCall.filter((r) => r.team === t));
    });

    pendingMutationsRef.current++;
    const oldFlatList = [...localOnCall];
    setLocalOnCall(newFlatList);

    try {
      const success = await globalThis.api!.reorderOnCallTeams(currentTeams, {});
      if (success) {
        showToast('Teams reordered', 'success');
      } else {
        setLocalOnCall(oldFlatList);
        showToast('Failed to save team order', 'error');
      }
    } finally {
      pendingMutationsRef.current--;
    }
  };

  return {
    localOnCall,
    weekRange,
    dismissedAlerts,
    dismissAlert,
    getAlertKey,
    currentDay,
    teams,
    handleUpdateRows,
    handleRemoveTeam,
    handleRenameTeam,
    handleAddTeam,
    handleReorderTeams,
    setLocalOnCall,
    tick,
  };
}
