import { ipcMain, BrowserWindow, clipboard, nativeImage, dialog, shell } from 'electron';
import { writeFile, readFile, mkdir, unlink } from 'node:fs/promises';
import { extname, normalize, resolve, join } from 'node:path';
import { IPC_CHANNELS } from '@shared/ipc';
import { getErrorMessage } from '@shared/types';
import { loggers } from '../logger';
import { validatePath } from '../utils/pathSafety';
import { broadcastToAllWindows } from '../utils/broadcastToAllWindows';
import { rateLimiters } from '../rateLimiter';

export const ALLOWED_AUX_ROUTES = new Set([
  'oncall',
  'directory',
  'servers',
  'assembler',
  'personnel',
  'popout/board',
]);
const MAX_CLIPBOARD_LENGTH = 1_048_576; // 1MB
const MAX_IMAGE_DATA_URL_LENGTH = 10 * 1024 * 1024; // 10MB max for image data URLs

const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_LOGO_WIDTH = 400;

/** Safe file extensions allowed for shell.openPath */
const SAFE_OPEN_EXTENSIONS = new Set([
  '.csv',
  '.json',
  '.txt',
  '.log',
  '.md',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
]);

export function setupWindowHandlers(
  getMainWindow: () => BrowserWindow | null,
  createAuxWindow?: (route: string) => void,
  getDataRoot?: () => Promise<string>,
) {
  // Shell / File Operations
  ipcMain.handle(IPC_CHANNELS.OPEN_PATH, async (_event, path: string) => {
    if (!rateLimiters.fsOperations.tryConsume().allowed) return;
    if (!getDataRoot) return;
    const root = await getDataRoot();
    const resolvedPath = resolve(root, normalize(path));

    if (!(await validatePath(resolvedPath, root))) {
      loggers.security.error(`Blocked access to path outside data root: ${path}`);
      return;
    }
    const ext = extname(resolvedPath).toLowerCase();
    if (!SAFE_OPEN_EXTENSIONS.has(ext)) {
      loggers.security.error(`Blocked opening file with unsafe extension: ${path}`);
      return;
    }
    await shell.openPath(resolvedPath);
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_event, url: string) => {
    if (!rateLimiters.fsOperations.tryConsume().allowed) return;
    try {
      const parsed = new URL(url);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        await shell.openExternal(url);
      } else {
        loggers.security.error(`Blocked opening external URL with unsafe protocol: ${url}`);
      }
    } catch {
      loggers.security.error(`Invalid URL provided to openExternal: ${url}`);
    }
  });

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
    broadcastToAllWindows(IPC_CHANNELS.DRAG_STARTED);
  });

  ipcMain.on(IPC_CHANNELS.DRAG_STOPPED, () => {
    broadcastToAllWindows(IPC_CHANNELS.DRAG_STOPPED);
  });

  // On-Call Alert Dismissal Sync - broadcast to all windows
  ipcMain.on(IPC_CHANNELS.ONCALL_ALERT_DISMISSED, (_event, type: string) => {
    broadcastToAllWindows(IPC_CHANNELS.ONCALL_ALERT_DISMISSED, type);
  });

  // Clipboard - use Electron's native clipboard API
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE, async (_, text: string) => {
    try {
      if (typeof text !== 'string' || text.length > MAX_CLIPBOARD_LENGTH) {
        return false;
      }
      clipboard.writeText(text);
      return true;
    } catch (err) {
      loggers.ipc.warn('Clipboard write failed', {
        error: getErrorMessage(err),
      });
      return false;
    }
  });

  // Clipboard Image - write PNG data URL to clipboard as native image
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE_IMAGE, async (_, dataUrl: string) => {
    try {
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
        return false;
      }
      if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
        loggers.ipc.warn('Clipboard image data URL exceeds size limit');
        return false;
      }
      const image = nativeImage.createFromDataURL(dataUrl);
      if (image.isEmpty()) return false;
      clipboard.writeImage(image);
      return true;
    } catch (err) {
      loggers.ipc.warn('Clipboard image write failed', {
        error: getErrorMessage(err),
      });
      return false;
    }
  });

  // Save Alert Image - native save dialog + write PNG to disk
  ipcMain.handle(
    IPC_CHANNELS.SAVE_ALERT_IMAGE,
    async (_, dataUrl: string, suggestedName: string) => {
      try {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
          return { success: false, error: 'Invalid image data' };
        }
        if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
          return { success: false, error: 'Image data exceeds size limit' };
        }
        const { canceled, filePath } = await dialog.showSaveDialog({
          defaultPath: suggestedName || 'alert.png',
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        });
        if (canceled || !filePath) {
          return { success: false, error: 'Cancelled' };
        }
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        await writeFile(filePath, Buffer.from(base64, 'base64'));
        return { success: true, data: filePath };
      } catch (err) {
        loggers.ipc.warn('Alert image save failed', {
          error: getErrorMessage(err),
        });
        return { success: false, error: err instanceof Error ? err.message : 'Save failed' };
      }
    },
  );

  // Logo handlers — factory for save/get/remove pattern
  function createLogoHandlers(
    fileName: string,
    dialogTitle: string,
    channels: { save: string; get: string; remove: string },
  ): void {
    ipcMain.handle(channels.save, async () => {
      if (!getDataRoot) return { success: false, error: 'Data root not available' };
      try {
        const { canceled, filePaths } = await dialog.showOpenDialog({
          title: dialogTitle,
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
          properties: ['openFile'],
        });
        if (canceled || !filePaths[0]) return { success: false, error: 'Cancelled' };

        const buf = await readFile(filePaths[0]);
        if (buf.length > MAX_LOGO_SIZE) {
          return { success: false, error: 'Image must be under 2MB' };
        }

        let image = nativeImage.createFromBuffer(buf);
        if (image.isEmpty()) return { success: false, error: 'Invalid image file' };

        const { width } = image.getSize();
        if (width > MAX_LOGO_WIDTH) {
          image = image.resize({ width: MAX_LOGO_WIDTH });
        }

        const assetsDir = join(await getDataRoot(), 'assets');
        await mkdir(assetsDir, { recursive: true });
        const logoPath = join(assetsDir, fileName);
        const pngBuffer = image.toPNG();
        await writeFile(logoPath, pngBuffer);

        const dataUrl = 'data:image/png;base64,' + pngBuffer.toString('base64');
        return { success: true, data: dataUrl };
      } catch (err) {
        loggers.ipc.warn(`${dialogTitle} save failed`, {
          error: getErrorMessage(err),
        });
        return { success: false, error: err instanceof Error ? err.message : 'Save failed' };
      }
    });

    ipcMain.handle(channels.get, async () => {
      if (!getDataRoot) return null;
      try {
        const logoPath = join(await getDataRoot(), 'assets', fileName);
        const buf = await readFile(logoPath);
        return 'data:image/png;base64,' + buf.toString('base64');
      } catch {
        return null;
      }
    });

    ipcMain.handle(channels.remove, async () => {
      if (!getDataRoot) return { success: false, error: 'Data root not available' };
      try {
        const logoPath = join(await getDataRoot(), 'assets', fileName);
        await unlink(logoPath);
        return { success: true };
      } catch (err) {
        if (
          err instanceof Error &&
          'code' in err &&
          (err as NodeJS.ErrnoException).code === 'ENOENT'
        )
          return { success: true };
        return { success: false, error: err instanceof Error ? err.message : 'Remove failed' };
      }
    });
  }

  createLogoHandlers('company-logo.png', 'Select Company Logo', {
    save: IPC_CHANNELS.SAVE_COMPANY_LOGO,
    get: IPC_CHANNELS.GET_COMPANY_LOGO,
    remove: IPC_CHANNELS.REMOVE_COMPANY_LOGO,
  });

  createLogoHandlers('footer-logo.png', 'Select Footer Logo', {
    save: IPC_CHANNELS.SAVE_FOOTER_LOGO,
    get: IPC_CHANNELS.GET_FOOTER_LOGO,
    remove: IPC_CHANNELS.REMOVE_FOOTER_LOGO,
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
