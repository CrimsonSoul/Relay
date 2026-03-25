import { OnCallRow } from '@shared/ipc';
import { useOnCallManager } from './useOnCallManager';
import { useAlertDismissal } from './useAlertDismissal';

/**
 * Composes on-call CRUD and alert dismissal logic.
 * Kept as a thin wrapper for backward compatibility.
 */
export function usePersonnel(onCall: OnCallRow[]) {
  const alerts = useAlertDismissal();
  const manager = useOnCallManager(onCall, alerts.dismissAlert);

  return {
    localOnCall: manager.localOnCall,
    weekRange: manager.weekRange,
    dismissedAlerts: alerts.dismissedAlerts,
    dismissAlert: alerts.dismissAlert,
    dayOfWeek: alerts.dayOfWeek,
    teams: manager.teams,
    handleUpdateRows: manager.handleUpdateRows,
    handleRemoveTeam: manager.handleRemoveTeam,
    handleRenameTeam: manager.handleRenameTeam,
    handleAddTeam: manager.handleAddTeam,
    handleReorderTeams: manager.handleReorderTeams,
    setLocalOnCall: manager.setLocalOnCall,
    tick: alerts.tick,
  };
}
