import { ipcMain } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import type { WorkstationAwakeState } from '@shared/workstationAwake';
import { loggers } from '../logger';
import { assertTrustedIpcSender } from '../utils/trustedSender';

const UNAVAILABLE_STATE: WorkstationAwakeState = {
  supported: false,
  enabled: false,
  status: 'unsupported',
};

type WorkstationAwakeServiceView = {
  getState: () => WorkstationAwakeState;
  setEnabled: (enabled: boolean) => WorkstationAwakeState;
};

export function setupWorkstationAwakeHandlers(
  getService: () => WorkstationAwakeServiceView | null,
): void {
  ipcMain.handle(IPC_CHANNELS.WORKSTATION_AWAKE_GET_STATE, (event): WorkstationAwakeState => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WORKSTATION_AWAKE_GET_STATE)) {
      return { ...UNAVAILABLE_STATE };
    }
    return getService()?.getState() ?? { ...UNAVAILABLE_STATE };
  });

  ipcMain.handle(
    IPC_CHANNELS.WORKSTATION_AWAKE_SET_ENABLED,
    (event, enabled: unknown): IpcResult<WorkstationAwakeState> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.WORKSTATION_AWAKE_SET_ENABLED)) {
        return { success: false, error: 'Workstation keep-awake is unavailable.' };
      }
      if (typeof enabled !== 'boolean') {
        return { success: false, error: 'Invalid workstation keep-awake preference.' };
      }
      const service = getService();
      if (!service) return { success: false, error: 'Workstation keep-awake is unavailable.' };

      try {
        return { success: true, data: service.setEnabled(enabled) };
      } catch (error) {
        loggers.main.error('Failed to update workstation keep-awake preference', { error });
        return { success: false, error: 'Could not save the workstation keep-awake preference.' };
      }
    },
  );
}
