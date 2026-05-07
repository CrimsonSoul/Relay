import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain, BrowserWindow, clipboard, nativeImage, shell, dialog } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupWindowHandlers, setupWindowListeners, ALLOWED_AUX_ROUTES } from './windowHandlers';

const mockNativeImage = {
  isEmpty: vi.fn(() => false),
  getSize: vi.fn(() => ({ width: 100, height: 100 })),
  resize: vi.fn(),
  toPNG: vi.fn(() => Buffer.from('png-data')),
};
// Make resize return a new image-like object
mockNativeImage.resize.mockReturnValue(mockNativeImage);

vi.mock('electron', () => {
  const mockWin = {
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    isMaximized: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    webContents: {
      send: vi.fn(),
    },
    on: vi.fn(),
  };
  return {
    ipcMain: {
      on: vi.fn(),
      handle: vi.fn(),
    },
    BrowserWindow: Object.assign(
      vi.fn(() => mockWin),
      {
        fromWebContents: vi.fn(() => mockWin),
        getAllWindows: vi.fn(() => [mockWin]),
      },
    ),
    clipboard: {
      writeText: vi.fn(),
      writeImage: vi.fn(),
    },
    nativeImage: {
      createFromDataURL: vi.fn(),
      createFromBuffer: vi.fn(),
    },
    shell: {
      openPath: vi.fn(),
      openExternal: vi.fn(),
    },
    dialog: {
      showSaveDialog: vi.fn(),
      showOpenDialog: vi.fn(),
    },
  };
});

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  readFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
}));

