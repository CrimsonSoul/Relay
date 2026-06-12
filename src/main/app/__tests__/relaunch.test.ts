import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: {
    getPath: vi.fn(() => '/Users/test/RelayData'),
    isReady: vi.fn(() => true),
    quit: vi.fn(),
    relaunch: vi.fn(),
    exit: vi.fn(),
  },
  dialog: {
    showErrorBox: vi.fn(),
  },
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => '[]'),
  existsSync: vi.fn(() => false),
  loggers: {
    main: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('electron', () => ({
  app: mocks.app,
  dialog: mocks.dialog,
}));

vi.mock('node:fs', () => ({
  mkdirSync: mocks.mkdirSync,
  writeFileSync: mocks.writeFileSync,
  readFileSync: mocks.readFileSync,
  existsSync: mocks.existsSync,
}));

vi.mock('../../logger', () => ({
  loggers: mocks.loggers,
}));

describe('requestAppRelaunch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.resetModules();
    mocks.app.getPath.mockReturnValue('/Users/test/RelayData');
    mocks.app.isReady.mockReturnValue(true);
    mocks.existsSync.mockReturnValue(false);
    mocks.readFileSync.mockReturnValue('[]');
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

  it('writes both last-relaunch.json and last-exit.json so the watchdog stays quiet', async () => {
    const { requestAppRelaunch } = await import('../relaunch');

    requestAppRelaunch('gpu-recovery', { exitCode: 0, exitDelayMs: 0 });

    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/Users/test/RelayData/last-relaunch.json',
      expect.stringContaining('"reason":"gpu-recovery"'),
      'utf8',
    );
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/Users/test/RelayData/last-exit.json',
      expect.stringContaining('"reason":"relaunch:gpu-recovery"'),
      'utf8',
    );
    expect(mocks.app.relaunch).toHaveBeenCalledOnce();
  });

  it('quits instead of relaunching after 3 relaunches within the window', async () => {
    const now = Date.now();
    mocks.existsSync.mockImplementation((path: unknown) =>
      String(path).endsWith('relaunch-history.json'),
    );
    mocks.readFileSync.mockReturnValue(
      JSON.stringify([now - 3 * 60_000, now - 2 * 60_000, now - 60_000]),
    );

    const { requestAppRelaunch } = await import('../relaunch');

    requestAppRelaunch('fatal-main-process-error', { exitCode: 1, exitDelayMs: 0 });

    expect(mocks.app.relaunch).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/Users/test/RelayData/last-exit.json',
      expect.stringContaining('"reason":"relaunch-loop:fatal-main-process-error"'),
      'utf8',
    );
    expect(mocks.dialog.showErrorBox).toHaveBeenCalledOnce();
    expect(mocks.app.quit).toHaveBeenCalledOnce();
  });
});

describe('relaunch loop guard', () => {
  const MIN = 60_000;

  it('allows the first relaunches', async () => {
    const { shouldBlockRelaunch } = await import('../relaunch');
    expect(shouldBlockRelaunch([], Date.now())).toBe(false);
    expect(shouldBlockRelaunch([Date.now() - MIN], Date.now())).toBe(false);
    expect(shouldBlockRelaunch([Date.now() - 2 * MIN, Date.now() - MIN], Date.now())).toBe(false);
  });

  it('blocks the 4th relaunch within 10 minutes', async () => {
    const { shouldBlockRelaunch } = await import('../relaunch');
    const now = Date.now();
    expect(shouldBlockRelaunch([now - 3 * MIN, now - 2 * MIN, now - MIN], now)).toBe(true);
  });

  it('ignores relaunches older than the window', async () => {
    const { shouldBlockRelaunch } = await import('../relaunch');
    const now = Date.now();
    expect(shouldBlockRelaunch([now - 60 * MIN, now - 45 * MIN, now - 30 * MIN], now)).toBe(false);
  });

  it('appendToRelaunchHistory prunes outside the window and appends now', async () => {
    const { appendToRelaunchHistory } = await import('../relaunch');
    const now = Date.now();
    expect(appendToRelaunchHistory([now - 60 * MIN, now - MIN], now)).toEqual([now - MIN, now]);
  });
});
