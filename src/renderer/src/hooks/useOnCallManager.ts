import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { OnCallRow } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import {
  replaceTeamRecords,
  deleteOnCallByTeam,
  renameTeam as pbRenameTeam,
} from '../services/oncallService';
import { updatePrimaryBoardSettings } from '../services/oncallBoardSettingsService';
import { useOptimisticList } from './useOptimisticList';
import type { BoardSettingsState } from './useAppData';

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

export function useOnCallManager(
  onCall: OnCallRow[],
  dismissAlert: (type: string) => void,
  boardSettings: BoardSettingsState,
  onBoardSettingsChange?: (updater: (prev: BoardSettingsState) => BoardSettingsState) => void,
) {
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

  // ---------------------------------------------------------------------------
  // Derive teams from boardSettings.effectiveTeamOrder (teamId-based).
  // Fall back to row-derived order when board settings are not ready.
  // ---------------------------------------------------------------------------
  const teams = useMemo(() => {
    if (boardSettings.status === 'ready' && boardSettings.effectiveTeamOrder.length > 0) {
      return boardSettings.effectiveTeamOrder;
    }
    // Fallback: derive unique teamIds from localOnCall in first-seen order
    const seen = new Set<string>();
    const order: string[] = [];
    for (const row of localOnCall) {
      if (row.teamId && !seen.has(row.teamId)) {
        seen.add(row.teamId);
        order.push(row.teamId);
      }
    }
    return order;
  }, [boardSettings.status, boardSettings.effectiveTeamOrder, localOnCall]);

  // Map teamId -> display name (first-seen team name for that teamId)
  const teamIdToName = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of localOnCall) {
      if (row.teamId && !map.has(row.teamId)) {
        map.set(row.teamId, row.team);
      }
    }
    return map;
  }, [localOnCall]);

  // Ref for teams to avoid stale closures in callbacks that depend on frequently-changing values
  const teamsRef = useRef(teams);
  teamsRef.current = teams;

  // ---------------------------------------------------------------------------
  // Board lock toggle
  // ---------------------------------------------------------------------------
  const [isBoardLockTogglePending, setIsBoardLockTogglePending] = useState(false);

  const toggleBoardLock = useCallback(async () => {
    if (boardSettings.status !== 'ready' || !boardSettings.recordId) return;
    const newLocked = !boardSettings.effectiveLocked;
    setIsBoardLockTogglePending(true);
    try {
      const updated = await updatePrimaryBoardSettings(boardSettings.recordId, {
        locked: newLocked,
      });
      // Update local state so the UI reflects the change immediately.
      onBoardSettingsChange?.((prev) => ({
        ...prev,
        record: updated,
        effectiveLocked: updated.locked,
      }));
    } catch {
      showToast('Failed to toggle board lock', 'error');
    } finally {
      setIsBoardLockTogglePending(false);
    }
  }, [
    boardSettings.status,
    boardSettings.recordId,
    boardSettings.effectiveLocked,
    showToast,
    onBoardSettingsChange,
  ]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

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
        const teamOrder = Array.from(new Set(prev.map((r) => r.teamId)));
        if (!teamOrder.includes(rows[0]?.teamId ?? '')) return [...prev, ...rows];
        const newFlatList: OnCallRow[] = [];
        for (const tid of teamOrder) {
          newFlatList.push(
            ...(tid === (rows[0]?.teamId ?? '') ? rows : prev.filter((r) => r.teamId === tid)),
          );
        }
        return newFlatList;
      };
      setLocalOnCall(buildReorderedList);

      try {
        await replaceTeamRecords(
          team,
          rows.map((r, i) => ({
            teamId: r.teamId,
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

        // Also remove from board settings teamOrder
        if (boardSettings.status === 'ready' && boardSettings.recordId) {
          const removedTeamId = localOnCall.find((r) => r.team === team)?.teamId;
          if (removedTeamId) {
            const newTeamOrder = boardSettings.effectiveTeamOrder.filter(
              (id) => id !== removedTeamId,
            );
            await updatePrimaryBoardSettings(boardSettings.recordId, { teamOrder: newTeamOrder });
          }
        }

        showToast(`Removed ${team}`, 'success');
      } catch {
        showToast('Failed to remove team', 'error');
      } finally {
        finishMutation();
      }
    },
    [
      showToast,
      startMutation,
      finishMutation,
      setLocalOnCall,
      boardSettings.status,
      boardSettings.recordId,
      boardSettings.effectiveTeamOrder,
      localOnCall,
    ],
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
      const teamId = name.trim().toLowerCase();
      const initialRow: OnCallRow = {
        id: crypto.randomUUID(),
        team: name,
        teamId,
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
          { teamId, role: 'Primary', name: '', contact: '', timeWindow: '', sortOrder: 0 },
        ]);

        // Append new teamId to board settings teamOrder
        if (boardSettings.status === 'ready' && boardSettings.recordId) {
          const newTeamOrder = [...boardSettings.effectiveTeamOrder, teamId];
          await updatePrimaryBoardSettings(boardSettings.recordId, { teamOrder: newTeamOrder });
        }

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
    [
      showToast,
      startMutation,
      finishMutation,
      dataRef,
      setLocalOnCall,
      boardSettings.status,
      boardSettings.recordId,
      boardSettings.effectiveTeamOrder,
    ],
  );

  /**
   * Reorder cards by updating the teamOrder in board settings.
   * This NEVER touches member sortOrder — it only changes the card display order.
   */
  const handleReorderTeams = useCallback(
    async (oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return;

      const currentTeams = [...teamsRef.current];
      const [movedTeam] = currentTeams.splice(oldIndex, 1);
      if (movedTeam === undefined) return;
      currentTeams.splice(newIndex, 0, movedTeam);

      // Optimistically reorder the flat list by teamId order
      const current = dataRef.current;
      const newFlatList: OnCallRow[] = [];
      currentTeams.forEach((tid) => {
        newFlatList.push(...current.filter((r) => r.teamId === tid));
      });

      startMutation();
      const oldFlatList = [...current];
      setLocalOnCall(newFlatList);

      try {
        if (boardSettings.status === 'ready' && boardSettings.recordId) {
          await updatePrimaryBoardSettings(boardSettings.recordId, { teamOrder: currentTeams });
          onBoardSettingsChange?.((prev) => ({
            ...prev,
            effectiveTeamOrder: currentTeams,
          }));
          showToast('Teams reordered', 'success');
        } else {
          // Non-ready state: can't persist, rollback
          setLocalOnCall(oldFlatList);
          showToast('Board settings not ready', 'error');
        }
      } catch {
        setLocalOnCall(oldFlatList);
        showToast('Failed to save team order', 'error');
      } finally {
        finishMutation();
      }
    },
    [
      showToast,
      startMutation,
      finishMutation,
      dataRef,
      setLocalOnCall,
      boardSettings.status,
      boardSettings.recordId,
      onBoardSettingsChange,
    ],
  );

  return {
    localOnCall,
    weekRange,
    teams,
    teamIdToName,
    handleUpdateRows,
    handleRemoveTeam,
    handleRenameTeam,
    handleAddTeam,
    handleReorderTeams,
    setLocalOnCall,
    boardSettings,
    toggleBoardLock,
    isBoardLockTogglePending,
  };
}
