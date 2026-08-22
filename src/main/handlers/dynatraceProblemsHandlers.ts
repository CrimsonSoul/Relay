import { ipcMain } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import type {
  DynatraceProblemsPublicSettings,
  DynatraceProblemsTestResult,
} from '@shared/dynatraceProblems';
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
    IPC_CHANNELS.DYNATRACE_PROBLEMS_GET_SETTINGS,
    (event): DynatraceProblemsPublicSettings => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_PROBLEMS_GET_SETTINGS)) {
        return {
          configured: false,
          environmentUrl: '',
          profileFilterConfigured: false,
          selectedAlertingProfiles: [],
        };
      }
      return service.getSettings();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_PROFILE_FILTER,
    async (event, input: unknown): Promise<IpcResult<{ count: number }>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_PROFILE_FILTER)) {
        return { success: false, error: 'Untrusted sender' };
      }
      return service.saveProfileFilter(Array.isArray(input) ? input : []);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_SETTINGS,
    (event, input: unknown): IpcResult<DynatraceProblemsPublicSettings> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_SETTINGS)) {
        return { success: false, error: 'Untrusted sender' };
      }
      return service.saveSettings(input as never);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_PROBLEMS_TEST_SETTINGS,
    async (event, input: unknown): Promise<IpcResult<DynatraceProblemsTestResult>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_PROBLEMS_TEST_SETTINGS)) {
        return { success: false, error: 'Untrusted sender' };
      }
      return service.testSettings(input as never);
    },
  );

  ipcMain.handle(IPC_CHANNELS.DYNATRACE_PROBLEMS_CLEAR_SETTINGS, (event): IpcResult => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_PROBLEMS_CLEAR_SETTINGS)) {
      return { success: false, error: 'Untrusted sender' };
    }
    return service.clearSettings();
  });

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
