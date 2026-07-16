import { ipcMain } from 'electron';
import { z } from 'zod';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import {
  MAX_DYNATRACE_API_TOKEN_LENGTH,
  MAX_DYNATRACE_ALERTING_PROFILES,
  MAX_DYNATRACE_ALERTING_PROFILE_LENGTH,
  getDynatraceApiTokenError,
  getDynatraceEnvironmentUrlError,
  type DynatraceProblemsPublicSettings,
  type DynatraceProblemsSettingsInput,
  type DynatraceProblemsTestResult,
} from '@shared/dynatraceProblems';
import { getErrorMessage } from '@shared/types';
import type { AppConfig } from '../config/AppConfig';
import type { DynatraceProblemsManager } from '../dynatrace/DynatraceProblemsManager';
import { assertTrustedIpcSender } from '../utils/trustedSender';

const inputSchema = z.object({
  environmentUrl: z.string().max(2048),
  apiToken: z.string().max(MAX_DYNATRACE_API_TOKEN_LENGTH).optional(),
});

const profileFilterSchema = z
  .array(z.string().trim().min(1).max(MAX_DYNATRACE_ALERTING_PROFILE_LENGTH))
  .min(1)
  .max(MAX_DYNATRACE_ALERTING_PROFILES)
  .transform((profiles) => [...new Set(profiles)]);

const unavailableSettings: DynatraceProblemsPublicSettings = {
  configured: false,
  environmentUrl: '',
  profileFilterConfigured: false,
  selectedAlertingProfiles: [],
};

function failure<T = void>(error: unknown): IpcResult<T> {
  return { success: false, error: getErrorMessage(error) };
}

function parseInput(value: unknown, requireToken: boolean): DynatraceProblemsSettingsInput {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw new Error('Invalid Dynatrace Problems configuration.');

  const environmentError = getDynatraceEnvironmentUrlError(parsed.data.environmentUrl);
  if (environmentError) throw new Error(environmentError);

  if (requireToken || parsed.data.apiToken?.trim()) {
    const tokenError = getDynatraceApiTokenError(parsed.data.apiToken ?? '');
    if (tokenError) throw new Error(tokenError);
  }

  return parsed.data;
}

export function setupDynatraceProblemsHandlers(
  getManager: () => DynatraceProblemsManager | null,
  getAppConfig: () => AppConfig | null,
): void {
  const isServer = () => getAppConfig()?.load()?.mode === 'server';

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_PROBLEMS_GET_SETTINGS,
    (event): DynatraceProblemsPublicSettings => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_PROBLEMS_GET_SETTINGS)) {
        return unavailableSettings;
      }
      if (!isServer()) return unavailableSettings;
      return getManager()?.getSettings() ?? unavailableSettings;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_PROFILE_FILTER,
    async (event, input: unknown): Promise<IpcResult<{ count: number }>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_PROFILE_FILTER)) {
        return failure('Untrusted sender');
      }
      if (!isServer()) return failure('Save the alerting profile filter on the Relay server.');
      const manager = getManager();
      if (!manager) return failure('Dynatrace Problems manager is unavailable.');

      try {
        const parsed = profileFilterSchema.safeParse(input);
        if (!parsed.success) throw new Error('Select at least one valid alerting profile.');
        return {
          success: true,
          data: { count: await manager.saveAlertingProfiles(parsed.data) },
        };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_SETTINGS,
    (event, input: unknown): IpcResult<DynatraceProblemsPublicSettings> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_PROBLEMS_SAVE_SETTINGS)) {
        return failure('Untrusted sender');
      }
      if (!isServer()) return failure('Configure Dynatrace Problems on the Relay server.');
      const manager = getManager();
      if (!manager) return failure('Dynatrace Problems manager is unavailable.');

      try {
        const existing = manager.getSettings();
        const parsed = parseInput(input, !existing.configured);
        return { success: true, data: manager.saveSettings(parsed) };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_PROBLEMS_TEST_SETTINGS,
    async (event, input: unknown): Promise<IpcResult<DynatraceProblemsTestResult>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_PROBLEMS_TEST_SETTINGS)) {
        return failure('Untrusted sender');
      }
      if (!isServer()) return failure('Test Dynatrace Problems on the Relay server.');
      const manager = getManager();
      if (!manager) return failure('Dynatrace Problems manager is unavailable.');

      try {
        const existing = manager.getSettings();
        const parsed = parseInput(input, !existing.configured);
        return { success: true, data: await manager.testSettings(parsed) };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.DYNATRACE_PROBLEMS_CLEAR_SETTINGS, (event): IpcResult => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_PROBLEMS_CLEAR_SETTINGS)) {
      return failure('Untrusted sender');
    }
    if (!isServer()) return failure('Configure Dynatrace Problems on the Relay server.');
    const manager = getManager();
    if (!manager) return failure('Dynatrace Problems manager is unavailable.');
    return manager.clearSettings() ? { success: true } : failure('Could not remove configuration.');
  });

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_PROBLEMS_SYNC,
    async (event): Promise<IpcResult<{ count: number }>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_PROBLEMS_SYNC)) {
        return failure('Untrusted sender');
      }
      if (!isServer()) return failure('Sync Dynatrace Problems from the Relay server.');
      const manager = getManager();
      if (!manager) return failure('Dynatrace Problems manager is unavailable.');

      try {
        return { success: true, data: { count: await manager.syncNow(true) } };
      } catch (error) {
        return failure(error);
      }
    },
  );
}
