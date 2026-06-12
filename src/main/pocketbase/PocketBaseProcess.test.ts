import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PocketBaseProcess } from './PocketBaseProcess';

// Hoist mocks so vi.mock factories can reference them
const { mockSpawn, mockExecFileSync } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockExecFileSync: vi.fn(),
}));

// Mock child_process
vi.mock('child_process', () => ({
  spawn: mockSpawn,
  execFileSync: mockExecFileSync,
}));

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
  execFileSync: mockExecFileSync,
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
    mockExecFileSync.mockReturnValue('');
    pbProcess = new PocketBaseProcess({
      binaryPath: '/fake/pocketbase',
      dataDir: '/fake/data/pb_data',
      host: '127.0.0.1',
      port: 8090,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('start() clears stale Windows PocketBase processes listening on the configured port', async () => {
    pbProcess = new PocketBaseProcess({
      binaryPath: '/fake/pocketbase.exe',
      dataDir: '/fake/data/pb_data',
      host: '127.0.0.1',
      port: 8090,
      platform: 'win32',
    });
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });
    mockExecFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'netstat') {
        return [
          '  TCP    0.0.0.0:8090    0.0.0.0:0    LISTENING    4567',
          '  TCP    0.0.0.0:8091    0.0.0.0:0    LISTENING    9999',
        ].join('\n');
      }
      if (command === 'tasklist' && args.includes('PID eq 4567')) {
        return '"pocketbase.exe","4567","Console","1","20,000 K"';
      }
      return '';
    });

    await pbProcess.start();

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'taskkill',
      ['/F', '/T', '/PID', '4567'],
      expect.objectContaining({ timeout: 5000 }),
    );
  });

  it('start() does not kill non-PocketBase processes that happen to use the configured port', async () => {
    pbProcess = new PocketBaseProcess({
      binaryPath: '/fake/pocketbase.exe',
      dataDir: '/fake/data/pb_data',
      host: '127.0.0.1',
      port: 8090,
      platform: 'win32',
    });
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });
    mockExecFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'netstat') {
        return '  TCP    0.0.0.0:8090    0.0.0.0:0    LISTENING    4567';
      }
      if (command === 'tasklist' && args.includes('PID eq 4567')) {
        return '"node.exe","4567","Console","1","20,000 K"';
      }
      return '';
    });

    await pbProcess.start();

    expect(mockExecFileSync).not.toHaveBeenCalledWith(
      'taskkill',
      expect.any(Array),
      expect.any(Object),
    );
  });

  it('kills a stale pocketbase listener on the port (darwin)', async () => {
    pbProcess = new PocketBaseProcess({
      binaryPath: '/fake/pocketbase',
      dataDir: '/fake/data/pb_data',
      host: '127.0.0.1',
      port: 8090,
      platform: 'darwin',
    });
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });
    mockExecFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'lsof' && args.includes('tcp:8090')) {
        return '1234\n';
      }
      if (command === 'ps' && args.includes('1234')) {
        return '/Applications/Relay.app/Contents/Resources/pocketbase/darwin-arm64/pocketbase\n';
      }
      return '';
    });

    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      await pbProcess.start();
      expect(processKillSpy).toHaveBeenCalledWith(1234, 'SIGKILL');
    } finally {
      processKillSpy.mockRestore();
    }
  });

  it('does not kill a non-pocketbase listener (darwin)', async () => {
    pbProcess = new PocketBaseProcess({
      binaryPath: '/fake/pocketbase',
      dataDir: '/fake/data/pb_data',
      host: '127.0.0.1',
      port: 8090,
      platform: 'darwin',
    });
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });
    mockExecFileSync.mockImplementation((command: string, args: string[]) => {
      if (command === 'lsof' && args.includes('tcp:8090')) {
        return '1234\n';
      }
      if (command === 'ps' && args.includes('1234')) {
        return 'node\n';
      }
      return '';
    });

    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      await pbProcess.start();
      expect(processKillSpy).not.toHaveBeenCalled();
    } finally {
      processKillSpy.mockRestore();
    }
  });

  it('treats lsof failure as nothing to clean (darwin)', async () => {
    pbProcess = new PocketBaseProcess({
      binaryPath: '/fake/pocketbase',
      dataDir: '/fake/data/pb_data',
      host: '127.0.0.1',
      port: 8090,
      platform: 'darwin',
    });
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });
    mockExecFileSync.mockImplementation((command: string) => {
      if (command === 'lsof') {
        throw new Error('lsof exited with code 1');
      }
      return '';
    });

    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    try {
      await expect(pbProcess.start()).resolves.toBeUndefined();
      expect(processKillSpy).not.toHaveBeenCalled();
    } finally {
      processKillSpy.mockRestore();
    }
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
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(pbProcess.isRunning()).toBe(false);

    vi.useRealTimers();
  });

  it('start() rejects when the PocketBase child process cannot spawn', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockRejectedValue(new Error('connection refused'));

    const startPromise = pbProcess.start();
    child._emit('error', new Error('spawn EACCES'));

    await expect(startPromise).rejects.toThrow('spawn EACCES');
    expect(pbProcess.isRunning()).toBe(false);
  });

  it('start() rejects if the child exits before the health check completes', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockImplementation(() => new Promise(() => undefined));

    const startPromise = pbProcess.start();
    child.exitCode = 0;
    child._emit('exit', 0, null);

    await expect(startPromise).rejects.toThrow('PocketBase exited during startup');
    expect(pbProcess.isRunning()).toBe(false);
  });

  // ── isRunning() ──────────────────────────────────────────────────────────────

  it('isRunning() returns false after process exits', async () => {
    // A clean exit (code 0, no signal) does not trigger crash handling,
    // so no fake timers are needed here.
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });

    await pbProcess.start();
    expect(pbProcess.isRunning()).toBe(true);

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

    vi.useFakeTimers();

    // children[0]: initial process
    await pbProcess.start();

    // Crash 1 → restart after 1s backoff (children[1] spawned)
    children[0].exitCode = 1;
    children[0]._emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(1000);

    // Crash 2 → restart after 5s backoff (children[2] spawned)
    children[1].exitCode = 1;
    children[1]._emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(5000);

    // Crash 3 → restart after 15s backoff (children[3] spawned)
    children[2].exitCode = 1;
    children[2]._emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(15000);

    // Crash 4 → exceeds maxRestarts → onCrash fires (no new spawn)
    children[3].exitCode = 1;
    children[3]._emit('exit', 1, null);
    await vi.advanceTimersByTimeAsync(0);

    expect(crashCallback).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('restarts up to maxRestarts times on crash', async () => {
    const children = Array.from({ length: 4 }, () => makeMockChild());
    let spawnCall = 0;
    mockSpawn.mockImplementation(() => children[spawnCall++]);
    mockFetch.mockResolvedValue({ ok: true });

    pbProcess.onCrash(vi.fn());

    vi.useFakeTimers();

    await pbProcess.start();
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    // Three crashes → three restart attempts (maxRestarts = 3),
    // each preceded by its backoff delay (1s, 5s, 15s)
    const backoffs = [1000, 5000, 15000];
    for (let i = 0; i < 3; i++) {
      const current = children[i];
      current.exitCode = 1;
      current._emit('exit', 1, null);
      await vi.advanceTimersByTimeAsync(backoffs[i]);
    }

    // Should have spawned 4 times total: 1 initial + 3 restarts
    expect(mockSpawn).toHaveBeenCalledTimes(4);

    vi.useRealTimers();
  });

  it('onCrash callback receives the reason string', async () => {
    const children = Array.from({ length: 4 }, () => makeMockChild());
    let spawnCall = 0;
    mockSpawn.mockImplementation(() => children[spawnCall++]);
    mockFetch.mockResolvedValue({ ok: true });

    const crashCallback = vi.fn();
    pbProcess.onCrash(crashCallback);

    vi.useFakeTimers();

    await pbProcess.start();

    // Exhaust maxRestarts (3) then trigger the 4th crash which calls onCrash.
    // Each restart waits out its backoff (1s, 5s, 15s); the 4th crash skips
    // the backoff and calls onCrash directly.
    const backoffs = [1000, 5000, 15000, 0];
    for (let i = 0; i < 4; i++) {
      children[i].exitCode = 1;
      children[i]._emit('exit', 1, null);
      await vi.advanceTimersByTimeAsync(backoffs[i]);
    }

    // The final crash (4th) exceeds maxRestarts=3, so onCrash is called with a reason string
    const calls = crashCallback.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(typeof calls[calls.length - 1][0]).toBe('string');

    vi.useRealTimers();
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

  it('restarts when the process is signal-killed (code null, signal set)', async () => {
    const children = [makeMockChild(), makeMockChild()];
    let spawnCall = 0;
    mockSpawn.mockImplementation(() => children[spawnCall++]);
    mockFetch.mockResolvedValue({ ok: true });

    vi.useFakeTimers();

    await pbProcess.start();
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    // OOM-kill / external SIGKILL: code null, signal set, not stopping
    children[0]._emit('exit', null, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockSpawn).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('waits for the backoff delay before restarting after a crash', async () => {
    const children = [makeMockChild(), makeMockChild()];
    let spawnCall = 0;
    mockSpawn.mockImplementation(() => children[spawnCall++]);
    mockFetch.mockResolvedValue({ ok: true });

    vi.useFakeTimers();

    await pbProcess.start();

    children[0].exitCode = 1;
    children[0]._emit('exit', 1, null);

    // No respawn before the 1000ms backoff has elapsed
    await vi.advanceTimersByTimeAsync(999);
    expect(mockSpawn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('killSync() suppresses crash handling for the subsequent exit event', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });

    const crashCallback = vi.fn();
    pbProcess.onCrash(crashCallback);

    vi.useFakeTimers();

    await pbProcess.start();

    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    pbProcess.killSync();
    processKillSpy.mockRestore();

    // The SIGKILL from killSync produces a (null, 'SIGKILL') exit event
    child._emit('exit', null, 'SIGKILL');
    await vi.advanceTimersByTimeAsync(20000);

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(crashCallback).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  // ── stdout/stderr listeners ──────────────────────────────────────────────────

  it('logs stdout data from PocketBase', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });

    await pbProcess.start();

    // Find and trigger the stdout data callback
    const stdoutCb = child.stdout.on.mock.calls.find(([evt]: [string]) => evt === 'data');
    expect(stdoutCb).toBeDefined();
    // Call the callback — should not throw
    expect(() => stdoutCb![1](Buffer.from('Server started'))).not.toThrow();
  });

  it('logs stderr data from PocketBase', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });

    await pbProcess.start();

    const stderrCb = child.stderr.on.mock.calls.find(([evt]: [string]) => evt === 'data');
    expect(stderrCb).toBeDefined();
    expect(() => stderrCb![1](Buffer.from('Warning message'))).not.toThrow();
  });

  // ── unexpected exits trigger restart ────────────────────────────────────────

  // This test previously asserted that a (null, signal) exit did NOT restart —
  // that encoded the bug where signal kills left the server silently dead.
  it('restarts on exit with code null (signal-based) when not stopping', async () => {
    const children = [makeMockChild(), makeMockChild()];
    let spawnCall = 0;
    mockSpawn.mockImplementation(() => children[spawnCall++]);
    mockFetch.mockResolvedValue({ ok: true });

    vi.useFakeTimers();

    await pbProcess.start();

    children[0]._emit('exit', null, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockSpawn).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  // ── handleCrash when restart itself fails ──────────────────────────────────

  it('calls onCrash when restart attempt itself fails', async () => {
    const children = [makeMockChild(), makeMockChild()];
    let spawnCall = 0;
    mockSpawn.mockImplementation(() => children[spawnCall++]);
    // First start succeeds, second start (restart) fails health check
    mockFetch
      .mockResolvedValueOnce({ ok: true }) // initial start health
      .mockRejectedValue(new Error('connection refused')); // restart health fails

    const crashCallback = vi.fn();
    pbProcess.onCrash(crashCallback);

    vi.useFakeTimers();

    await pbProcess.start();

    // Trigger crash
    children[0].exitCode = 1;
    children[0]._emit('exit', 1, null);

    // Advance past health check timeout (10s) + the 200ms retry intervals
    await vi.advanceTimersByTimeAsync(11000);

    // The restart failed, so onCrash should be called
    expect(crashCallback).toHaveBeenCalledWith(
      expect.stringContaining('Failed to restart PocketBase'),
    );

    vi.useRealTimers();
  });

  // ── stop() when already stopping ──────────────────────────────────────────

  it('stop() returns immediately when already stopping', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });

    await pbProcess.start();

    // First stop — don't emit exit yet
    const stop1 = pbProcess.stop();
    // Second stop should return immediately (stopping flag is set)
    const stop2 = pbProcess.stop();
    await stop2; // should resolve right away

    // Now trigger exit so first stop resolves
    child._emit('exit', 0, null);
    await stop1;
    // Both stop calls should have resolved without throwing
    await expect(stop2).resolves.toBeUndefined();
  });

  // ── killSync on Windows path (code coverage for execFileSync branch) ──────

  it('killSync uses process.kill with SIGKILL on non-Windows', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });

    await pbProcess.start();

    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    pbProcess.killSync();
    expect(processKillSpy).toHaveBeenCalledWith(child.pid, 'SIGKILL');
    processKillSpy.mockRestore();
  });

  it('killSync handles process.kill throwing (already dead)', async () => {
    const child = makeMockChild();
    mockSpawn.mockReturnValue(child);
    mockFetch.mockResolvedValue({ ok: true });

    await pbProcess.start();

    const processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });
    expect(() => pbProcess.killSync()).not.toThrow();
    processKillSpy.mockRestore();
  });
});
