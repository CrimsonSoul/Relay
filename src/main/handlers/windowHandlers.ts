import { ipcMain, BrowserWindow, clipboard } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';

const ALLOWED_AUX_ROUTES = new Set(['oncall', 'weather', 'directory', 'servers', 'assembler', 'personnel', 'popout/board']);
const MAX_CLIPBOARD_LENGTH = 1_048_576; // 1MB

export function setupWindowHandlers(
  getMainWindow: () => BrowserWindow | null,
  createAuxWindow?: (route: string) => void
) {
  // Window Controls
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_OPEN_AUX, (_, route: string) => {
    if (typeof route !== 'string' || !ALLOWED_AUX_ROUTES.has(route)) {
      return;
    }
    createAuxWindow?.(route);
  });

  // Drag Sync - broadcast to all windows
  ipcMain.on(IPC_CHANNELS.DRAG_STARTED, () => {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.DRAG_STARTED);
      }
    });
  });

  ipcMain.on(IPC_CHANNELS.DRAG_STOPPED, () => {
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC_CHANNELS.DRAG_STOPPED);
      }
    });
  });

  // Clipboard - use Electron's native clipboard API
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE, async (_, text: string) => {
    try {
      if (typeof text !== 'string' || text.length > MAX_CLIPBOARD_LENGTH) {
        return false;
      }
      clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  });
  
  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  // Maximize state query
  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isMaximized() ?? false;
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
