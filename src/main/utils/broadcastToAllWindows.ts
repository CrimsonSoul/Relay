import { BrowserWindow } from 'electron';

/**
 * Broadcast an IPC message to all open BrowserWindows.
 * Skips any window that has already been destroyed.
 */
export function broadcastToAllWindows(channel: string, ...args: unknown[]): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args);
    }
  });
}
