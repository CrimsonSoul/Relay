import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain, BrowserWindow, clipboard } from 'electron';
import { setupWindowHandlers, setupWindowListeners } from './windowHandlers';
import { IPC_CHANNELS } from '../../shared/ipc';

// Mock dependencies
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getAllWindows: vi.fn(),
  },
  clipboard: {
    writeText: vi.fn(),
  },
}));

describe('windowHandlers', () => {
  let mockWindow: Partial<BrowserWindow>;
  let mockEvent: { sender: typeof mockWindow.webContents };
  let getMainWindow: () => BrowserWindow | null;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWindow = {
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
    mockEvent = {
      sender: mockWindow.webContents,
    };
    getMainWindow = vi.fn(() => mockWindow);
    
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(mockWindow);
  });

  describe('setupWindowHandlers', () => {
    it('should register all window handlers', () => {
      setupWindowHandlers(getMainWindow);

      expect(ipcMain.on).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_MINIMIZE, expect.any(Function));
      expect(ipcMain.on).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_MAXIMIZE, expect.any(Function));
      expect(ipcMain.on).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_CLOSE, expect.any(Function));
      expect(ipcMain.on).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_OPEN_AUX, expect.any(Function));
      expect(ipcMain.on).toHaveBeenCalledWith(IPC_CHANNELS.DRAG_STARTED, expect.any(Function));
      expect(ipcMain.on).toHaveBeenCalledWith(IPC_CHANNELS.DRAG_STOPPED, expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, expect.any(Function));
      expect(ipcMain.handle).toHaveBeenCalledWith(IPC_CHANNELS.CLIPBOARD_WRITE, expect.any(Function));
    });

    describe('WINDOW_MINIMIZE', () => {
      it('should minimize window', () => {
        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.on).mock.calls.find(
          call => call[0] === IPC_CHANNELS.WINDOW_MINIMIZE
        )?.[1];

        handler?.(mockEvent);

        expect(mockWindow.minimize).toHaveBeenCalled();
      });

      it('should handle null window gracefully', () => {
        vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null);
        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.on).mock.calls.find(
          call => call[0] === IPC_CHANNELS.WINDOW_MINIMIZE
        )?.[1];

        expect(() => handler?.(mockEvent)).not.toThrow();
      });
    });

    describe('WINDOW_MAXIMIZE', () => {
      it('should maximize window when not maximized', () => {
        mockWindow.isMaximized = vi.fn(() => false);
        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.on).mock.calls.find(
          call => call[0] === IPC_CHANNELS.WINDOW_MAXIMIZE
        )?.[1];

        handler?.(mockEvent);

        expect(mockWindow.maximize).toHaveBeenCalled();
        expect(mockWindow.unmaximize).not.toHaveBeenCalled();
      });

      it('should unmaximize window when maximized', () => {
        mockWindow.isMaximized = vi.fn(() => true);
        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.on).mock.calls.find(
          call => call[0] === IPC_CHANNELS.WINDOW_MAXIMIZE
        )?.[1];

        handler?.(mockEvent);

        expect(mockWindow.unmaximize).toHaveBeenCalled();
        expect(mockWindow.maximize).not.toHaveBeenCalled();
      });
    });

    describe('WINDOW_CLOSE', () => {
      it('should close window', () => {
        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.on).mock.calls.find(
          call => call[0] === IPC_CHANNELS.WINDOW_CLOSE
        )?.[1];

        handler?.(mockEvent);

        expect(mockWindow.close).toHaveBeenCalled();
      });
    });

    describe('WINDOW_IS_MAXIMIZED', () => {
      it('should return true when window is maximized', async () => {
        mockWindow.isMaximized = vi.fn(() => true);
        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.handle).mock.calls.find(
          call => call[0] === IPC_CHANNELS.WINDOW_IS_MAXIMIZED
        )?.[1];

        const result = await handler?.(mockEvent);

        expect(result).toBe(true);
      });

      it('should return false when window is not maximized', async () => {
        mockWindow.isMaximized = vi.fn(() => false);
        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.handle).mock.calls.find(
          call => call[0] === IPC_CHANNELS.WINDOW_IS_MAXIMIZED
        )?.[1];

        const result = await handler?.(mockEvent);

        expect(result).toBe(false);
      });

      it('should return false when window is null', async () => {
        vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(null);
        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.handle).mock.calls.find(
          call => call[0] === IPC_CHANNELS.WINDOW_IS_MAXIMIZED
        )?.[1];

        const result = await handler?.(mockEvent);

        expect(result).toBe(false);
      });
    });

    describe('WINDOW_OPEN_AUX', () => {
      it('should open aux window with allowed route', () => {
        const createAuxWindow = vi.fn();
        setupWindowHandlers(getMainWindow, createAuxWindow);
        const handler = vi.mocked(ipcMain.on).mock.calls.find(
          call => call[0] === IPC_CHANNELS.WINDOW_OPEN_AUX
        )?.[1];

        handler?.({}, 'popout/board');

        expect(createAuxWindow).toHaveBeenCalledWith('popout/board');
      });

      it('should reject disallowed routes', () => {
        const createAuxWindow = vi.fn();
        setupWindowHandlers(getMainWindow, createAuxWindow);
        const handler = vi.mocked(ipcMain.on).mock.calls.find(
          call => call[0] === IPC_CHANNELS.WINDOW_OPEN_AUX
        )?.[1];

        handler?.({}, 'malicious/route');

        expect(createAuxWindow).not.toHaveBeenCalled();
      });

      it('should reject non-string routes', () => {
        const createAuxWindow = vi.fn();
        setupWindowHandlers(getMainWindow, createAuxWindow);
        const handler = vi.mocked(ipcMain.on).mock.calls.find(
          call => call[0] === IPC_CHANNELS.WINDOW_OPEN_AUX
        )?.[1];

        // Testing with non-string input (number) to verify validation
        const invalidInput = 123;
        handler?.({}, invalidInput as never);

        expect(createAuxWindow).not.toHaveBeenCalled();
      });
    });

    describe('DRAG_STARTED and DRAG_STOPPED', () => {
      it('should broadcast DRAG_STARTED to all windows', () => {
        const window1 = { 
          isDestroyed: vi.fn(() => false), 
          webContents: { send: vi.fn() } 
        } as unknown as BrowserWindow;
        const window2 = { 
          isDestroyed: vi.fn(() => false), 
          webContents: { send: vi.fn() } 
        } as unknown as BrowserWindow;
        vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([window1, window2]);

        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.on).mock.calls.find(
          call => call[0] === IPC_CHANNELS.DRAG_STARTED
        )?.[1];

        handler?.();

        expect((window1 as any).webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.DRAG_STARTED);
        expect((window2 as any).webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.DRAG_STARTED);
      });

      it('should broadcast DRAG_STOPPED to all windows', () => {
        const window1 = { 
          isDestroyed: vi.fn(() => false), 
          webContents: { send: vi.fn() } 
        } as unknown as BrowserWindow;
        const window2 = { 
          isDestroyed: vi.fn(() => false), 
          webContents: { send: vi.fn() } 
        } as unknown as BrowserWindow;
        vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([window1, window2]);

        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.on).mock.calls.find(
          call => call[0] === IPC_CHANNELS.DRAG_STOPPED
        )?.[1];

        handler?.();

        expect((window1 as any).webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.DRAG_STOPPED);
        expect((window2 as any).webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.DRAG_STOPPED);
      });

      it('should skip destroyed windows when broadcasting', () => {
        const window1 = { 
          isDestroyed: vi.fn(() => false), 
          webContents: { send: vi.fn() } 
        } as unknown as BrowserWindow;
        const window2 = { 
          isDestroyed: vi.fn(() => true), 
          webContents: { send: vi.fn() } 
        } as unknown as BrowserWindow;
        vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([window1, window2]);

        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.on).mock.calls.find(
          call => call[0] === IPC_CHANNELS.DRAG_STARTED
        )?.[1];

        handler?.();

        expect((window1 as any).webContents.send).toHaveBeenCalled();
        expect((window2 as any).webContents.send).not.toHaveBeenCalled();
      });
    });

    describe('CLIPBOARD_WRITE', () => {
      it('should write text to clipboard', async () => {
        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.handle).mock.calls.find(
          call => call[0] === IPC_CHANNELS.CLIPBOARD_WRITE
        )?.[1];

        const result = await handler?.({}, 'test text');

        expect(clipboard.writeText).toHaveBeenCalledWith('test text');
        expect(result).toBe(true);
      });

      it('should reject non-string text', async () => {
        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.handle).mock.calls.find(
          call => call[0] === IPC_CHANNELS.CLIPBOARD_WRITE
        )?.[1];

        // Testing with non-string input (number) to verify validation
        const invalidInput = 123;
        const result = await handler?.({}, invalidInput as never);

        expect(clipboard.writeText).not.toHaveBeenCalled();
        expect(result).toBe(false);
      });

      it('should reject text exceeding max length', async () => {
        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.handle).mock.calls.find(
          call => call[0] === IPC_CHANNELS.CLIPBOARD_WRITE
        )?.[1];

        const longText = 'a'.repeat(1_048_577); // 1MB + 1
        const result = await handler?.({}, longText);

        expect(clipboard.writeText).not.toHaveBeenCalled();
        expect(result).toBe(false);
      });

      it('should handle clipboard errors gracefully', async () => {
        vi.mocked(clipboard.writeText).mockImplementation(() => {
          throw new Error('Clipboard error');
        });
        setupWindowHandlers(getMainWindow);
        const handler = vi.mocked(ipcMain.handle).mock.calls.find(
          call => call[0] === IPC_CHANNELS.CLIPBOARD_WRITE
        )?.[1];

        const result = await handler?.({}, 'test text');

        expect(result).toBe(false);
      });
    });
  });

  describe('setupWindowListeners', () => {
    it('should setup maximize listener', () => {
      setupWindowListeners(mockWindow);

      expect(mockWindow.on).toHaveBeenCalledWith('maximize', expect.any(Function));
    });

    it('should setup unmaximize listener', () => {
      setupWindowListeners(mockWindow);

      expect(mockWindow.on).toHaveBeenCalledWith('unmaximize', expect.any(Function));
    });

    it('should send WINDOW_MAXIMIZE_CHANGE on maximize', () => {
      setupWindowListeners(mockWindow);
      const maximizeHandler = vi.mocked(mockWindow.on).mock.calls.find(
        call => call[0] === 'maximize'
      )?.[1];

      maximizeHandler?.();

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE,
        true
      );
    });

    it('should send WINDOW_MAXIMIZE_CHANGE on unmaximize', () => {
      setupWindowListeners(mockWindow);
      const unmaximizeHandler = vi.mocked(mockWindow.on).mock.calls.find(
        call => call[0] === 'unmaximize'
      )?.[1];

      unmaximizeHandler?.();

      expect(mockWindow.webContents.send).toHaveBeenCalledWith(
        IPC_CHANNELS.WINDOW_MAXIMIZE_CHANGE,
        false
      );
    });
  });
});
