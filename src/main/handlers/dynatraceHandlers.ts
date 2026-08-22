import { ipcMain } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '@shared/ipc';
import type { DynatraceDashboardInput, DynatraceDashboardState } from '@shared/dynatrace';
import type { DynatraceWindowManager } from '../dynatrace/DynatraceWindowManager';
import { DynatraceDashboardService } from '../services/operationalServices';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';
import { assertTrustedIpcSender } from '../utils/trustedSender';

const untrustedResult = <T = void>(): IpcResult<T> => ({
  success: false,
  error: 'Untrusted sender',
});
export function setupDynatraceHandlers(manager: DynatraceWindowManager | null | undefined): void {
  const service = new DynatraceDashboardService(() => manager ?? null);
  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_LIST_DASHBOARDS,
    async (event): Promise<DynatraceDashboardState[]> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_LIST_DASHBOARDS)) return [];
      return service.list();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_ADD_DASHBOARD,
    async (event, input: DynatraceDashboardInput): Promise<IpcResult<DynatraceDashboardState>> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_ADD_DASHBOARD)) {
        return untrustedResult();
      }
      return service.add(input);
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
      return service.update(id, input);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.DYNATRACE_REMOVE_DASHBOARD,
    async (event, id: string): Promise<IpcResult> => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_REMOVE_DASHBOARD)) {
        return untrustedResult();
      }
      return service.remove(id);
    },
  );

  ipcMain.handle(IPC_CHANNELS.DYNATRACE_OPEN_DASHBOARD, async (event, id: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_OPEN_DASHBOARD)) return false;
    return service.open(id);
  });

  ipcMain.handle(IPC_CHANNELS.DYNATRACE_CLEAR_SESSION, async (event): Promise<IpcResult> => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.DYNATRACE_CLEAR_SESSION)) {
      return untrustedResult();
    }
    return service.clearSession();
  });

  service.onChange((dashboards) => {
    broadcastToAllWindows(IPC_CHANNELS.DYNATRACE_DASHBOARDS_CHANGED, dashboards);
  });
}
