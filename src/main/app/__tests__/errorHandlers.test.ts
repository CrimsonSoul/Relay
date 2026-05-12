import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    quit: vi.fn(),
    relaunch: vi.fn(),
    exit: vi.fn(),
  },
  dialog: {
    showMessageBoxSync: vi.fn(() => 1),
  },
  loggers: {
    main: {
      error: vi.fn(),
      warn: vi.fn(),
    },
  },
  broadcastToAllWindows: vi.fn(),
}));

vi.mock('electron', () => ({
  app: mocks.app,
  dialog: mocks.dialog,
}));

vi.mock('../../logger', () => ({
  loggers: mocks.loggers,
}));

vi.mock('../../utils/broadcastToAllWindows', () => ({
  broadcastToAllWindows: mocks.broadcastToAllWindows,
}));

type ProcessHandler = (...args: unknown[]) => void;

describe('errorHandlers', () => {
  const processHandlers = new Map<string, ProcessHandler>();
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    processHandlers.clear();
    processOnSpy = vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      processHandlers.set(event, handler as ProcessHandler);
      return process;
    });
  });

  afterEach(() => {
    processOnSpy.mockRestore();
  });

  it('auto-relaunches packaged Windows builds after uncaught main-process exceptions', async () => {
    const { setupErrorHandlers } = await import('../errorHandlers');
    setupErrorHandlers({
      platform: 'win32',
      isPackaged: true,
      nodeEnv: 'production',
      relaunchDelayMs: 0,
    });

    const handler = processHandlers.get('uncaughtException');
    expect(handler).toBeDefined();
    if (!handler) return;

    handler(new Error('renderer host failed'), 'uncaughtException');

    expect(mocks.dialog.showMessageBoxSync).not.toHaveBeenCalled();
    expect(mocks.broadcastToAllWindows).toHaveBeenCalledWith(
      'app:error-notification',
      expect.objectContaining({ title: 'Relay is restarting' }),
    );
    expect(mocks.app.relaunch).toHaveBeenCalledOnce();
    expect(mocks.app.exit).toHaveBeenCalledWith(1);
  });
});
