import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { assertTrustedIpcSender } from '../../utils/trustedSender';
import { broadcastToAllWindows } from '../../utils/broadcastToAllWindows';

export function registerDragStartedHandler(): void {
  ipcMain.on(IPC_CHANNELS.DRAG_STARTED, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.DRAG_STARTED)) return;
    broadcastToAllWindows(IPC_CHANNELS.DRAG_STARTED);
  });
}

export function registerDragStoppedHandler(): void {
  ipcMain.on(IPC_CHANNELS.DRAG_STOPPED, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.DRAG_STOPPED)) return;
    broadcastToAllWindows(IPC_CHANNELS.DRAG_STOPPED);
  });
}

export function registerOnCallAlertDismissedHandler(): void {
  ipcMain.on(IPC_CHANNELS.ONCALL_ALERT_DISMISSED, (event, type: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ONCALL_ALERT_DISMISSED)) return;
    broadcastToAllWindows(IPC_CHANNELS.ONCALL_ALERT_DISMISSED, type);
  });
}
