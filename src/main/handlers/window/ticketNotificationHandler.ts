import { BrowserWindow, ipcMain, Notification } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { TicketNotificationPayloadSchema } from '@shared/serviceDesk';
import { assertTrustedIpcSender } from '../../utils/trustedSender';

// Native notifications are a desktop capability; Relay Web cannot invoke this handler.
export function registerTicketNotificationHandler(getMainWindow: () => BrowserWindow | null): void {
  let lastShown = 0;
  ipcMain.handle(IPC_CHANNELS.TICKET_NOTIFY, (event, payload: unknown) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.TICKET_NOTIFY)) return false;
    const parsed = TicketNotificationPayloadSchema.safeParse(payload);
    if (!parsed.success || !Notification.isSupported() || Date.now() - lastShown < 1000)
      return false;
    try {
      const notification = new Notification({ title: parsed.data.title, body: parsed.data.body });
      notification.on('click', () => {
        const window = getMainWindow();
        if (!window || window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        if (parsed.data.target)
          window.webContents.send(IPC_CHANNELS.TICKET_NOTIFY, parsed.data.target);
      });
      notification.show();
      lastShown = Date.now();
      return true;
    } catch {
      return false;
    }
  });
}
