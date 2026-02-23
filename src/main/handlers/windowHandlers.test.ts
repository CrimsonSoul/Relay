import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain, BrowserWindow, clipboard } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupWindowHandlers, setupWindowListeners, ALLOWED_AUX_ROUTES } from './windowHandlers';

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
    },
  };
});

vi.mock('../logger', () => ({
  loggers: {
    ipc: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('windowHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const onHandlers: Record<string, (...args: unknown[]) => unknown> = {};
  const getMainWindow = vi.fn(() => null as BrowserWindow | null);
  const createAuxWindow = vi.fn();

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

    setupWindowHandlers(getMainWindow, createAuxWindow);
  });

  describe('ALLOWED_AUX_ROUTES', () => {
    it('contains expected routes', () => {
      expect(ALLOWED_AUX_ROUTES.has('oncall')).toBe(true);
      expect(ALLOWED_AUX_ROUTES.has('weather')).toBe(true);
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
      onHandlers[IPC_CHANNELS.DRAG_STARTED]();
      expect(mockWin.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.DRAG_STARTED);
    });

    it('skips destroyed windows', () => {
      vi.mocked(mockWin.isDestroyed).mockReturnValueOnce(true);
      onHandlers[IPC_CHANNELS.DRAG_STARTED]();
      expect(mockWin.webContents.send).not.toHaveBeenCalled();
    });
  });

  describe('DRAG_STOPPED', () => {
    it('broadcasts drag stopped to all windows', () => {
      onHandlers[IPC_CHANNELS.DRAG_STOPPED]();
      expect(mockWin.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.DRAG_STOPPED);
    });

    it('skips destroyed windows', () => {
      vi.mocked(mockWin.isDestroyed).mockReturnValueOnce(true);
      onHandlers[IPC_CHANNELS.DRAG_STOPPED]();
      expect(mockWin.webContents.send).not.toHaveBeenCalled();
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
