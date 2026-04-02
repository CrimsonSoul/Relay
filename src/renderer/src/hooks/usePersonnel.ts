import { OnCallRow } from '@shared/ipc';
import { useOnCallManager } from './useOnCallManager';
import { useAlertDismissal } from './useAlertDismissal';
import type { BoardSettingsState } from './useAppData';

/**
 * Composes on-call CRUD and alert dismissal logic.
 * Kept as a thin wrapper for backward compatibility.
 */
export function usePersonnel(
  onCall: OnCallRow[],
  boardSettings: BoardSettingsState,
  onBoardSettingsChange?: (updater: (prev: BoardSettingsState) => BoardSettingsState) => void,
) {
  const alerts = useAlertDismissal();
  const manager = useOnCallManager(
    onCall,
    alerts.dismissAlert,
    boardSettings,
    onBoardSettingsChange,
  );

  return {
    localOnCall: manager.localOnCall,
    weekRange: manager.weekRange,
    dismissedAlerts: alerts.dismissedAlerts,
    dismissAlert: alerts.dismissAlert,
    dayOfWeek: alerts.dayOfWeek,
    teams: manager.teams,
    teamIdToName: manager.teamIdToName,
    handleUpdateRows: manager.handleUpdateRows,
    handleRemoveTeam: manager.handleRemoveTeam,
    handleRenameTeam: manager.handleRenameTeam,
    handleAddTeam: manager.handleAddTeam,
    handleReorderTeams: manager.handleReorderTeams,
    setLocalOnCall: manager.setLocalOnCall,
    boardSettings: manager.boardSettings,
    toggleBoardLock: manager.toggleBoardLock,
    isBoardLockTogglePending: manager.isBoardLockTogglePending,
    tick: alerts.tick,
  };
}
