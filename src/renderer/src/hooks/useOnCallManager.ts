import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { OnCallRow } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import {
  replaceTeamRecords,
  deleteOnCallByTeam,
  renameTeam as pbRenameTeam,
  reorderTeams as pbReorderTeams,
} from '../services/oncallService';
import { useOptimisticList } from './useOptimisticList';

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

export function useOnCallManager(onCall: OnCallRow[], dismissAlert: (type: string) => void) {
  const { showToast } = useToast();
  const {
    data: localOnCall,
    setData: setLocalOnCall,
    dataRef,
    startMutation,
    finishMutation,
  } = useOptimisticList(onCall);
  const [weekRange, setWeekRange] = useState(getWeekRange());

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

      startMutation();
      const previousList = [...dataRef.current];

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
        await replaceTeamRecords(
          team,
          rows.map((r, i) => ({
            role: r.role,
            name: r.name,
            contact: r.contact,
            timeWindow: r.timeWindow,
            sortOrder: i,
          })),
        );
      } catch {
        setLocalOnCall(previousList);
        showToast('Failed to save changes', 'error');
      } finally {
        finishMutation();
      }
    },
    [dismissAlert, showToast, startMutation, finishMutation, dataRef, setLocalOnCall],
  );

  const handleRemoveTeam = useCallback(
    async (team: string) => {
      startMutation();
      try {
        await deleteOnCallByTeam(team);
        setLocalOnCall((prev) => prev.filter((r) => r.team !== team));
        showToast(`Removed ${team}`, 'success');
      } catch {
        showToast('Failed to remove team', 'error');
      } finally {
        finishMutation();
      }
    },
    [showToast, startMutation, finishMutation, setLocalOnCall],
  );

  const handleRenameTeam = useCallback(
    async (oldName: string, newName: string) => {
      startMutation();
      try {
        await pbRenameTeam(oldName, newName);
        setLocalOnCall((prev) =>
          prev.map((r) => (r.team === oldName ? { ...r, team: newName } : r)),
        );
        showToast(`Renamed ${oldName} to ${newName}`, 'success');
      } catch {
        showToast('Failed to rename team', 'error');
      } finally {
        finishMutation();
      }
    },
    [showToast, startMutation, finishMutation, setLocalOnCall],
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
      startMutation();

      // 1. Update local state optimistically
      const nextList = [...dataRef.current, initialRow];
      setLocalOnCall(nextList);

      // 2. Perform API calls
      try {
        await replaceTeamRecords(name, [
          { role: 'Primary', name: '', contact: '', timeWindow: '', sortOrder: 0 },
        ]);
        const currentTeams = Array.from(new Set(nextList.map((r) => r.team)));
        await pbReorderTeams(currentTeams);
        showToast(`Added team ${name}`, 'success');
      } catch (err: unknown) {
        // Rollback local state
        setLocalOnCall((p) => p.filter((r) => r.id !== initialRow.id));
        showToast('Failed to add team', 'error');
        loggers.app.warn('[useOnCallManager] Failed to add team', { error: err });
      } finally {
        finishMutation();
      }
    },
    [showToast, startMutation, finishMutation, dataRef, setLocalOnCall],
  );

  const handleReorderTeams = useCallback(
    async (oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return;

      const currentTeams = [...teamsRef.current];
      const [movedTeam] = currentTeams.splice(oldIndex, 1);
      if (movedTeam === undefined) return;
      currentTeams.splice(newIndex, 0, movedTeam);

      const current = dataRef.current;
      const newFlatList: OnCallRow[] = [];
      currentTeams.forEach((t) => {
        newFlatList.push(...current.filter((r) => r.team === t));
      });

      startMutation();
      const oldFlatList = [...current];
      setLocalOnCall(newFlatList);

      try {
        await pbReorderTeams(currentTeams);
        showToast('Teams reordered', 'success');
      } catch {
        setLocalOnCall(oldFlatList);
        showToast('Failed to save team order', 'error');
      } finally {
        finishMutation();
      }
    },
    [showToast, startMutation, finishMutation, dataRef, setLocalOnCall],
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
