import { app, ipcMain, BrowserWindow, clipboard, nativeImage, dialog, shell } from 'electron';
import { writeFile, readFile, stat, mkdir, unlink } from 'node:fs/promises';
import { basename, extname, normalize, parse, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLOUD_STATUS_PROVIDERS, IPC_CHANNELS } from '@shared/ipc';
import { getErrorMessage } from '@shared/types';
import { describeUrlForLog } from '@shared/urlSecurity';
import { loggers } from '../logger';
import { validatePath } from '../utils/pathSafety';
import { assertTrustedIpcSender } from '../utils/trustedSender';
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

const MAX_ICS_LENGTH = 1_048_576; // 1MB
const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_LOGO_WIDTH = 400;

function sanitizePngSuggestedName(suggestedName: unknown): string {
  if (typeof suggestedName !== 'string') return 'alert.png';
  const parsed = parse(basename(suggestedName.trim()));
  const stem = parsed.name.replaceAll(/[^a-zA-Z0-9._ -]/g, '').trim();
  return `${stem || 'alert'}.png`;
}

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

const ALLOWED_EXTERNAL_HOSTS = new Set([
  ...Object.values(CLOUD_STATUS_PROVIDERS).map((provider) =>
    new URL(provider.statusUrl).hostname.toLowerCase(),
  ),
  'teams.microsoft.com',
  'stspg.io',
  'statuspage.io',
  'x.com',
  'twitter.com',
  'downdetector.com',
]);

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'mailto:') {
      const address = parsed.pathname;
      const at = address.indexOf('@');
      const dotAfterAt = address.indexOf('.', at + 1);
      return (
        parsed.search === '' &&
        at > 0 &&
        dotAfterAt > at + 1 &&
        dotAfterAt < address.length - 1 &&
        !address.includes(' ') &&
        address.indexOf('@', at + 1) === -1
      );
    }
    if (parsed.protocol === 'msteams:') {
      // Teams desktop client deep links only
      return parsed.hostname.toLowerCase() === 'teams.microsoft.com';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function setupWindowHandlers(
  getMainWindow: () => BrowserWindow | null,
  createAuxWindow?: (route: string) => void,
  getDataRoot?: () => Promise<string>,
) {
  // Shell / File Operations
  ipcMain.handle(IPC_CHANNELS.OPEN_PATH, async (event, path: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.OPEN_PATH)) return;
    if (!rateLimiters.fsOperations.tryConsume().allowed) return;
    if (!getDataRoot) return;
    if (typeof path !== 'string' || path.trim().length === 0) {
      loggers.security.error('Blocked opening invalid path');
      return;
    }
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

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (event, url: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.OPEN_EXTERNAL)) return false;
    if (!rateLimiters.fsOperations.tryConsume().allowed) return false;
    try {
      if (typeof url === 'string' && isAllowedExternalUrl(url)) {
        await shell.openExternal(url);
        return true;
      }
      loggers.security.error(`Blocked opening external URL: ${describeUrlForLog(url)}`);
      return false;
    } catch {
      loggers.security.error(`Invalid URL provided to openExternal: ${describeUrlForLog(url)}`);
      return false;
    }
  });

  // Schedule Bridge (.ics) — write the invite to a temp file and open it with
  // the default calendar handler so the user can review and send it.
  ipcMain.handle(IPC_CHANNELS.ICS_SAVE_AND_OPEN, async (event, content: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ICS_SAVE_AND_OPEN)) return false;
    if (!rateLimiters.fsOperations.tryConsume().allowed) return false;
    if (typeof content !== 'string' || content.length === 0 || content.length >= MAX_ICS_LENGTH) {
      loggers.security.error('Blocked saving invalid ICS content');
      return false;
    }
    try {
      const filePath = join(app.getPath('temp'), `relay-bridge-${Date.now()}.ics`);
      await writeFile(filePath, content, 'utf8');
      // shell.openPath never rejects; it resolves with a non-empty error string on failure
      const openError = await shell.openPath(filePath);
      if (openError) {
        loggers.ipc.warn('ICS open failed', { error: openError });
        return false;
      }
      return true;
    } catch (err) {
      loggers.ipc.warn('ICS save and open failed', {
        error: getErrorMessage(err),
      });
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ALERT_PLAY_SOUND, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ALERT_PLAY_SOUND)) return false;
    try {
      shell.beep();
      return true;
    } catch (err) {
      loggers.ipc.warn('Alert sound failed', {
        error: getErrorMessage(err),
      });
      return false;
    }
  });

  ipcMain.handle(IPC_CHANNELS.ALERT_SELECT_REMINDER_SOUND, async (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ALERT_SELECT_REMINDER_SOUND)) {
      return { success: false, error: 'Untrusted sender' };
    }
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Reminder Alarm MP3',
        filters: [{ name: 'MP3 Audio', extensions: ['mp3'] }],
        properties: ['openFile'],
      });
      const filePath = filePaths[0];
      if (canceled || !filePath) {
        return { success: false, error: 'Cancelled' };
      }
      if (extname(filePath).toLowerCase() !== '.mp3') {
        return { success: false, error: 'Select an MP3 file' };
      }
      return { success: true, data: pathToFileURL(filePath).href };
    } catch (err) {
      loggers.ipc.warn('Reminder sound selection failed', {
        error: getErrorMessage(err),
      });
      return { success: false, error: err instanceof Error ? err.message : 'Selection failed' };
    }
  });

  // Window Controls
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WINDOW_MINIMIZE)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_OPEN_AUX, (event, route: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WINDOW_OPEN_AUX)) return;
    if (typeof route !== 'string' || !ALLOWED_AUX_ROUTES.has(route)) {
      return;
    }
    createAuxWindow?.(route);
  });

  // Drag Sync - broadcast to all windows
  ipcMain.on(IPC_CHANNELS.DRAG_STARTED, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.DRAG_STARTED)) return;
    broadcastToAllWindows(IPC_CHANNELS.DRAG_STARTED);
  });

  ipcMain.on(IPC_CHANNELS.DRAG_STOPPED, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.DRAG_STOPPED)) return;
    broadcastToAllWindows(IPC_CHANNELS.DRAG_STOPPED);
  });

  // On-Call Alert Dismissal Sync - broadcast to all windows
  ipcMain.on(IPC_CHANNELS.ONCALL_ALERT_DISMISSED, (event, type: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.ONCALL_ALERT_DISMISSED)) return;
    broadcastToAllWindows(IPC_CHANNELS.ONCALL_ALERT_DISMISSED, type);
  });

  // Clipboard - use Electron's native clipboard API
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE, async (event, text: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.CLIPBOARD_WRITE)) return false;
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
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE_IMAGE, async (event, dataUrl: string) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.CLIPBOARD_WRITE_IMAGE)) return false;
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
    async (event, dataUrl: string, suggestedName: string) => {
      if (!assertTrustedIpcSender(event, IPC_CHANNELS.SAVE_ALERT_IMAGE)) {
        return { success: false, error: 'Untrusted sender' };
      }
      try {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) {
          return { success: false, error: 'Invalid image data' };
        }
        if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
          return { success: false, error: 'Image data exceeds size limit' };
        }
        const image = nativeImage.createFromDataURL(dataUrl);
        if (image.isEmpty()) {
          return { success: false, error: 'Invalid image data' };
        }
        const { canceled, filePath } = await dialog.showSaveDialog({
          defaultPath: sanitizePngSuggestedName(suggestedName),
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
        });
        if (canceled || !filePath) {
          return { success: false, error: 'Cancelled' };
        }
        await writeFile(filePath, image.toPNG());
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
    ipcMain.handle(channels.save, async (event) => {
      if (!assertTrustedIpcSender(event, channels.save)) {
        return { success: false, error: 'Untrusted sender' };
      }
      if (!getDataRoot) return { success: false, error: 'Data root not available' };
      try {
        const { canceled, filePaths } = await dialog.showOpenDialog({
          title: dialogTitle,
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
          properties: ['openFile'],
        });
        if (canceled || !filePaths[0]) return { success: false, error: 'Cancelled' };

        const selectedFile = filePaths[0];
        const fileStat = await stat(selectedFile);
        if (fileStat.size > MAX_LOGO_SIZE) {
          return { success: false, error: 'Image must be under 2MB' };
        }

        const buf = await readFile(selectedFile);
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

    ipcMain.handle(channels.get, async (event) => {
      if (!assertTrustedIpcSender(event, channels.get)) return null;
      if (!getDataRoot) return null;
      try {
        const logoPath = join(await getDataRoot(), 'assets', fileName);
        const buf = await readFile(logoPath);
        return 'data:image/png;base64,' + buf.toString('base64');
      } catch {
        return null;
      }
    });

    ipcMain.handle(channels.remove, async (event) => {
      if (!assertTrustedIpcSender(event, channels.remove)) {
        return { success: false, error: 'Untrusted sender' };
      }
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
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WINDOW_MAXIMIZE)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WINDOW_CLOSE)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    loggers.main.info('Window close requested by renderer', {
      webContentsId: event.sender.id,
    });
    win?.close();
  });

  // Maximize state query
  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (event) => {
    if (!assertTrustedIpcSender(event, IPC_CHANNELS.WINDOW_IS_MAXIMIZED)) return false;
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
