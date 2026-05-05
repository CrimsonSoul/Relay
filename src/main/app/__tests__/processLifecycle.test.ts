import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const appHandlers = new Map<string, (...args: unknown[]) => void>();
  const mockApp = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      appHandlers.set(event, handler);
    }),
    getAppMetrics: vi.fn(() => []),
    relaunch: vi.fn(),
    exit: vi.fn(),
  };
  const mockBrowserWindow = {
    getAllWindows: vi.fn(() => []),
  };

  return {
    appHandlers,
    mockApp,
    mockBrowserWindow,
    loggers: {
      main: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    },
    broadcastToAllWindows: vi.fn(),
  };
});

vi.mock('electron', () => ({
  app: mocks.mockApp,
  BrowserWindow: mocks.mockBrowserWindow,
}));

vi.mock('../../logger', () => ({
  loggers: mocks.loggers,
}));

vi.mock('../../utils/broadcastToAllWindows', () => ({
  broadcastToAllWindows: mocks.broadcastToAllWindows,
}));

let nextWebContentsId = 1;

function createMockWebContents() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  return {
    id: nextWebContentsId++,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    }),
    getType: vi.fn(() => 'window'),
    getURL: vi.fn(() => 'app://relay'),
    isDestroyed: vi.fn(() => false),
    isCrashed: vi.fn(() => false),
    reload: vi.fn(),
    reloadIgnoringCache: vi.fn(),
    forcefullyCrashRenderer: vi.fn(),
    handlers,
  };
}

function createMockWindow() {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const webContents = createMockWebContents();
  return {
    webContents,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    }),
    once: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
    }),
    isDestroyed: vi.fn(() => false),
    handlers,
  };
}

describe('processLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.appHandlers.clear();
    mocks.mockBrowserWindow.getAllWindows.mockReturnValue([]);
    nextWebContentsId = 1;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reloads crashed web contents when auto-reload is enabled', async () => {
    const { attachWebContentsLifecycleListeners } = await import('../processLifecycle');
    const contents = createMockWebContents();

    attachWebContentsLifecycleListeners(contents as never, {
      label: 'main',
      autoReload: true,
    });

    contents.handlers.get('render-process-gone')?.({}, { reason: 'crashed', exitCode: 1 });

    expect(contents.reload).toHaveBeenCalledOnce();
    expect(mocks.loggers.main.error).toHaveBeenCalledWith(
      'Renderer process gone (main)',
      expect.objectContaining({ reason: 'crashed', exitCode: 1 }),
    );
  });

  it('does not reload clean renderer exits', async () => {
    const { attachWebContentsLifecycleListeners } = await import('../processLifecycle');
    const contents = createMockWebContents();

    attachWebContentsLifecycleListeners(contents as never, {
      label: 'main',
      autoReload: true,
    });

    contents.handlers.get('render-process-gone')?.({}, { reason: 'clean-exit', exitCode: 0 });

    expect(contents.reload).not.toHaveBeenCalled();
  });

  it('force-crashes a renderer that stays unresponsive past the recovery threshold', async () => {
    const { attachWindowLifecycleListeners } = await import('../processLifecycle');
    const win = createMockWindow();

    attachWindowLifecycleListeners(win as never, { label: 'main', autoReload: true });

    win.handlers.get('unresponsive')?.();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(win.webContents.forcefullyCrashRenderer).toHaveBeenCalledOnce();
  });

  it('reloads all windows after a GPU process failure', async () => {
    const { setupAppLifecycleListeners } = await import('../processLifecycle');
    const win = createMockWindow();
    mocks.mockBrowserWindow.getAllWindows.mockReturnValue([win]);

    setupAppLifecycleListeners();
    mocks.appHandlers.get('child-process-gone')?.({}, { type: 'GPU', reason: 'crashed' });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(win.webContents.reloadIgnoringCache).toHaveBeenCalledOnce();
  });
});
