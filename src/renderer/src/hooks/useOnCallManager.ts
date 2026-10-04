import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { OnCallRow } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import { createClientId } from '../utils/clientId';
import {
  replaceTeamRecords,
  replaceTeamRecordsWithOutcome,
  deleteOnCallByTeam,
  renameTeam as pbRenameTeam,
} from '../services/oncallService';
import {
  ensurePrimaryBoardSettings,
  updatePrimaryBoardSettings,
} from '../services/oncallBoardSettingsService';
import { toOnCallRow } from '../utils/oncallFreshness';
import { formatFailure } from '../utils/failureMessage';
import { useOptimisticList } from './useOptimisticList';
import { useUndoableRecordDelete } from './useUndoableRecordDelete';
import type { BoardSettingsState } from './useAppData';

const getWeekRange = () => {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now.getFullYear(), now.getMonth(), diff);
  const sunday = new Date(now.getFullYear(), now.getMonth(), diff + 6);
  const options: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric' };
  return `${monday.toLocaleDateString(undefined, options)} – ${sunday.toLocaleDateString(
    undefined,
    options,
  )}, ${sunday.getFullYear()}`;
};

const replaceRowsForTeamId = (
  currentRows: OnCallRow[],
  teamId: string | undefined,
  replacementRows: OnCallRow[],
) => {
  if (!teamId) return currentRows;

  const teamOrder = Array.from(new Set(currentRows.map((r) => r.teamId).filter(Boolean)));
  if (!teamOrder.includes(teamId)) return [...currentRows, ...replacementRows];

  const nextRows: OnCallRow[] = [];
  for (const tid of teamOrder) {
    if (tid === teamId) {
      nextRows.push(...replacementRows);
    } else {
      nextRows.push(...currentRows.filter((r) => r.teamId === tid));
    }
  }
  return nextRows;
};

const appendUniqueTeamId = (teamOrder: string[], teamId: string) =>
  teamOrder.includes(teamId) ? teamOrder : [...teamOrder, teamId];

const pickCurrentTeamOrder = (primary: string[], fallback: string[]) =>
  primary.length > 0 ? primary : fallback;

// Mirrors normalizeTeamId in oncallService — the canonical card identity rule.
const normalizeTeamId = (name: string) => name.trim().toLowerCase();

/** Outcome of an add-team attempt; `error` is shown inline by the caller. */
export type AddTeamResult = { ok: true } | { ok: false; error?: string };

/** Carry a renamed card's saved board position onto its new teamId. */
const migrateTeamOrder = (teamOrder: string[], oldTeamId: string, newTeamId: string) => {
  const migrated = teamOrder.map((id) => (id === oldTeamId ? newTeamId : id));
  // A rename onto a name that already has a card collapses the two entries.
  return migrated.filter((id, index) => migrated.indexOf(id) === index);
};

/** A team card as it stood when Remove was confirmed: enough to commit, or to re-create it. */
type RemovedTeam = {
  teamId: string;
  team: string;
  rows: OnCallRow[];
  /** Board position, so a restored card returns to the same place. */
  orderIndex: number;
};

const removedTeamKey = (removed: RemovedTeam) => removed.teamId;

const memberCountLabel = (rows: readonly OnCallRow[]) => {
  const count = rows.filter((row) => row.name.trim() || row.contact.trim()).length;
  if (count === 0) return 'no members';
  return count === 1 ? '1 member' : `${count} members`;
};

const describeRemovedTeam = (removed: RemovedTeam) =>
  `Removed ${removed.team} (${memberCountLabel(removed.rows)})`;

/** Put a team back at its old board position (clamped), without duplicating it. */
const insertTeamId = (teamOrder: readonly string[], teamId: string, index: number) => {
  const next = teamOrder.filter((id) => id !== teamId);
  next.splice(Math.min(index, next.length), 0, teamId);
  return next;
};

