import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { assertTrustedIpcSender } from '../../utils/trustedSender';
import { broadcastToAllWindows } from '../../utils/broadcastToAllWindows';

// Matches the Relay Web alert-dismissed body limit.
const MAX_ALERT_TYPE_LENGTH = 128;

export function registerOnCallAlertDismissedHandler(): void {
  ipcMain.on(IPC_CHANNELS.ONCALL_ALERT_DISMISSED, (event, type: unknown) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ONCALL_ALERT_DISMISSED)) return;
    if (typeof type !== 'string') return;
    const trimmed = type.trim();
    if (!trimmed || trimmed.length > MAX_ALERT_TYPE_LENGTH) return;
    broadcastToAllWindows(IPC_CHANNELS.ONCALL_ALERT_DISMISSED, trimmed);
  });
}
