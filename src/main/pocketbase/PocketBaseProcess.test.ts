import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PocketBaseProcess } from './PocketBaseProcess';

// Hoist mocks so vi.mock factories can reference them
const { mockSpawn } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: mockSpawn,
  execSync: vi.fn(),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('../logger', () => ({
  loggers: {
    pocketbase: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

/** Build a minimal EventEmitter-like mock child process. */
function makeMockChild(pid = 1234) {
  const listeners: Record<string, ((...args: unknown[]) => void)[]> = {};
  const child = {
    pid,
    exitCode: null as number | null,
    stdout: {
      on: vi.fn((_event: string, _cb: (data: Buffer) => void) => {}),
    },
    stderr: {
      on: vi.fn((_event: string, _cb: (data: Buffer) => void) => {}),
    },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    }),
    once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      // Store once listeners alongside regular ones for simplicity
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    }),
    kill: vi.fn(),
    // Helper: simulate exit
    _emit(event: string, ...args: unknown[]) {
      for (const cb of listeners[event] ?? []) {
        cb(...args);
      }
    },
  };
  return child;
}

describe('PocketBaseProcess', () => {
  let pbProcess: PocketBaseProcess;

  beforeEach(() => {
    vi.clearAllMocks();
    pbProcess = new PocketBaseProcess({
      binaryPath: '/fake/pocketbase',
      dataDir: '/fake/data/pb_data',
      host: '127.0.0.1',
      port: 8090,
    });
  });

  // ── URL helpers ─────────────────────────────────────────────────────────────

  it('constructs with correct config', () => {
    expect(pbProcess.getUrl()).toBe('http://127.0.0.1:8090');
  });

  it('isRunning returns false before start', () => {
    expect(pbProcess.isRunning()).toBe(false);
  });

  it('getUrl returns the correct URL', () => {
    const pb = new PocketBaseProcess({
      binaryPath: '/fake/pb',
      dataDir: '/fake/data',
      host: '0.0.0.0',
      port: 9090,
    });
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    expect(pb.getUrl()).toBe('http://0.0.0.0:9090');
  });

  it('getLocalUrl always uses 127.0.0.1', () => {
    const pb = new PocketBaseProcess({
      binaryPath: '/fake/pb',
      dataDir: '/fake/data',
      host: '0.0.0.0',
      port: 9090,
    });
    expect(pb.getLocalUrl()).toBe('http://127.0.0.1:9090');
  });

  it('builds correct spawn args', () => {
    expect(pbProcess.getSpawnArgs()).toEqual([
      'serve',
      '--http=127.0.0.1:8090',
      '--dir=/fake/data/pb_data',
    ]);
  });

  // ── start() ─────────────────────────────────────────────────────────────────

  it('start() spawns process with correct binary and args', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });

    await pbProcess.start();

    expect(mockSpawn).toHaveBeenCalledWith(
      '/fake/pocketbase',
      ['serve', '--http=127.0.0.1:8090', '--dir=/fake/data/pb_data'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });

  it('start() sets isRunning() to true when healthy', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });

    await pbProcess.start();

    expect(pbProcess.isRunning()).toBe(true);
  });

  it('start() throws when health check times out', async () => {
    vi.useFakeTimers();
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    // fetch always fails (process never becomes healthy)
    mockFetch.mockRejectedValue(new Error('connection refused'));

    // Wrap in expect() immediately so the rejection is always handled
    const assertion = expect(pbProcess.start()).rejects.toThrow(
      'PocketBase failed to become healthy',
    );
    // Advance time past the 10 s health timeout
    await vi.advanceTimersByTimeAsync(11000);
    await assertion;

    vi.useRealTimers();
  });

  // ── isRunning() ──────────────────────────────────────────────────────────────

  it('isRunning() returns false after process exits', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });

    await pbProcess.start();
    expect(pbProcess.isRunning()).toBe(true);

    // Simulate clean exit (code 0 → no restart)
    child.exitCode = 0;
    child._emit('exit', 0, null);

    expect(pbProcess.isRunning()).toBe(false);
  });

  // ── stop() ───────────────────────────────────────────────────────────────────

  it('stop() resolves immediately when not running', async () => {
    await expect(pbProcess.stop()).resolves.toBeUndefined();
  });

  it('stop() sends SIGTERM on non-Windows and resolves on exit', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });

    await pbProcess.start();

    // Simulate exit when SIGTERM arrives
    child.kill.mockImplementation(() => {
      child._emit('exit', null, 'SIGTERM');
    });

    // Only SIGTERM path is exercised on non-Windows; process.platform is 'darwin' in tests
    const stopPromise = pbProcess.stop();
    await stopPromise;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(pbProcess.isRunning()).toBe(false);
  });

  // ── killSync() ───────────────────────────────────────────────────────────────

  it('killSync() does nothing when not running', () => {
    // Should not throw
    expect(() => pbProcess.killSync()).not.toThrow();
  });

  it('killSync() nullifies child reference', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });

    await pbProcess.start();
    expect(pbProcess.isRunning()).toBe(true);

    // Spy on process.kill to avoid actually killing anything
    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    pbProcess.killSync();
    processKillSpy.mockRestore();

    expect(pbProcess.isRunning()).toBe(false);
  });

  // ── crash handling & restarts ────────────────────────────────────────────────

  it('onCrash callback fires after max restarts exceeded', async () => {
    // Each start() call returns a fresh child; fetch resolves immediately.
    // We need 5 children: 1 initial + 3 restarts + 1 final crash (never started).
    // But handleCrash only calls start() for restarts 1-3; on the 4th crash it calls onCrash.
    const children = Array.from({ length: 4 }, () => makeMockChild());
    let spawnCall = 0;
    mockSpawn.mockImplementation(() => children[spawnCall++]);
    mockFetch.mockResolvedValue({ ok: true });

    const crashCallback = vi.fn();
    pbProcess.onCrash(crashCallback);

    // children[0]: initial process
    await pbProcess.start();

    // Crash 1 → restart (children[1] spawned)
    children[0].exitCode = 1;
    children[0]._emit('exit', 1, null);
    await new Promise<void>((res) => setTimeout(res, 0));

    // Crash 2 → restart (children[2] spawned)
    children[1].exitCode = 1;
    children[1]._emit('exit', 1, null);
    await new Promise<void>((res) => setTimeout(res, 0));

    // Crash 3 → restart (children[3] spawned)
    children[2].exitCode = 1;
    children[2]._emit('exit', 1, null);
    await new Promise<void>((res) => setTimeout(res, 0));

    // Crash 4 → exceeds maxRestarts → onCrash fires (no new spawn)
    children[3].exitCode = 1;
    children[3]._emit('exit', 1, null);
    await new Promise<void>((res) => setTimeout(res, 0));

    expect(crashCallback).toHaveBeenCalled();
  });

  it('restarts up to maxRestarts times on crash', async () => {
    const children = Array.from({ length: 4 }, () => makeMockChild());
    let spawnCall = 0;
    mockSpawn.mockImplementation(() => children[spawnCall++]);
    mockFetch.mockResolvedValue({ ok: true });

    pbProcess.onCrash(vi.fn());

    await pbProcess.start();
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    // Three crashes → three restart attempts (maxRestarts = 3)
    for (let i = 0; i < 3; i++) {
      const current = children[i];
      current.exitCode = 1;
      current._emit('exit', 1, null);
      await new Promise<void>((res) => setTimeout(res, 0));
    }

    // Should have spawned 4 times total: 1 initial + 3 restarts
    expect(mockSpawn).toHaveBeenCalledTimes(4);
  });

  it('onCrash callback receives the reason string', async () => {
    const children = Array.from({ length: 4 }, () => makeMockChild());
    let spawnCall = 0;
    mockSpawn.mockImplementation(() => children[spawnCall++]);
    mockFetch.mockResolvedValue({ ok: true });

    const crashCallback = vi.fn();
    pbProcess.onCrash(crashCallback);

    await pbProcess.start();

    // Exhaust maxRestarts (3) then trigger the 4th crash which calls onCrash
    for (let i = 0; i < 4; i++) {
      children[i].exitCode = 1;
      children[i]._emit('exit', 1, null);
      await new Promise<void>((res) => setTimeout(res, 0));
    }

    // The final crash (4th) exceeds maxRestarts=3, so onCrash is called with a reason string
    const calls = crashCallback.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(typeof calls[calls.length - 1][0]).toBe('string');
  });

  it('no restart when stopping flag is set (intentional stop)', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });

    const crashCallback = vi.fn();
    pbProcess.onCrash(crashCallback);

    await pbProcess.start();

    // Kick off stop, which sets this.stopping = true, then fire exit
    child.kill.mockImplementation(() => {
      child._emit('exit', 1, null); // non-zero exit but stopping=true
    });

    await pbProcess.stop();

    // No restart should occur
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(crashCallback).not.toHaveBeenCalled();
  });
});
