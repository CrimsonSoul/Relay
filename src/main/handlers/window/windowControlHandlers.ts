import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { loggers } from '../../logger';
import { assertTrustedIpcSender } from '../../utils/trustedSender';

export function registerWindowMinimizeHandler(): void {
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WINDOW_MINIMIZE)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });
}

export function registerWindowMaximizeHandler(): void {
  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WINDOW_MAXIMIZE)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
}

export function registerWindowCloseHandler(): void {
  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WINDOW_CLOSE)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    loggers.main.info('Window close requested by renderer', { webContentsId: event.sender.id });
    win?.close();
  });
}

export function registerWindowIsMaximizedHandler(): void {
  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WINDOW_IS_MAXIMIZED)) return false;
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isMaximized() ?? false;
  });
}
