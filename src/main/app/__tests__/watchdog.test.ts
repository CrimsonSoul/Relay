import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  app: {
    isPackaged: true,
    getPath: vi.fn(() => '/Users/test/RelayData'),
    exit: vi.fn(),
  },
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  loggers: {
    main: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('electron', () => ({
  app: mocks.app,
}));

vi.mock('node:child_process', () => ({
  spawn: mocks.spawn,
}));

vi.mock('node:fs', () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
}));

vi.mock('../../logger', () => ({
  loggers: mocks.loggers,
}));

describe('watchdog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useRealTimers();
    delete process.env.RELAY_DISABLE_CRASH_WATCHDOG;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('parses watchdog mode arguments', async () => {
    const { parseWatchdogArgs } = await import('../watchdog');

    expect(
      parseWatchdogArgs([
        'Relay.exe',
        '--relay-watchdog',
        '--relay-parent-pid=1234',
        '--relay-watchdog-started-at=1710000000000',
      ]),
    ).toEqual({ parentPid: 1234, startedAt: 1710000000000 });
  });

  it('does not restart when a controlled quit marker was written after watchdog start', async () => {
    const { shouldRestartAfterParentExit } = await import('../watchdog');

    const shouldRestart = shouldRestartAfterParentExit({
      lastExitMarker: JSON.stringify({
        reason: 'all-windows-closed',
        at: '2026-05-13T10:00:05.000Z',
      }),
      startedAt: Date.parse('2026-05-13T10:00:00.000Z'),
    });

    expect(shouldRestart).toBe(false);
  });

  it('restarts when no fresh controlled quit marker exists', async () => {
    const { shouldRestartAfterParentExit } = await import('../watchdog');

    expect(
      shouldRestartAfterParentExit({
        lastExitMarker: null,
        startedAt: Date.parse('2026-05-13T10:00:00.000Z'),
      }),
    ).toBe(true);

    expect(
      shouldRestartAfterParentExit({
        lastExitMarker: JSON.stringify({
          reason: 'old-close',
          at: '2026-05-13T09:59:00.000Z',
        }),
        startedAt: Date.parse('2026-05-13T10:00:00.000Z'),
      }),
    ).toBe(true);
  });

  it('starts a detached watchdog only for packaged Windows builds', async () => {
    const { startCrashWatchdog } = await import('../watchdog');

    startCrashWatchdog({ platform: 'win32', isPackaged: true, execPath: 'Relay.exe', pid: 222 });

    expect(mocks.spawn).toHaveBeenCalledWith(
      'Relay.exe',
      expect.arrayContaining(['--relay-watchdog', '--relay-parent-pid=222']),
      expect.objectContaining({ detached: true, windowsHide: true, stdio: 'ignore' }),
    );
  });

  it('does not start a watchdog outside packaged Windows builds', async () => {
    const { startCrashWatchdog } = await import('../watchdog');

    startCrashWatchdog({ platform: 'darwin', isPackaged: true, execPath: 'Relay', pid: 222 });
    startCrashWatchdog({ platform: 'win32', isPackaged: false, execPath: 'Relay.exe', pid: 222 });

    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('starts a fresh watchdog for instances relaunched by the watchdog', async () => {
    const { startCrashWatchdog } = await import('../watchdog');

    startCrashWatchdog({
      platform: 'win32',
      isPackaged: true,
      execPath: 'Relay.exe',
      pid: 333,
      argv: ['Relay.exe', '--relay-restarted-by-watchdog'],
    });

    expect(mocks.spawn).toHaveBeenCalledWith(
      'Relay.exe',
      expect.arrayContaining(['--relay-watchdog', '--relay-parent-pid=333']),
      expect.objectContaining({ detached: true, windowsHide: true, stdio: 'ignore' }),
    );
  });

  it('restarts Relay from watchdog mode after the parent exits unexpectedly', async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'kill').mockImplementation((() => {
      throw new Error('process is gone');
    }) as typeof process.kill);
    mocks.existsSync.mockReturnValue(false);

    const { runCrashWatchdogIfRequested } = await import('../watchdog');

    const didStart = runCrashWatchdogIfRequested([
      'Relay.exe',
      '--relay-watchdog',
      '--relay-parent-pid=1234',
      '--relay-watchdog-started-at=1710000000000',
    ]);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(didStart).toBe(true);
    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      ['--relay-restarted-by-watchdog'],
      expect.objectContaining({ detached: true, windowsHide: true, stdio: 'ignore' }),
    );
    expect(mocks.app.exit).toHaveBeenCalledWith(0);
  });

  it('does not restart from watchdog mode after a controlled parent exit', async () => {
    vi.useFakeTimers();
    vi.spyOn(process, 'kill').mockImplementation((() => {
      throw new Error('process is gone');
    }) as typeof process.kill);
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(
      JSON.stringify({
        reason: 'all-windows-closed',
        at: '2026-05-13T10:00:05.000Z',
      }),
    );

    const { runCrashWatchdogIfRequested } = await import('../watchdog');

    const didStart = runCrashWatchdogIfRequested([
      'Relay.exe',
      '--relay-watchdog',
      '--relay-parent-pid=1234',
      `--relay-watchdog-started-at=${Date.parse('2026-05-13T10:00:00.000Z')}`,
    ]);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(didStart).toBe(true);
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.app.exit).toHaveBeenCalledWith(0);
  });
});
