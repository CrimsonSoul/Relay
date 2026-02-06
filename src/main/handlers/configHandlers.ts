import { ipcMain, dialog, BrowserWindow } from 'electron';
import { IPC_CHANNELS, type IpcResult } from '../../shared/ipc';

export function setupConfigHandlers(
  getMainWindow: () => BrowserWindow | null,
  getDataRoot: () => Promise<string>,
  onDataPathChange: (newPath: string) => Promise<void>,
  getDefaultDataPath: () => string
) {
  ipcMain.handle(IPC_CHANNELS.GET_DATA_PATH, async () => {
    return getDataRoot();
  });

  ipcMain.handle(IPC_CHANNELS.CHANGE_DATA_FOLDER, async (): Promise<IpcResult> => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { success: false, error: 'Main window not available' };

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select New Data Folder',
      properties: ['openDirectory']
    });

    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };

    try {
      await onDataPathChange(filePaths[0]);
      return { success: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.RESET_DATA_FOLDER, async (): Promise<IpcResult> => {
    const defaultPath = getDefaultDataPath();
    try {
      await onDataPathChange(defaultPath);
      return { success: true };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { success: false, error: message };
    }
  });
}