vi.mock('../logger', () => ({
  loggers: {
    ipc: {
      warn: vi.fn(),
      error: vi.fn(),
    },
    security: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('../utils/pathSafety', () => ({
  validatePath: vi.fn(),
}));

vi.mock('../utils/broadcastToAllWindows', () => ({
  broadcastToAllWindows: vi.fn(),
}));

vi.mock('../rateLimiter', () => ({
  rateLimiters: {
    fsOperations: {
      tryConsume: vi.fn(() => ({ allowed: true })),
    },
  },
}));

import { validatePath } from '../utils/pathSafety';
import { rateLimiters } from '../rateLimiter';
import { readFile, unlink } from 'node:fs/promises';

describe('windowHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const onHandlers: Record<string, (...args: unknown[]) => unknown> = {};
  const getMainWindow = vi.fn(() => null as BrowserWindow | null);
  const createAuxWindow = vi.fn();
  const getDataRoot = vi.fn(async () => '/data/root');

  let mockWin: ReturnType<typeof BrowserWindow>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockWin = {
      minimize: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
      isDestroyed: vi.fn(() => false),
      webContents: { send: vi.fn() },
      on: vi.fn(),
    } as unknown as ReturnType<typeof BrowserWindow>;

    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWin as BrowserWindow);
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWin as BrowserWindow]);

    vi.mocked(ipcMain.on).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        onHandlers[channel] = handler;
        return ipcMain;
      },
    );
    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers[channel] = handler;
        return ipcMain;
      },
    );

    vi.mocked(rateLimiters.fsOperations.tryConsume).mockReturnValue({ allowed: true });

    setupWindowHandlers(getMainWindow, createAuxWindow, getDataRoot);
  });

  describe('ALLOWED_AUX_ROUTES', () => {
    it('contains expected routes', () => {
      expect(ALLOWED_AUX_ROUTES.has('oncall')).toBe(true);
      expect(ALLOWED_AUX_ROUTES.has('directory')).toBe(true);
      expect(ALLOWED_AUX_ROUTES.has('servers')).toBe(true);
      expect(ALLOWED_AUX_ROUTES.has('assembler')).toBe(true);
      expect(ALLOWED_AUX_ROUTES.has('popout/board')).toBe(true);
    });

    it('does not contain disallowed routes', () => {
      expect(ALLOWED_AUX_ROUTES.has('admin')).toBe(false);
      expect(ALLOWED_AUX_ROUTES.has('../evil')).toBe(false);
    });
  });

  describe('OPEN_PATH', () => {
    it('opens a valid path with allowed extension', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);

      await handlers[IPC_CHANNELS.OPEN_PATH]({}, 'exports/report.csv');

      expect(shell.openPath).toHaveBeenCalled();
    });

    it('blocks path traversal attempts', async () => {
      vi.mocked(validatePath).mockResolvedValue(false);

      await handlers[IPC_CHANNELS.OPEN_PATH]({}, '../../etc/passwd');

      expect(shell.openPath).not.toHaveBeenCalled();
    });

    it('blocks files with unsafe extensions', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);

      await handlers[IPC_CHANNELS.OPEN_PATH]({}, 'malware.exe');

      expect(shell.openPath).not.toHaveBeenCalled();
    });

    it('blocks .sh files', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);

      await handlers[IPC_CHANNELS.OPEN_PATH]({}, 'script.sh');

      expect(shell.openPath).not.toHaveBeenCalled();
    });

    it('allows .pdf files', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);

      await handlers[IPC_CHANNELS.OPEN_PATH]({}, 'document.pdf');

      expect(shell.openPath).toHaveBeenCalled();
    });

    it('allows .json files', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);

      await handlers[IPC_CHANNELS.OPEN_PATH]({}, 'data.json');

      expect(shell.openPath).toHaveBeenCalled();
    });

    it('allows .txt files', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);

      await handlers[IPC_CHANNELS.OPEN_PATH]({}, 'notes.txt');

      expect(shell.openPath).toHaveBeenCalled();
    });

    it('allows .png files', async () => {
      vi.mocked(validatePath).mockResolvedValue(true);

      await handlers[IPC_CHANNELS.OPEN_PATH]({}, 'image.png');

      expect(shell.openPath).toHaveBeenCalled();
    });

    it('returns early when rate limited', async () => {
      vi.mocked(rateLimiters.fsOperations.tryConsume).mockReturnValue({ allowed: false });

      await handlers[IPC_CHANNELS.OPEN_PATH]({}, 'report.csv');

      expect(validatePath).not.toHaveBeenCalled();
      expect(shell.openPath).not.toHaveBeenCalled();
    });

    it('returns early when getDataRoot is not provided', async () => {
      vi.clearAllMocks();
      vi.mocked(ipcMain.on).mockImplementation(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          onHandlers[channel] = handler;
          return ipcMain;
        },
      );
      vi.mocked(ipcMain.handle).mockImplementation(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers[channel] = handler;
          return ipcMain;
        },
      );
      vi.mocked(rateLimiters.fsOperations.tryConsume).mockReturnValue({ allowed: true });

      setupWindowHandlers(getMainWindow, createAuxWindow); // no getDataRoot

      await handlers[IPC_CHANNELS.OPEN_PATH]({}, 'report.csv');

      expect(shell.openPath).not.toHaveBeenCalled();
    });
  });

  describe('OPEN_EXTERNAL', () => {
    it('opens valid http URL', async () => {
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL]({}, 'http://example.com');

      expect(shell.openExternal).toHaveBeenCalledWith('http://example.com');
    });

    it('opens valid https URL', async () => {
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL]({}, 'https://example.com');

      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
    });

    it('opens valid mailto URL', async () => {
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL]({}, 'mailto:user@example.com');

      expect(shell.openExternal).toHaveBeenCalledWith('mailto:user@example.com');
    });

    it('blocks file: protocol', async () => {
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL]({}, 'file:///etc/passwd');

      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('blocks javascript: protocol', async () => {
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL]({}, 'javascript:alert(1)');

      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('blocks ftp: protocol', async () => {
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL]({}, 'ftp://files.example.com');

      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('handles invalid URL gracefully', async () => {
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL]({}, 'not a url at all');

      expect(shell.openExternal).not.toHaveBeenCalled();
    });

    it('returns early when rate limited', async () => {
      vi.mocked(rateLimiters.fsOperations.tryConsume).mockReturnValue({ allowed: false });

      await handlers[IPC_CHANNELS.OPEN_EXTERNAL]({}, 'https://example.com');

      expect(shell.openExternal).not.toHaveBeenCalled();
    });
  });

  describe('CLIPBOARD_WRITE_IMAGE', () => {
    it('writes valid PNG data URL to clipboard', async () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
      vi.mocked(nativeImage.createFromDataURL).mockReturnValue(mockNativeImage as never);

      const result = await handlers[IPC_CHANNELS.CLIPBOARD_WRITE_IMAGE]({}, dataUrl);

      expect(nativeImage.createFromDataURL).toHaveBeenCalledWith(dataUrl);
      expect(clipboard.writeImage).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('returns false for non-string input', async () => {
      const result = await handlers[IPC_CHANNELS.CLIPBOARD_WRITE_IMAGE]({}, 42);

      expect(result).toBe(false);
    });

    it('returns false for non-PNG data URL', async () => {
      const result = await handlers[IPC_CHANNELS.CLIPBOARD_WRITE_IMAGE](
        {},
        'data:image/jpeg;base64,abc',
      );

      expect(result).toBe(false);
    });

    it('returns false for data URL exceeding 10MB', async () => {
      const bigDataUrl = 'data:image/png;base64,' + 'A'.repeat(10 * 1024 * 1024 + 1);

      const result = await handlers[IPC_CHANNELS.CLIPBOARD_WRITE_IMAGE]({}, bigDataUrl);

      expect(result).toBe(false);
    });

    it('returns false when nativeImage is empty', async () => {
      const emptyImage = { isEmpty: vi.fn(() => true) };
      vi.mocked(nativeImage.createFromDataURL).mockReturnValue(emptyImage as never);

      const result = await handlers[IPC_CHANNELS.CLIPBOARD_WRITE_IMAGE](
        {},
        'data:image/png;base64,abc',
      );

      expect(result).toBe(false);
    });

    it('returns false when clipboard.writeImage throws', async () => {
      vi.mocked(nativeImage.createFromDataURL).mockReturnValue(mockNativeImage as never);
      vi.mocked(clipboard.writeImage).mockImplementationOnce(() => {
        throw new Error('clipboard fail');
      });

      const result = await handlers[IPC_CHANNELS.CLIPBOARD_WRITE_IMAGE](
        {},
        'data:image/png;base64,abc',
      );

      expect(result).toBe(false);
    });
  });

  describe('WINDOW_MINIMIZE', () => {
    it('minimizes the window', () => {
      const event = { sender: {} };
      onHandlers[IPC_CHANNELS.WINDOW_MINIMIZE](event);
      expect(mockWin.minimize).toHaveBeenCalled();
    });

    it('handles null window gracefully', () => {
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(
        null as unknown as BrowserWindow,
      );
      const event = { sender: {} };
      expect(() => onHandlers[IPC_CHANNELS.WINDOW_MINIMIZE](event)).not.toThrow();
    });
  });

  describe('WINDOW_OPEN_AUX', () => {
    it('calls createAuxWindow for allowed route', () => {
      onHandlers[IPC_CHANNELS.WINDOW_OPEN_AUX](null, 'oncall');
      expect(createAuxWindow).toHaveBeenCalledWith('oncall');
    });

    it('ignores non-string route', () => {
      onHandlers[IPC_CHANNELS.WINDOW_OPEN_AUX](null, 123);
      expect(createAuxWindow).not.toHaveBeenCalled();
    });

    it('ignores disallowed route', () => {
      onHandlers[IPC_CHANNELS.WINDOW_OPEN_AUX](null, 'admin');
      expect(createAuxWindow).not.toHaveBeenCalled();
    });

    it('handles missing createAuxWindow gracefully', () => {
      vi.clearAllMocks();
      vi.mocked(ipcMain.on).mockImplementation(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          onHandlers[channel] = handler;
          return ipcMain;
        },
      );
      vi.mocked(ipcMain.handle).mockImplementation(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers[channel] = handler;
          return ipcMain;
        },
      );
      setupWindowHandlers(getMainWindow); // no createAuxWindow
      expect(() => onHandlers[IPC_CHANNELS.WINDOW_OPEN_AUX](null, 'oncall')).not.toThrow();
    });
  });

  describe('DRAG_STARTED', () => {
    it('broadcasts drag started to all windows', () => {
      expect(() => onHandlers[IPC_CHANNELS.DRAG_STARTED]()).not.toThrow();
    });
  });

  describe('DRAG_STOPPED', () => {
    it('broadcasts drag stopped to all windows', () => {
      expect(() => onHandlers[IPC_CHANNELS.DRAG_STOPPED]()).not.toThrow();
    });
  });

  describe('ONCALL_ALERT_DISMISSED', () => {
    it('broadcasts alert dismissal to all windows', () => {
      expect(() => onHandlers[IPC_CHANNELS.ONCALL_ALERT_DISMISSED](null, 'oracle')).not.toThrow();
    });
  });

  describe('CLIPBOARD_WRITE', () => {
    it('writes text to clipboard and returns true', async () => {
      const result = await (
        handlers[IPC_CHANNELS.CLIPBOARD_WRITE] as (...args: unknown[]) => Promise<boolean>
      )(null, 'hello');
      expect(clipboard.writeText).toHaveBeenCalledWith('hello');
      expect(result).toBe(true);
    });

    it('returns false for non-string input', async () => {
      const result = await (
        handlers[IPC_CHANNELS.CLIPBOARD_WRITE] as (...args: unknown[]) => Promise<boolean>
      )(null, 123);
      expect(clipboard.writeText).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('returns false for text exceeding 1MB', async () => {
      const bigText = 'x'.repeat(1_048_577);
      const result = await (
        handlers[IPC_CHANNELS.CLIPBOARD_WRITE] as (...args: unknown[]) => Promise<boolean>
      )(null, bigText);
      expect(clipboard.writeText).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('returns false when clipboard throws', async () => {
      vi.mocked(clipboard.writeText).mockImplementationOnce(() => {
        throw new Error('fail');
      });
      const result = await (
        handlers[IPC_CHANNELS.CLIPBOARD_WRITE] as (...args: unknown[]) => Promise<boolean>
      )(null, 'hi');
      expect(result).toBe(false);
    });
  });

  describe('WINDOW_MAXIMIZE', () => {
    it('unmaximizes when window is maximized', () => {
      vi.mocked(mockWin.isMaximized).mockReturnValueOnce(true);
      const event = { sender: {} };
      onHandlers[IPC_CHANNELS.WINDOW_MAXIMIZE](event);
      expect(mockWin.unmaximize).toHaveBeenCalled();
    });

    it('maximizes when window is not maximized', () => {
      vi.mocked(mockWin.isMaximized).mockReturnValueOnce(false);
      const event = { sender: {} };
      onHandlers[IPC_CHANNELS.WINDOW_MAXIMIZE](event);
      expect(mockWin.maximize).toHaveBeenCalled();
    });

    it('handles null window gracefully', () => {
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(
        null as unknown as BrowserWindow,
      );
      const event = { sender: {} };
      expect(() => onHandlers[IPC_CHANNELS.WINDOW_MAXIMIZE](event)).not.toThrow();
    });
  });

  describe('WINDOW_CLOSE', () => {
    it('closes the window', () => {
      const event = { sender: {} };
      onHandlers[IPC_CHANNELS.WINDOW_CLOSE](event);
      expect(mockWin.close).toHaveBeenCalled();
    });

    it('handles null window gracefully', () => {
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(
        null as unknown as BrowserWindow,
      );
      const event = { sender: {} };
      expect(() => onHandlers[IPC_CHANNELS.WINDOW_CLOSE](event)).not.toThrow();
    });
  });

  describe('WINDOW_IS_MAXIMIZED', () => {
    it('returns true when window is maximized', () => {
      vi.mocked(mockWin.isMaximized).mockReturnValueOnce(true);
      const event = { sender: {} };
      const result = handlers[IPC_CHANNELS.WINDOW_IS_MAXIMIZED](event);
      expect(result).toBe(true);
    });

    it('returns false when window is not maximized', () => {
      vi.mocked(mockWin.isMaximized).mockReturnValueOnce(false);
      const event = { sender: {} };
      const result = handlers[IPC_CHANNELS.WINDOW_IS_MAXIMIZED](event);
      expect(result).toBe(false);
    });

    it('returns false when window is null', () => {
      vi.mocked(BrowserWindow.fromWebContents).mockReturnValueOnce(
        null as unknown as BrowserWindow,
      );
      const event = { sender: {} };
      const result = handlers[IPC_CHANNELS.WINDOW_IS_MAXIMIZED](event);
      expect(result).toBe(false);
    });
  });

  describe('Logo handlers - GET_COMPANY_LOGO', () => {
    it('returns data URL when logo file exists', async () => {
      const pngBuffer = Buffer.from('fake-png-data');
      vi.mocked(readFile).mockResolvedValue(pngBuffer as never);

      const result = await handlers[IPC_CHANNELS.GET_COMPANY_LOGO]();

      expect(result).toBe('data:image/png;base64,' + pngBuffer.toString('base64'));
    });

    it('returns null when logo file does not exist', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await handlers[IPC_CHANNELS.GET_COMPANY_LOGO]();

      expect(result).toBeNull();
    });

    it('returns null when getDataRoot is not provided', async () => {
      vi.clearAllMocks();
      vi.mocked(ipcMain.on).mockImplementation(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          onHandlers[channel] = handler;
          return ipcMain;
        },
      );
      vi.mocked(ipcMain.handle).mockImplementation(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers[channel] = handler;
          return ipcMain;
        },
      );

      setupWindowHandlers(getMainWindow, createAuxWindow); // no getDataRoot

      const result = await handlers[IPC_CHANNELS.GET_COMPANY_LOGO]();
      expect(result).toBeNull();
    });
  });

  describe('Logo handlers - GET_FOOTER_LOGO', () => {
    it('returns data URL when footer logo exists', async () => {
      const pngBuffer = Buffer.from('footer-png');
      vi.mocked(readFile).mockResolvedValue(pngBuffer as never);

      const result = await handlers[IPC_CHANNELS.GET_FOOTER_LOGO]();

      expect(result).toBe('data:image/png;base64,' + pngBuffer.toString('base64'));
    });

    it('returns null when footer logo does not exist', async () => {
      vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await handlers[IPC_CHANNELS.GET_FOOTER_LOGO]();

      expect(result).toBeNull();
    });
  });

  describe('Logo handlers - REMOVE_COMPANY_LOGO', () => {
    it('removes logo file successfully', async () => {
      vi.mocked(unlink).mockResolvedValue(undefined);

      const result = await handlers[IPC_CHANNELS.REMOVE_COMPANY_LOGO]();

      expect(result).toEqual({ success: true });
    });

    it('returns success when file does not exist (ENOENT)', async () => {
      const enoentErr = Object.assign(new Error('not found'), { code: 'ENOENT' });
      vi.mocked(unlink).mockRejectedValue(enoentErr);

      const result = await handlers[IPC_CHANNELS.REMOVE_COMPANY_LOGO]();

      expect(result).toEqual({ success: true });
    });

    it('returns failure for other errors', async () => {
      vi.mocked(unlink).mockRejectedValue(new Error('Permission denied'));

      const result = await handlers[IPC_CHANNELS.REMOVE_COMPANY_LOGO]();

      expect(result).toEqual({ success: false, error: 'Permission denied' });
    });

    it('returns failure when getDataRoot is not provided', async () => {
      vi.clearAllMocks();
      vi.mocked(ipcMain.on).mockImplementation(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          onHandlers[channel] = handler;
          return ipcMain;
        },
      );
      vi.mocked(ipcMain.handle).mockImplementation(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers[channel] = handler;
          return ipcMain;
        },
      );

      setupWindowHandlers(getMainWindow, createAuxWindow); // no getDataRoot

      const result = await handlers[IPC_CHANNELS.REMOVE_COMPANY_LOGO]();
      expect(result).toEqual({ success: false, error: 'Data root not available' });
    });
  });

  describe('Logo handlers - REMOVE_FOOTER_LOGO', () => {
    it('removes footer logo successfully', async () => {
      vi.mocked(unlink).mockResolvedValue(undefined);

      const result = await handlers[IPC_CHANNELS.REMOVE_FOOTER_LOGO]();

      expect(result).toEqual({ success: true });
    });
  });

  describe('Logo handlers - SAVE_COMPANY_LOGO', () => {
    it('returns failure when getDataRoot is not provided', async () => {
      vi.clearAllMocks();
      vi.mocked(ipcMain.on).mockImplementation(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          onHandlers[channel] = handler;
          return ipcMain;
        },
      );
      vi.mocked(ipcMain.handle).mockImplementation(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers[channel] = handler;
          return ipcMain;
        },
      );

      setupWindowHandlers(getMainWindow, createAuxWindow); // no getDataRoot

      const result = await handlers[IPC_CHANNELS.SAVE_COMPANY_LOGO]();
      expect(result).toEqual({ success: false, error: 'Data root not available' });
    });

    it('returns cancelled when dialog is cancelled', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: true,
        filePaths: [],
      });

      const result = await handlers[IPC_CHANNELS.SAVE_COMPANY_LOGO]();

      expect(result).toEqual({ success: false, error: 'Cancelled' });
    });

    it('returns error when image exceeds 2MB', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ['/mock-dir/huge.png'],
      });
      // Create a buffer larger than 2MB
      const bigBuffer = Buffer.alloc(2 * 1024 * 1024 + 1);
      vi.mocked(readFile).mockResolvedValue(bigBuffer as never);

      const result = await handlers[IPC_CHANNELS.SAVE_COMPANY_LOGO]();

      expect(result).toEqual({ success: false, error: 'Image must be under 2MB' });
    });

    it('returns error when image is invalid (empty)', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ['/mock-dir/bad.png'],
      });
      vi.mocked(readFile).mockResolvedValue(Buffer.from('tiny') as never);
      vi.mocked(nativeImage.createFromBuffer).mockReturnValue({
        isEmpty: vi.fn(() => true),
      } as never);

      const result = await handlers[IPC_CHANNELS.SAVE_COMPANY_LOGO]();

      expect(result).toEqual({ success: false, error: 'Invalid image file' });
    });
  });

  describe('SAVE_ALERT_IMAGE', () => {
    it('returns error for invalid image data', async () => {
      const result = await handlers[IPC_CHANNELS.SAVE_ALERT_IMAGE](
        {},
        'not-a-data-url',
        'test.png',
      );

      expect(result).toEqual({ success: false, error: 'Invalid image data' });
    });

    it('returns error when data exceeds size limit', async () => {
      const bigDataUrl = 'data:image/png;base64,' + 'A'.repeat(10 * 1024 * 1024 + 1);

      const result = await handlers[IPC_CHANNELS.SAVE_ALERT_IMAGE]({}, bigDataUrl, 'test.png');

      expect(result).toEqual({ success: false, error: 'Image data exceeds size limit' });
    });

    it('returns cancelled when user cancels save dialog', async () => {
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({
        canceled: true,
        filePath: undefined,
      } as never);

      const result = await handlers[IPC_CHANNELS.SAVE_ALERT_IMAGE](
        {},
        'data:image/png;base64,abc',
        'test.png',
      );

      expect(result).toEqual({ success: false, error: 'Cancelled' });
    });

    it('saves image successfully and returns file path', async () => {
      const { writeFile } = await import('node:fs/promises');
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({
        canceled: false,
        filePath: '/mock-dir/test-alert.png',
      } as never);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const result = await handlers[IPC_CHANNELS.SAVE_ALERT_IMAGE](
        {},
        'data:image/png;base64,iVBORw0KGgo=',
        'test.png',
      );

      expect(result).toEqual({ success: true, data: '/mock-dir/test-alert.png' });
      expect(writeFile).toHaveBeenCalled();
    });

    it('returns error on write failure', async () => {
      const { writeFile } = await import('node:fs/promises');
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({
        canceled: false,
        filePath: '/mock-dir/test-alert.png',
      } as never);
      vi.mocked(writeFile).mockRejectedValue(new Error('Disk full'));

      const result = await handlers[IPC_CHANNELS.SAVE_ALERT_IMAGE](
        {},
        'data:image/png;base64,iVBORw0KGgo=',
        'test.png',
      );

      expect(result).toEqual({ success: false, error: 'Disk full' });
    });

    it('returns non-Error failure message on non-Error throw', async () => {
      const { writeFile } = await import('node:fs/promises');
      vi.mocked(dialog.showSaveDialog).mockResolvedValue({
        canceled: false,
        filePath: '/mock-dir/test-alert.png',
      } as never);
      vi.mocked(writeFile).mockRejectedValue('string error');

      const result = await handlers[IPC_CHANNELS.SAVE_ALERT_IMAGE](
        {},
        'data:image/png;base64,iVBORw0KGgo=',
        'test.png',
      );

      expect(result).toEqual({ success: false, error: 'Save failed' });
    });

    it('returns error for non-string dataUrl', async () => {
      const result = await handlers[IPC_CHANNELS.SAVE_ALERT_IMAGE]({}, 42, 'test.png');
      expect(result).toEqual({ success: false, error: 'Invalid image data' });
    });
  });

  describe('Logo handlers - SAVE_COMPANY_LOGO (full save path)', () => {
    it('saves a valid logo successfully with resize', async () => {
      const { writeFile, mkdir } = await import('node:fs/promises');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ['/mock-dir/logo.png'],
      });
      // Small enough buffer
      vi.mocked(readFile).mockResolvedValue(Buffer.from('valid-image') as never);
      // Image wider than MAX_LOGO_WIDTH (400)
      vi.mocked(nativeImage.createFromBuffer).mockReturnValue({
        isEmpty: vi.fn(() => false),
        getSize: vi.fn(() => ({ width: 800, height: 600 })),
        resize: vi.fn().mockReturnValue({
          toPNG: vi.fn(() => Buffer.from('resized-png')),
        }),
      } as never);
      vi.mocked(mkdir).mockResolvedValue(undefined as never);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const result = await handlers[IPC_CHANNELS.SAVE_COMPANY_LOGO]();

      expect(result).toEqual({
        success: true,
        data: 'data:image/png;base64,' + Buffer.from('resized-png').toString('base64'),
      });
    });

    it('saves a valid logo without resize when within width limit', async () => {
      const { writeFile, mkdir } = await import('node:fs/promises');
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({
        canceled: false,
        filePaths: ['/mock-dir/small-logo.png'],
      });
      vi.mocked(readFile).mockResolvedValue(Buffer.from('small-image') as never);
      vi.mocked(nativeImage.createFromBuffer).mockReturnValue({
        isEmpty: vi.fn(() => false),
        getSize: vi.fn(() => ({ width: 200, height: 100 })),
        toPNG: vi.fn(() => Buffer.from('small-png')),
      } as never);
      vi.mocked(mkdir).mockResolvedValue(undefined as never);
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const result = await handlers[IPC_CHANNELS.SAVE_COMPANY_LOGO]();

      expect(result).toEqual({
        success: true,
        data: 'data:image/png;base64,' + Buffer.from('small-png').toString('base64'),
      });
    });

    it('returns error when save throws non-Error', async () => {
      vi.mocked(dialog.showOpenDialog).mockRejectedValue('unexpected failure');

      const result = await handlers[IPC_CHANNELS.SAVE_COMPANY_LOGO]();

      expect(result).toEqual({ success: false, error: 'Save failed' });
    });
  });

  describe('Logo handlers - REMOVE with non-Error throw', () => {
    it('returns generic error message for non-Error throws', async () => {
      vi.mocked(unlink).mockRejectedValue('string throw');

      const result = await handlers[IPC_CHANNELS.REMOVE_COMPANY_LOGO]();

      expect(result).toEqual({ success: false, error: 'Remove failed' });
    });
  });
});

describe('setupWindowListeners', () => {
  it('sends WINDOW_MAXIMIZE_CHANGE true on maximize event', () => {
    const win = {
      on: vi.fn(),
      webContents: { send: vi.fn() },
    } as unknown as BrowserWindow;

    setupWindowListeners(win);

    // Find the maximize callback
    const maximizeCall = vi.mocked(win.on).mock.calls.find(([evt]) => evt === 'maximize');
    expect(maximizeCall).toBeDefined();
    maximizeCall![1]();
    expect(win.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, true);
  });

  it('sends WINDOW_MAXIMIZE_CHANGE false on unmaximize event', () => {
    const win = {
      on: vi.fn(),
      webContents: { send: vi.fn() },
    } as unknown as BrowserWindow;

    setupWindowListeners(win);

    const unmaximizeCall = vi.mocked(win.on).mock.calls.find(([evt]) => evt === 'unmaximize');
    expect(unmaximizeCall).toBeDefined();
    unmaximizeCall![1]();
    expect(win.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE, false);
  });
});
