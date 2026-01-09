import { ipcMain, dialog, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';

export function setupConfigHandlers(
  getMainWindow: () => BrowserWindow | null,
  getDataRoot: () => string,
  onDataPathChange: (newPath: string) => void,
  getDefaultDataPath: () => string
) {
  ipcMain.handle(IPC_CHANNELS.GET_DATA_PATH, async () => {
    return getDataRoot();
  });

  ipcMain.handle(IPC_CHANNELS.CHANGE_DATA_FOLDER, async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow) return { success: false, error: 'Main window not available' };

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Select New Data Folder',
      properties: ['openDirectory']
    });

    if (canceled || filePaths.length === 0) return { success: false, error: 'Cancelled' };

    try {
      onDataPathChange(filePaths[0]);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.RESET_DATA_FOLDER, async () => {
    const defaultPath = getDefaultDataPath();
    try {
      onDataPathChange(defaultPath);
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  });
}