type RetryHandlers = {
  removeTeam?: (team: string) => void;
  renameTeam?: (oldName: string, newName: string) => Promise<void>;
  toggleBoardLock?: () => Promise<void>;
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
  const boardSettingsRef = useRef(boardSettings);
  boardSettingsRef.current = boardSettings;
  // Latest handlers for toast Retry actions, which outlive the render that created them.
  const handlersRef = useRef<RetryHandlers>({});

  const repairLocalBoardSettings = useCallback(
    (
      teamOrder: string[],
      recordId: string | null,
      updates: { locked?: boolean; record?: BoardSettingsState['record'] } = {},
    ) => {
      onBoardSettingsChange?.((prev) => ({
        ...prev,
        record: prev.record
          ? { ...prev.record, ...updates.record, teamOrder }
          : (updates.record ?? prev.record),
        recordId: recordId ?? prev.recordId,
        status: 'ready',
        errors: [],
        effectiveTeamOrder: teamOrder,
        effectiveLocked: updates.locked ?? prev.effectiveLocked,
      }));
    },
    [onBoardSettingsChange],
  );

  // ---------------------------------------------------------------------------
  // Board lock toggle
  // ---------------------------------------------------------------------------
  const [isBoardLockTogglePending, setIsBoardLockTogglePending] = useState(false);

  const toggleBoardLock = useCallback(async () => {
    const newLocked = !boardSettings.effectiveLocked;
    setIsBoardLockTogglePending(true);
    try {
      let recordId = boardSettings.recordId;
      let baseRecord = boardSettings.record;
      let repairedMissingSettings = false;
      const repairExistingSettings = boardSettings.status !== 'ready' && !!recordId;
      const currentTeamOrder = pickCurrentTeamOrder(
        boardSettings.effectiveTeamOrder,
        teamsRef.current,
      );

      if (!recordId) {
        const ensuredRecord = await ensurePrimaryBoardSettings(teamsRef.current);
        recordId = ensuredRecord.id;
        baseRecord = ensuredRecord;
        repairedMissingSettings = true;
      }

      const updated = await updatePrimaryBoardSettings(recordId, {
        ...(repairExistingSettings ? { teamOrder: currentTeamOrder } : {}),
        locked: newLocked,
      });
      const fallbackTeamOrder =
        currentTeamOrder.length > 0
          ? currentTeamOrder
          : (baseRecord?.teamOrder ?? updated.teamOrder ?? []);
      const shouldRepairSettings = repairedMissingSettings || repairExistingSettings;
      // Update local state so the UI reflects the change immediately.
      onBoardSettingsChange?.((prev) => ({
        ...prev,
        record: {
          ...(baseRecord ?? prev.record ?? updated),
          ...updated,
          ...(repairExistingSettings ? { teamOrder: currentTeamOrder } : {}),
          locked: newLocked,
        },
        recordId,
        status: shouldRepairSettings ? 'ready' : prev.status,
        errors: shouldRepairSettings ? [] : prev.errors,
        effectiveTeamOrder:
          repairExistingSettings || prev.effectiveTeamOrder.length === 0
            ? fallbackTeamOrder
            : prev.effectiveTeamOrder,
        effectiveLocked: newLocked,
      }));
    } catch (error) {
      showToast(
        formatFailure({
          what: `Couldn't ${newLocked ? 'lock' : 'unlock'} team order`,
          error,
          outcome: `Team order is still ${newLocked ? 'unlocked' : 'locked'}.`,
        }),
        'error',
        { action: { label: 'Retry', onClick: () => void handlersRef.current.toggleBoardLock?.() } },
      );
    } finally {
      setIsBoardLockTogglePending(false);
    }
  }, [
    boardSettings.record,
    boardSettings.recordId,
    boardSettings.status,
    boardSettings.effectiveTeamOrder,
    boardSettings.effectiveLocked,
    showToast,
    onBoardSettingsChange,
  ]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleUpdateRows = useCallback(
    async (team: string, rows: OnCallRow[], baselineIds?: readonly string[]) => {
      startMutation();
      const previousList = [...dataRef.current];

      const targetTeamId = rows[0]?.teamId ?? previousList.find((r) => r.team === team)?.teamId;
      setLocalOnCall((prev) => replaceRowsForTeamId(prev, targetTeamId, rows));

      try {
        const outcome = await replaceTeamRecordsWithOutcome(
          team,
          rows.map((r, i) => ({
            id: r.id,
            teamId: r.teamId,
            role: r.role,
            name: r.name,
            contact: r.contact,
            // OnCallRow.timeWindow is optional but the record column is not.
            timeWindow: r.timeWindow ?? '',
            sortOrder: i,
          })),
          baselineIds,
        );
        const savedRows = outcome.records.map(toOnCallRow);
        setLocalOnCall((prev) =>
          replaceRowsForTeamId(prev, targetTeamId, savedRows.length > 0 ? savedRows : rows),
        );
        if (outcome.persistence === 'server') {
          const day = new Date().getDay();
          const lowerTeam = team.toLowerCase();

          if (day === 0 && lowerTeam.includes('first responder')) dismissAlert('first-responder');
          if (day === 1) dismissAlert('general');
          if (day === 3 && lowerTeam.includes('sql')) dismissAlert('sql');
          if (day === 4 && lowerTeam.includes('oracle')) dismissAlert('oracle');
        }
      } catch (error) {
        setLocalOnCall(previousList);
        showToast(
          formatFailure({
            what: `Couldn't save ${team}`,
            error,
            outcome: 'The board shows the last saved coverage.',
            next: 'Your edits are still in the editor; save again.',
          }),
          'error',
        );
        throw error;
      } finally {
        finishMutation();
      }
    },
    [dismissAlert, showToast, startMutation, finishMutation, dataRef, setLocalOnCall],
  );

  /** Writes a removal once its undo window closes. Resolves false (after saying why) if it failed. */
  const commitRemoveTeam = useCallback(
    async (removed: RemovedTeam): Promise<boolean> => {
      startMutation();
      try {
        await deleteOnCallByTeam(removed.team);
      } catch (error) {
        finishMutation();
        showToast(
          formatFailure({
            what: `Couldn't remove ${removed.team}`,
            error,
            outcome: 'The team is back on the board.',
          }),
          'error',
          {
            action: {
              label: 'Retry',
              onClick: () => handlersRef.current.removeTeam?.(removed.team),
            },
          },
        );
        return false;
      }
      setLocalOnCall((prev) => prev.filter((r) => r.teamId !== removed.teamId));

      // Also remove from board settings teamOrder
      const { status, recordId, effectiveTeamOrder } = boardSettingsRef.current;
      try {
        if (status === 'ready' && recordId) {
          const newTeamOrder = effectiveTeamOrder.filter((id) => id !== removed.teamId);
          await updatePrimaryBoardSettings(recordId, { teamOrder: newTeamOrder });
          onBoardSettingsChange?.((prev) => ({
            ...prev,
            record: prev.record ? { ...prev.record, teamOrder: newTeamOrder } : prev.record,
            effectiveTeamOrder: newTeamOrder,
          }));
        }
        return true;
      } catch (error) {
        // The members are gone but the card keeps its board slot: show it so it can be removed again.
        showToast(
          formatFailure({
            what: `Removed the members of ${removed.team} but couldn't update the board order`,
            error,
            outcome: 'Its empty card is back on the board.',
            next: 'Remove it again.',
          }),
          'error',
        );
        return false;
      } finally {
        finishMutation();
      }
    },
    [showToast, startMutation, finishMutation, setLocalOnCall, onBoardSettingsChange],
  );

  /** Undo after the removal was already written (the tab closed first): re-create the card. */
  const restoreRemovedTeam = useCallback(
    async (removed: RemovedTeam) => {
      try {
        const savedRows = await replaceTeamRecords(
          removed.team,
          removed.rows.map((row, i) => ({
            teamId: row.teamId,
            role: row.role,
            name: row.name,
            contact: row.contact,
            timeWindow: row.timeWindow ?? '',
            sortOrder: i,
          })),
        );
        setLocalOnCall((prev) =>
          replaceRowsForTeamId(prev, removed.teamId, savedRows.map(toOnCallRow)),
        );
        const { recordId, effectiveTeamOrder } = boardSettingsRef.current;
        if (recordId) {
          const teamOrder = insertTeamId(effectiveTeamOrder, removed.teamId, removed.orderIndex);
          await updatePrimaryBoardSettings(recordId, { teamOrder });
          onBoardSettingsChange?.((prev) => ({
            ...prev,
            record: prev.record ? { ...prev.record, teamOrder } : prev.record,
            effectiveTeamOrder: teamOrder,
          }));
        }
        showToast(`Restored ${removed.team} (${memberCountLabel(removed.rows)})`, 'success');
      } catch (error) {
        showToast(
          formatFailure({
            what: `Couldn't restore ${removed.team}`,
            error,
            outcome: 'It stays removed.',
            next: 'Add it again with Add Team.',
          }),
          'error',
        );
      }
    },
    [showToast, setLocalOnCall, onBoardSettingsChange],
  );

  // Every card as it stands now, so a removal can be committed or re-created in place.
  const teamSnapshots = useMemo<RemovedTeam[]>(
    () =>
      teams.map((teamId, orderIndex) => ({
        teamId,
        team: teamIdToName.get(teamId) ?? teamId,
        rows: localOnCall.filter((row) => row.teamId === teamId),
        orderIndex,
      })),
    [teams, teamIdToName, localOnCall],
  );

  const { requestDelete: requestRemoveTeam, hiddenKeys: hiddenTeamIds } = useUndoableRecordDelete({
    records: teamSnapshots,
    getKey: removedTeamKey,
    describe: describeRemovedTeam,
    commitDelete: commitRemoveTeam,
    restoreDeleted: restoreRemovedTeam,
    showToast,
  });

  // Cards are memoized on their callbacks, so Remove reads the latest snapshots through a ref.
  const teamSnapshotsRef = useRef(teamSnapshots);
  teamSnapshotsRef.current = teamSnapshots;

  /** Remove hides the card at once; the delete is written when the Undo notice leaves. */
  const handleRemoveTeam = useCallback(
    (team: string) => {
      const removed = teamSnapshotsRef.current.find((snapshot) => snapshot.team === team);
      if (removed) requestRemoveTeam(removed);
    },
    [requestRemoveTeam],
  );

  const visibleTeams = useMemo(
    () => (hiddenTeamIds.size === 0 ? teams : teams.filter((id) => !hiddenTeamIds.has(id))),
    [hiddenTeamIds, teams],
  );
  const visibleTeamsRef = useRef(visibleTeams);
  visibleTeamsRef.current = visibleTeams;
  const visibleOnCall = useMemo(
    () =>
      hiddenTeamIds.size === 0
        ? localOnCall
        : localOnCall.filter((row) => !hiddenTeamIds.has(row.teamId)),
    [hiddenTeamIds, localOnCall],
  );

  const handleRenameTeam = useCallback(
    async (oldName: string, newName: string) => {
      startMutation();
      const newTeamId = normalizeTeamId(newName);
      const oldTeamId = dataRef.current.find((r) => r.team === oldName)?.teamId;
      try {
        await pbRenameTeam(oldName, newName);
        setLocalOnCall((prev) =>
          prev.map((r) => (r.team === oldName ? { ...r, team: newName, teamId: newTeamId } : r)),
        );

        // teamOrder is keyed by teamId, so the entry has to follow the rename
        // or the card drops to the fallback (row-derived) position.
        if (oldTeamId && oldTeamId !== newTeamId && boardSettings.recordId) {
          const nextTeamOrder = migrateTeamOrder(
            pickCurrentTeamOrder(boardSettings.effectiveTeamOrder, teamsRef.current),
            oldTeamId,
            newTeamId,
          );
          await updatePrimaryBoardSettings(boardSettings.recordId, { teamOrder: nextTeamOrder });
          onBoardSettingsChange?.((prev) => ({
            ...prev,
            record: prev.record ? { ...prev.record, teamOrder: nextTeamOrder } : prev.record,
            effectiveTeamOrder: nextTeamOrder,
          }));
        }

        showToast(`Renamed ${oldName} to ${newName}`, 'success');
      } catch (error) {
        showToast(
          formatFailure({
            what: `Couldn't rename ${oldName}`,
            error,
            outcome: `It still shows as ${oldName}.`,
          }),
          'error',
          {
            action: {
              label: 'Retry',
              onClick: () => void handlersRef.current.renameTeam?.(oldName, newName),
            },
          },
        );
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
      boardSettings.recordId,
      boardSettings.effectiveTeamOrder,
      onBoardSettingsChange,
    ],
  );

  const handleAddTeam = useCallback(
    async (name: string): Promise<AddTeamResult> => {
      const trimmedName = name.trim();
      const teamId = normalizeTeamId(trimmedName);
      if (!teamId) {
        return { ok: false, error: 'Enter a team name' };
      }

      const duplicate = dataRef.current.some(
        (row) => normalizeTeamId(row.teamId || row.team) === teamId,
      );
      if (duplicate) {
        return { ok: false, error: `A team named "${trimmedName}" already exists` };
      }

      const initialRow: OnCallRow = {
        id: createClientId(),
        team: trimmedName,
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
        const savedRows = await replaceTeamRecords(trimmedName, [
          { teamId, role: 'Primary', name: '', contact: '', timeWindow: '', sortOrder: 0 },
        ]);
        const committedRows = savedRows.length > 0 ? savedRows.map(toOnCallRow) : [initialRow];

        // Append new teamId to board settings teamOrder
        let recordId = boardSettings.recordId;
        if (!recordId) {
          const ensuredRecord = await ensurePrimaryBoardSettings(teamsRef.current);
          recordId = ensuredRecord.id;
        }
        const newTeamOrder = appendUniqueTeamId(
          pickCurrentTeamOrder(boardSettings.effectiveTeamOrder, teamsRef.current),
          teamId,
        );
        const updatedSettings = await updatePrimaryBoardSettings(recordId, {
          teamOrder: newTeamOrder,
        });
        repairLocalBoardSettings(newTeamOrder, recordId, { record: updatedSettings });

        setLocalOnCall((prev) => replaceRowsForTeamId(prev, teamId, committedRows));
        showToast(`Added team ${trimmedName}`, 'success');
        return { ok: true };
      } catch (err: unknown) {
        // Rollback local state
        setLocalOnCall((p) => p.filter((r) => r.id !== initialRow.id));
        showToast(
          formatFailure({
            what: `Couldn't add ${trimmedName}`,
            error: err,
            outcome: 'Nothing was added.',
          }),
          'error',
        );
        loggers.app.warn('[useOnCallManager] Failed to add team', { error: err });
        return { ok: false };
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
      boardSettings.recordId,
      boardSettings.effectiveTeamOrder,
      repairLocalBoardSettings,
    ],
  );

  /**
   * Reorder cards by updating the teamOrder in board settings.
   * This NEVER touches member sortOrder — it only changes the card display order.
   */
  const handleReorderTeams = useCallback(
    async (oldIndex: number, newIndex: number) => {
      if (oldIndex === newIndex) return;
      if (boardSettings.effectiveLocked) {
        showToast('Unlock team order to reorder teams', 'info');
        return;
      }

      // Indices come from the visible board; a card pending removal keeps its saved slot.
      const movedTeam = visibleTeamsRef.current[oldIndex];
      const targetTeam = visibleTeamsRef.current[newIndex];
      if (movedTeam === undefined || targetTeam === undefined) return;
      const currentTeams = teamsRef.current.filter((id) => id !== movedTeam);
      const targetIndex = currentTeams.indexOf(targetTeam);
      currentTeams.splice(oldIndex < newIndex ? targetIndex + 1 : targetIndex, 0, movedTeam);

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
        let recordId = boardSettings.recordId;
        if (!recordId) {
          const ensuredRecord = await ensurePrimaryBoardSettings(currentTeams);
          recordId = ensuredRecord.id;
        }
        const updatedSettings = await updatePrimaryBoardSettings(recordId, {
          teamOrder: currentTeams,
        });
        repairLocalBoardSettings(currentTeams, recordId, { record: updatedSettings });
        const movedName = current.find((r) => r.teamId === movedTeam)?.team ?? movedTeam;
        const position = `position ${newIndex + 1} of ${visibleTeamsRef.current.length}`;
        showToast(`Moved ${movedName} to ${position}`, 'success');
      } catch (error) {
        setLocalOnCall(oldFlatList);
        showToast(
          formatFailure({
            what: "Couldn't save team order",
            error,
            outcome: 'The board is back in its previous order.',
            next: 'Drag the card again to retry.',
          }),
          'error',
        );
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
      boardSettings.recordId,
      boardSettings.effectiveLocked,
      repairLocalBoardSettings,
    ],
  );

  handlersRef.current = {
    removeTeam: handleRemoveTeam,
    renameTeam: handleRenameTeam,
    toggleBoardLock,
  };

  return {
    // Cards pending removal (inside their Undo window) are hidden everywhere on the board.
    localOnCall: visibleOnCall,
    weekRange,
    teams: visibleTeams,
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
