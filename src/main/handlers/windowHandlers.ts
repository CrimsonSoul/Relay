import { ipcMain, BrowserWindow, clipboard } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';

export function setupWindowHandlers(getMainWindow: () => BrowserWindow | null) {
  // Window Controls
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    getMainWindow()?.minimize();
  });

  // Clipboard - use Electron's native clipboard API
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE, async (_, text: string) => {
    try {
      clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  });
  
  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    const mw = getMainWindow();
    if (mw?.isMaximized()) {
      mw.unmaximize();
    } else {
      mw?.maximize();
    }
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    getMainWindow()?.close();
  });

  // Maximize state query
  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, () => {
    return getMainWindow()?.isMaximized() ?? false;
  });

  // Listen for maximize/unmaximize events and notify renderer
  // Note: This needs to be called when window is created, but here we just setup the IPCs.
  // The event listeners on the window itself should be attached where the window is created or managed.
  // HOWEVER, the original code attached them inside setupIpcHandlers which had access to getMainWindow().
  // We can't attach listeners to the window instance here easily if it changes or isn't created yet,
  // but if getMainWindow returns the current instance, we can try.
  // A better pattern might be to let the main process setup these listeners on window creation.
  // For now, we'll keep the IPCs here. The window event listeners (maximize/unmaximize) 
  // were in the body of setupIpcHandlers. We'll export a helper for that too.
}

export function setupWindowListeners(window: BrowserWindow) {
  window.on('maximize', () => {
    window.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, true);
  });
  window.on('unmaximize', () => {
    window.webContents.send(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, false);
  });
}
