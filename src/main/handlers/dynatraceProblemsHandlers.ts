import { ipcMain } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import type { AppConfig } from '../config/AppConfig';
import type { DynatraceProblemsManager } from '../dynatrace/DynatraceProblemsManager';
import { DynatraceProblemsService } from '../services/operationalServices';
import { assertTrustedIpcSender } from '../utils/trustedSender';

export function setupDynatraceProblemsHandlers(
  getManager: () => DynatraceProblemsManager | null,
  getAppConfig: () => AppConfig | null,
): void {
  const service = new DynatraceProblemsService(getManager, getAppConfig);

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_PROBLEMS_SYNC,
    async (event): Promise<IpcResult<{ count: number }>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_PROBLEMS_SYNC)) {
        return { success: false, error: 'Untrusted sender' };
      }
      return service.sync();
    },
  );
}
