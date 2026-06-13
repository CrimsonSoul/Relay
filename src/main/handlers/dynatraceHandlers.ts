import { ipcMain } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import type { DynatraceDashboardInput, DynatraceDashboardState } from '@shared/dynatrace';
import { getErrorMessage } from '@shared/types';
import type { DynatraceWindowManager } from '../dynatrace/DynatraceWindowManager';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';
import { assertTrustedIpcSender } from '../utils/trustedSender';

const untrustedResult = <T = void>(): IpcResult<T> => ({
  success: false,
  error: 'Untrusted sender',
});
const unavailableResult = <T = void>(): IpcResult<T> => ({
  success: false,
  error: 'Dynatrace manager not available',
});
const notFoundResult = <T = void>(): IpcResult<T> => ({
  success: false,
  error: 'Dynatrace dashboard not found',
});

function failure<T = void>(error: unknown): IpcResult<T> {
  return { success: false, error: getErrorMessage(error) };
}

export function setupDynatraceHandlers(manager: DynatraceWindowManager | null | undefined): void {
  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_LIST_DASHBOARDS,
    async (event): Promise<DynatraceDashboardState[]> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_LIST_DASHBOARDS)) return [];
      if (!manager) return [];

      return manager.listDashboards();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_ADD_DASHBOARD,
    async (event, input: DynatraceDashboardInput): Promise<IpcResult<DynatraceDashboardState>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_ADD_DASHBOARD)) {
        return untrustedResult();
      }
      if (!manager) return unavailableResult();

      try {
        return { success: true, data: manager.addDashboard(input) };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_UPDATE_DASHBOARD,
    async (
      event,
      id: string,
      input: DynatraceDashboardInput,
    ): Promise<IpcResult<DynatraceDashboardState>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_UPDATE_DASHBOARD)) {
        return untrustedResult();
      }
      if (!manager) return unavailableResult();

      try {
        const dashboard = manager.updateDashboard(id, input);
        if (!dashboard) return notFoundResult();
        return { success: true, data: dashboard };
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_REMOVE_DASHBOARD,
    async (event, id: string): Promise<IpcResult> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_REMOVE_DASHBOARD)) {
        return untrustedResult();
      }
      if (!manager) return unavailableResult();

      try {
        return manager.removeDashboard(id) ? { success: true } : notFoundResult();
      } catch (error) {
        return failure(error);
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.DYNATRACE_OPEN_DASHBOARD, async (event, id: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_OPEN_DASHBOARD)) return false;
    if (!manager) return false;

    try {
      return await manager.openDashboard(id);
    } catch {
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.DYNATRACE_CLEAR_SESSION, async (event): Promise<IpcResult> => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_CLEAR_SESSION)) {
      return untrustedResult();
    }
    if (!manager) return unavailableResult();

    try {
      await manager.clearSession();
      return { success: true };
    } catch (error) {
      return failure(error);
    }
  });

  manager?.onStateChange((dashboards) => {
    broadcastToAllWindows(IPC_CHANNELS.DYNATRACE_DASHBOARDS_CHANGED, dashboards);
  });
}
