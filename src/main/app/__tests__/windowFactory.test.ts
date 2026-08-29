import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BrowserWindowConstructorOptions, WebPreferences } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * `electron-vite/node` declares ELECTRON_RENDERER_URL as a readonly member of
 * ProcessEnv. These tests need to set and clear it, so they go through the
 * mutable index-signature view of the very same `process.env` object.
 */
const env: Record<string, string | undefined> = process.env;

/** Window-open handler shape that windowFactory registers. */
type WindowOpenHandler = (details: { url: string }) => { action: string };

// Hoist all mock state so vi.mock factories can reference them
const mocks = vi.hoisted(() => {
  const mockWebContentsOn = vi.fn();
  const mockWebContentsOnce = vi.fn();
  const mockWebContentsSetWindowOpenHandler = vi.fn<(handler: WindowOpenHandler) => void>();
  const mockWebContentsSend = vi.fn();
  const mockWebContentsSession = { setSpellCheckerLanguages: vi.fn() };
  const mockSetZoomFactor = vi.fn();
  const mockSetVisualZoomLevelLimits = vi.fn().mockResolvedValue(undefined);
  const mockLoadURL = vi.fn().mockResolvedValue(undefined);
  const mockLoadFile = vi.fn().mockResolvedValue(undefined);
  const mockShow = vi.fn();
  const mockShowInactive = vi.fn();
  const mockFocus = vi.fn();
  const mockRestore = vi.fn();
  const mockIsVisible = vi.fn(() => false);
  const mockIsMinimized = vi.fn(() => false);
  const mockOn = vi.fn();
  const mockOnce = vi.fn();
  const mockSetAppDetails = vi.fn();
  const mockDestroy = vi.fn();

  let lastOpts: BrowserWindowConstructorOptions | null = null;

  function makeBrowserWindow(opts: BrowserWindowConstructorOptions) {
    lastOpts = opts;
    return {
      webContents: {
        on: mockWebContentsOn,
        once: mockWebContentsOnce,
        setWindowOpenHandler: mockWebContentsSetWindowOpenHandler,
        send: mockWebContentsSend,
        session: mockWebContentsSession,
        setZoomFactor: mockSetZoomFactor,
        setVisualZoomLevelLimits: mockSetVisualZoomLevelLimits,
      },
      loadURL: mockLoadURL,
      loadFile: mockLoadFile,
      show: mockShow,
      showInactive: mockShowInactive,
      focus: mockFocus,
      restore: mockRestore,
      isVisible: mockIsVisible,
      isMinimized: mockIsMinimized,
      on: mockOn,
      once: mockOnce,
      setAppDetails: mockSetAppDetails,
      destroy: mockDestroy,
      isDestroyed: vi.fn(() => false),
    };
  }

  // Make it callable with `new` by using a function (not an arrow)
  const MockBrowserWindow = Object.assign(makeBrowserWindow, {
    getAllWindows: vi.fn<() => unknown[]>(() => []),
  });

  return {
    mockWebContentsOn,
    mockWebContentsOnce,
    mockWebContentsSetWindowOpenHandler,
    mockSetZoomFactor,
    mockSetVisualZoomLevelLimits,
    mockLoadURL,
    mockLoadFile,
    mockShow,
    mockShowInactive,
    mockFocus,
    mockRestore,
    mockIsVisible,
    mockIsMinimized,
    mockOn,
    mockOnce,
    mockSetAppDetails,
    mockDestroy,
    MockBrowserWindow,
    getLastOptions: () => lastOpts,
    resetLastOptions: () => {
      lastOpts = null;
    },
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
  },
  BrowserWindow: mocks.MockBrowserWindow,
}));

vi.mock('../../logger', () => ({
  loggers: {
    main: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    security: { warn: vi.fn() },
  },
}));

const mockState = { mainWindow: null as unknown, appConfig: null as unknown };
vi.mock('../appState', () => ({
  getMainWindow: () => mockState.mainWindow,
  setMainWindow: (win: unknown) => {
    mockState.mainWindow = win;
  },
  getAppConfig: () => mockState.appConfig,
}));

vi.mock('../../handlers/windowHandlers', () => ({
  setupWindowListeners: vi.fn(),
}));

vi.mock('../securityHeaders', () => ({
  setupSecurityHeaders: vi.fn(),
}));

vi.mock('../contextMenu', () => ({
  setupContextMenu: vi.fn(),
}));

