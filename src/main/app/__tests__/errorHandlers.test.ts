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
  requestAppQuit: vi.fn(),
  requestAppRelaunch: vi.fn(),
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

vi.mock('../relaunch', () => ({
  requestAppQuit: mocks.requestAppQuit,
  requestAppRelaunch: mocks.requestAppRelaunch,
}));

type ProcessHandler = (...args: unknown[]) => void;

describe('errorHandlers', () => {
  const processHandlers = new Map<string | symbol, ProcessHandler>();
  const originalExitCode = process.exitCode;
  let processOnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    processHandlers.clear();
    process.exitCode = undefined;
    processOnSpy = vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      processHandlers.set(event, handler as ProcessHandler);
      return process;
    });
  });

  afterEach(() => {
    processOnSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it('auto-relaunches packaged Windows builds after uncaught main-process exceptions', async () => {
    const { setupErrorHandlers } = await import('../errorHandlers');
    setupErrorHandlers({
      platform: 'win32',
      isPackaged: true,
      nodeEnv: 'production',
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
    expect(mocks.requestAppRelaunch).toHaveBeenCalledWith('fatal-main-process-error', {
      exitCode: 1,
    });
  });

  it('fails isolated E2E runs without opening a native crash dialog', async () => {
    const { setupErrorHandlers } = await import('../errorHandlers');
    setupErrorHandlers({
      platform: 'darwin',
      isPackaged: false,
      nodeEnv: 'test',
      suppressDesktopSideEffects: true,
    });

    const handler = processHandlers.get('uncaughtException');
    expect(handler).toBeDefined();
    if (!handler) return;

    handler(new Error('setTypeOfService EINVAL'), 'uncaughtException');

    expect(mocks.dialog.showMessageBoxSync).not.toHaveBeenCalled();
    expect(mocks.requestAppQuit).toHaveBeenCalledWith('fatal-main-process-error-e2e');
    expect(process.exitCode).toBe(1);
  });
});
