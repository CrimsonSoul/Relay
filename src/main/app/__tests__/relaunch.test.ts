import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => '/Users/test/RelayData'),
    quit: vi.fn(),
    relaunch: vi.fn(),
    exit: vi.fn(),
  },
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  loggers: {
    main: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('electron', () => ({
  app: mocks.app,
}));

vi.mock('node:fs', () => ({
  mkdirSync: mocks.mkdirSync,
  writeFileSync: mocks.writeFileSync,
}));

vi.mock('../../logger', () => ({
  loggers: mocks.loggers,
}));

describe('requestAppRelaunch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('records the relaunch reason before quitting', async () => {
    const { requestAppRelaunch } = await import('../relaunch');

    requestAppRelaunch('gpu-recovery', { exitCode: 0, exitDelayMs: 0 });

    expect(mocks.mkdirSync).toHaveBeenCalledWith('/Users/test/RelayData', { recursive: true });
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/Users/test/RelayData/last-relaunch.json',
      expect.stringContaining('"reason":"gpu-recovery"'),
      'utf8',
    );
    expect(mocks.app.relaunch).toHaveBeenCalledOnce();
    expect(mocks.app.quit).toHaveBeenCalledOnce();
    expect(mocks.app.exit).not.toHaveBeenCalled();
  });

  it('uses delayed app.exit only as a fallback after requesting quit', async () => {
    const { requestAppRelaunch } = await import('../relaunch');

    requestAppRelaunch('fatal-main-process-error', { exitCode: 1, exitDelayMs: 250 });

    expect(mocks.app.relaunch).toHaveBeenCalledOnce();
    expect(mocks.app.quit).toHaveBeenCalledOnce();
    expect(mocks.app.exit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(250);

    expect(mocks.app.exit).toHaveBeenCalledWith(1);
  });

  it('ignores duplicate relaunch requests once recovery is already in progress', async () => {
    const { requestAppRelaunch } = await import('../relaunch');

    requestAppRelaunch('first', { exitCode: 1, exitDelayMs: 250 });
    requestAppRelaunch('second', { exitCode: 1, exitDelayMs: 250 });

    expect(mocks.app.relaunch).toHaveBeenCalledOnce();
    expect(mocks.loggers.main.warn).toHaveBeenCalledWith(
      'Relaunch already in progress; ignoring duplicate request',
      expect.objectContaining({ reason: 'second' }),
    );
  });

  it('records controlled quit reasons before quitting', async () => {
    const { requestAppQuit } = await import('../relaunch');

    requestAppQuit('startup-failed');

    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/Users/test/RelayData/last-exit.json',
      expect.stringContaining('"reason":"startup-failed"'),
      'utf8',
    );
    expect(mocks.app.quit).toHaveBeenCalledOnce();
    expect(mocks.app.exit).not.toHaveBeenCalled();
  });
});