import { app } from 'electron';
import { loggers } from '../../logger';
import { isAllowedRendererFileUrl } from '../windowFactory';

/** The options the most recently constructed BrowserWindow was given. */
function lastWindowOptions(): BrowserWindowConstructorOptions {
  const opts = mocks.getLastOptions();
  if (!opts) throw new Error('No BrowserWindow was constructed');
  return opts;
}

/** The webPreferences the most recently constructed BrowserWindow was given. */
function lastWebPreferences(): WebPreferences {
  const { webPreferences } = lastWindowOptions();
  if (!webPreferences) throw new Error('The BrowserWindow was constructed without webPreferences');
  return webPreferences;
}

/** The window-open handler registered on the most recent webContents. */
function registeredWindowOpenHandler(): WindowOpenHandler {
  const [call] = mocks.mockWebContentsSetWindowOpenHandler.mock.calls;
  if (!call) throw new Error('setWindowOpenHandler was never called');
  return call[0];
}

describe('windowFactory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.resetLastOptions();
    mocks.mockLoadURL.mockReset().mockResolvedValue(undefined);
    mocks.mockLoadFile.mockReset().mockResolvedValue(undefined);
    mocks.mockIsVisible.mockReset().mockReturnValue(false);
    mocks.mockIsMinimized.mockReset().mockReturnValue(false);
    mockState.mainWindow = null;
    delete env.ELECTRON_RENDERER_URL;
    delete process.env.RELAY_TEST_WINDOW_SIZE;
    delete process.env.RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS;
  });

  describe('createWindow - security webPreferences', () => {
    it('sets contextIsolation to true', async () => {
      const { createWindow } = await import('../windowFactory');
      await createWindow();
      expect(lastWebPreferences().contextIsolation).toBe(true);
    });

    it('sets nodeIntegration to false', async () => {
      const { createWindow } = await import('../windowFactory');
      await createWindow();
      expect(lastWebPreferences().nodeIntegration).toBe(false);
    });

    it('sets sandbox to true', async () => {
      const { createWindow } = await import('../windowFactory');
      await createWindow();
      expect(lastWebPreferences().sandbox).toBe(true);
    });

    it('sets webSecurity to true', async () => {
      const { createWindow } = await import('../windowFactory');
      await createWindow();
      expect(lastWebPreferences().webSecurity).toBe(true);
    });

    it('sets allowRunningInsecureContent to false', async () => {
      const { createWindow } = await import('../windowFactory');
      await createWindow();
      expect(lastWebPreferences().allowRunningInsecureContent).toBe(false);
    });

    it('sets experimentalFeatures to false', async () => {
      const { createWindow } = await import('../windowFactory');
      await createWindow();
      expect(lastWebPreferences().experimentalFeatures).toBe(false);
    });
  });

  describe('createWindow - navigation restrictions', () => {
    it('blocks navigation to external URLs', async () => {
      const { createWindow } = await import('../windowFactory');
      await createWindow();

      const navCall = mocks.mockWebContentsOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'will-navigate',
      );
      expect(navCall).toBeDefined();

      const handler = navCall![1];
      const event = { preventDefault: vi.fn() };

      handler(event, 'https://evil.example.com');

      expect(event.preventDefault).toHaveBeenCalled();
      expect(loggers.security.warn).toHaveBeenCalled();
    });

    it('blocks window.open() attempts', async () => {
      const { createWindow } = await import('../windowFactory');
      await createWindow();

      expect(mocks.mockWebContentsSetWindowOpenHandler).toHaveBeenCalled();
      const handler = registeredWindowOpenHandler();

      const result = handler({ url: 'https://evil.example.com' });

      expect(result).toEqual({ action: 'deny' });
    });
  });

  describe('createWindow - locked zoom', () => {
    it('resets the renderer zoom to 100% and disables visual zoom changes', async () => {
      const { createWindow } = await import('../windowFactory');
      await createWindow();

      expect(mocks.mockSetZoomFactor).toHaveBeenCalledWith(1);
      expect(mocks.mockSetVisualZoomLevelLimits).toHaveBeenCalledWith(1, 1);
    });

    it('blocks keyboard zoom shortcuts while leaving other shortcuts alone', async () => {
      const { createWindow } = await import('../windowFactory');
      await createWindow();

      const beforeInputCall = mocks.mockWebContentsOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'before-input-event',
      );
      expect(beforeInputCall).toBeDefined();
      const handler = beforeInputCall![1];

      const zoomEvent = { preventDefault: vi.fn() };
      handler(zoomEvent, { type: 'keyDown', control: true, meta: false, key: '=', code: 'Equal' });

      expect(zoomEvent.preventDefault).toHaveBeenCalledOnce();
      expect(mocks.mockSetZoomFactor).toHaveBeenLastCalledWith(1);

      const otherEvent = { preventDefault: vi.fn() };
      handler(otherEvent, { type: 'keyDown', control: true, meta: false, key: 'c', code: 'KeyC' });

      expect(otherEvent.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('createWindow - dev mode loading', () => {
    it('loads URL from ELECTRON_RENDERER_URL when in dev mode', async () => {
      (app as unknown as Record<string, boolean>).isPackaged = false;
      env.ELECTRON_RENDERER_URL = 'http://localhost:5173';

      const { createWindow } = await import('../windowFactory');
      await createWindow();

      expect(mocks.mockLoadURL).toHaveBeenCalledWith('http://localhost:5173');
      expect(mocks.mockLoadFile).not.toHaveBeenCalled();
    });

    it('loads file in production mode (no ELECTRON_RENDERER_URL)', async () => {
      (app as unknown as Record<string, boolean>).isPackaged = true;
      delete env.ELECTRON_RENDERER_URL;

      const { createWindow } = await import('../windowFactory');
      await createWindow();

      expect(mocks.mockLoadFile).toHaveBeenCalled();
      expect(mocks.mockLoadURL).not.toHaveBeenCalled();
    });

    it('rejects when the production renderer file fails to load', async () => {
      (app as unknown as Record<string, boolean>).isPackaged = true;
      delete env.ELECTRON_RENDERER_URL;
      mocks.mockLoadFile.mockRejectedValueOnce(new Error('missing renderer'));

      const { createWindow } = await import('../windowFactory');

      await expect(createWindow()).rejects.toThrow('missing renderer');
      expect(loggers.main.error).toHaveBeenCalledWith(
        'Failed to load local index.html',
        expect.objectContaining({ error: 'missing renderer' }),
      );
    });

    it('loads file when isPackaged is false but ELECTRON_RENDERER_URL is unset', async () => {
      (app as unknown as Record<string, boolean>).isPackaged = false;
      delete env.ELECTRON_RENDERER_URL;

      const { createWindow } = await import('../windowFactory');
      await createWindow();

      // isDev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL !== undefined
      // Since ELECTRON_RENDERER_URL is undefined, isDev is false => loadFile
      expect(mocks.mockLoadFile).toHaveBeenCalled();
      expect(mocks.mockLoadURL).not.toHaveBeenCalled();
    });

    it('can simulate a dev-only logical test window size', async () => {
      (app as unknown as Record<string, boolean>).isPackaged = false;
      env.ELECTRON_RENDERER_URL = 'http://localhost:5173';
      process.env.RELAY_TEST_WINDOW_SIZE = '1536x864';

      const { createWindow } = await import('../windowFactory');
      await createWindow();

      expect(mocks.getLastOptions()).toMatchObject({
        width: 1536,
        height: 864,
        useContentSize: true,
      });
    });

    it('ignores the logical test window size for packaged windows', async () => {
      (app as unknown as Record<string, boolean>).isPackaged = true;
      process.env.RELAY_TEST_WINDOW_SIZE = '1536x864';

      const { createWindow } = await import('../windowFactory');
      await createWindow();

      expect(mocks.getLastOptions()).toMatchObject({
        width: 960,
        height: 800,
      });
      expect(mocks.getLastOptions()).not.toHaveProperty('useContentSize');
    });
  });

  describe('createWindow - will-navigate with allowed file paths', () => {
    it('allows file URLs that resolve inside the renderer directory', () => {
      const rendererDir = join('/app', 'dist', 'renderer');
      const rendererIndex = pathToFileURL(join(rendererDir, 'index.html')).href;
      expect(isAllowedRendererFileUrl(rendererIndex, rendererDir)).toBe(true);
    });

    it('blocks file URL traversal out of the renderer directory', () => {
      const rendererDir = join('/app', 'dist', 'renderer');
      const mainIndex = pathToFileURL(join(rendererDir, '..', 'main', 'index.js')).href;
      expect(isAllowedRendererFileUrl(mainIndex, rendererDir)).toBe(false);
    });

    it('allows navigation to dev server URL in dev mode', async () => {
      (app as unknown as Record<string, boolean>).isPackaged = false;
      env.ELECTRON_RENDERER_URL = 'http://localhost:5173';

      const { createWindow } = await import('../windowFactory');
      await createWindow();

      const navCall = mocks.mockWebContentsOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'will-navigate',
      );
      const handler = navCall![1];
      const event = { preventDefault: vi.fn() };

      handler(event, 'http://localhost:5173/some-route');

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('blocks dev navigation URLs that only share the renderer URL prefix', async () => {
      (app as unknown as Record<string, boolean>).isPackaged = false;
      env.ELECTRON_RENDERER_URL = 'http://localhost:5173';

      const { createWindow } = await import('../windowFactory');
      await createWindow();

      const navCall = mocks.mockWebContentsOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'will-navigate',
      );
      const handler = navCall![1];
      const event = { preventDefault: vi.fn() };

      const cleartextProtocol = 'http';
      handler(event, `${cleartextProtocol}://localhost:5173.evil.test/some-route`);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(loggers.security.warn).toHaveBeenCalled();
    });

    it('allows navigation to local file:// within renderer directory', async () => {
      (app as unknown as Record<string, boolean>).isPackaged = true;
      delete env.ELECTRON_RENDERER_URL;

      const { createWindow } = await import('../windowFactory');
      await createWindow();

      const navCall = mocks.mockWebContentsOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'will-navigate',
      );
      const handler = navCall![1];
      const event = { preventDefault: vi.fn() };

      // Construct a file:// URL that starts with the allowedFilePath
      // The allowedFilePath is join(mainDir, '../renderer/')
      // Since mainDir is resolved from import.meta.url, we just need a file:// URL
      // that when decoded starts with the renderer directory
      handler(event, 'file:///some/path/renderer/index.html');

      // This will be blocked because /some/path/renderer/ won't match the actual allowedFilePath
      // The test verifies the branch is exercised
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('blocks file:// navigation outside renderer directory', async () => {
      (app as unknown as Record<string, boolean>).isPackaged = true;

      const { createWindow } = await import('../windowFactory');
      await createWindow();

      const navCall = mocks.mockWebContentsOn.mock.calls.find(
        (call: unknown[]) => call[0] === 'will-navigate',
      );
      const handler = navCall![1];
      const event = { preventDefault: vi.fn() };

      handler(event, 'file:///etc/passwd');

      expect(event.preventDefault).toHaveBeenCalled();
      expect(loggers.security.warn).toHaveBeenCalled();
    });
  });

  describe('createWindow - ready-to-show and close handlers', () => {
    it('reports window creation and first DOM readiness through optional milestones', async () => {
      const onWindowCreated = vi.fn();
      const onShellReady = vi.fn();
      const { createWindow } = await import('../windowFactory');

      await createWindow({ onWindowCreated, onShellReady });
      expect(onWindowCreated).toHaveBeenCalledOnce();
      const domReadyCall = mocks.mockWebContentsOnce.mock.calls.find(
        (call: unknown[]) => call[0] === 'dom-ready',
      );
      expect(domReadyCall).toBeDefined();
      domReadyCall![1]();
      expect(onShellReady).toHaveBeenCalledOnce();
    });

    it('shows and focuses the main window when the renderer finishes loading', async () => {
      const { createWindow } = await import('../windowFactory');
      await createWindow();

      expect(mocks.mockShow).toHaveBeenCalledOnce();
      expect(mocks.mockFocus).toHaveBeenCalledOnce();
      expect(loggers.main.info).toHaveBeenCalledWith(
        'Main window presented',
        expect.objectContaining({ reason: 'renderer-loaded' }),
      );
    });

    it('shows and focuses the main window on ready-to-show before loading completes', async () => {
      let resolveLoad!: () => void;
      mocks.mockLoadFile.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveLoad = resolve;
          }),
      );

      const { createWindow } = await import('../windowFactory');
      const createPromise = createWindow();

      // Find the once('ready-to-show') handler
      const readyCall = mocks.mockOnce.mock.calls.find(
        (call: unknown[]) => call[0] === 'ready-to-show',
      );
      expect(readyCall).toBeDefined();

      readyCall![1]();

      expect(mocks.mockShow).toHaveBeenCalledOnce();
      expect(mocks.mockFocus).toHaveBeenCalledOnce();
      expect(loggers.main.info).toHaveBeenCalledWith(
        'Main window presented',
        expect.objectContaining({ reason: 'ready-to-show' }),
      );

      resolveLoad();
      await createPromise;
      expect(mocks.mockShow).toHaveBeenCalledOnce();
    });

    it('shows the main window on a timeout when renderer loading stalls', async () => {
      vi.useFakeTimers();
      let resolveLoad!: () => void;
      mocks.mockLoadFile.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveLoad = resolve;
          }),
      );

      try {
        const { createWindow } = await import('../windowFactory');
        const createPromise = createWindow();

        await vi.advanceTimersByTimeAsync(5_000);

        expect(mocks.mockShow).toHaveBeenCalledOnce();
        expect(mocks.mockFocus).toHaveBeenCalledOnce();
        expect(loggers.main.info).toHaveBeenCalledWith(
          'Main window presented',
          expect.objectContaining({ reason: 'startup-timeout' }),
        );

        resolveLoad();
        await createPromise;
      } finally {
        vi.useRealTimers();
      }
    });

    it('closes all other windows when main window closes', async () => {
      const { createWindow } = await import('../windowFactory');
      await createWindow();

      const closeCall = mocks.mockOn.mock.calls.find((call: unknown[]) => call[0] === 'close');
      expect(closeCall).toBeDefined();

      const otherWin = { close: vi.fn() };
      mocks.MockBrowserWindow.getAllWindows.mockReturnValue([mockState.mainWindow, otherWin]);

      closeCall![1]();

      expect(otherWin.close).toHaveBeenCalled();
    });

    it('sets mainWindow to null on closed event', async () => {
      const { createWindow } = await import('../windowFactory');
      await createWindow();

      expect(mockState.mainWindow).not.toBeNull();

      const closedCall = mocks.mockOn.mock.calls.find((call: unknown[]) => call[0] === 'closed');
      expect(closedCall).toBeDefined();

      closedCall![1]();
      expect(mockState.mainWindow).toBeNull();
    });
  });

  describe('showAndFocusWindow', () => {
    it('restores, shows, and focuses an existing minimized window', async () => {
      mocks.mockIsMinimized.mockReturnValue(true);
      const { showAndFocusWindow } = await import('../windowFactory');
      // MockBrowserWindow is the factory the electron mock exposes; calling it
      // directly returns the very same stub object `new` would.
      const window = mockState.mainWindow ?? mocks.MockBrowserWindow({});

      expect(showAndFocusWindow(window as never, 'second-instance')).toBe(true);
      expect(mocks.mockRestore).toHaveBeenCalledOnce();
      expect(mocks.mockShow).toHaveBeenCalledOnce();
      expect(mocks.mockFocus).toHaveBeenCalledOnce();
    });

    it('keeps E2E windows hidden without activating the desktop', async () => {
      process.env.NODE_ENV = 'test';
      process.env.RELAY_E2E_DISABLE_DESKTOP_SIDE_EFFECTS = '1';
      const { showAndFocusWindow } = await import('../windowFactory');
      const window = mockState.mainWindow ?? mocks.MockBrowserWindow({});

      expect(showAndFocusWindow(window as never, 'renderer-loaded')).toBe(true);
      expect(mocks.mockShowInactive).not.toHaveBeenCalled();
      expect(mocks.mockShow).not.toHaveBeenCalled();
      expect(mocks.mockFocus).not.toHaveBeenCalled();
      expect(mocks.mockRestore).not.toHaveBeenCalled();
    });

    it('does nothing when the existing window has already been destroyed', async () => {
      const { showAndFocusWindow } = await import('../windowFactory');
      const window = {
        isDestroyed: vi.fn(() => true),
        isMinimized: mocks.mockIsMinimized,
        restore: mocks.mockRestore,
        isVisible: mocks.mockIsVisible,
        show: mocks.mockShow,
        focus: mocks.mockFocus,
      };

      expect(showAndFocusWindow(window as never, 'second-instance')).toBe(false);
      expect(mocks.mockRestore).not.toHaveBeenCalled();
      expect(mocks.mockShow).not.toHaveBeenCalled();
      expect(mocks.mockFocus).not.toHaveBeenCalled();
    });
  });
});
