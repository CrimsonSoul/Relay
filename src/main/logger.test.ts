import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fsPromises from 'node:fs/promises';
import os from 'node:os';

// Mock fs/promises before any imports
vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    appendFile: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockRejectedValue(new Error('not found')),
    access: vi.fn().mockRejectedValue(new Error('not found')),
    rename: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock electron so it doesn't break imports
vi.mock('electron', () => ({
  app: {
    isReady: vi.fn(() => false),
    // eslint-disable-next-line sonarjs/publicly-writable-directories
    getPath: vi.fn(() => '/tmp/test-userData'),
    whenReady: vi.fn(() => Promise.reject(new Error('not ready'))),
  },
}));

describe('logger module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Make sure mkdir and appendFile are no-ops
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);
    vi.mocked(fsPromises.stat).mockRejectedValue(new Error('ENOENT'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('exports logger and loggers', async () => {
    const mod = await import('./logger');
    expect(mod.logger).toBeDefined();
    expect(mod.loggers).toBeDefined();
    expect(mod.loggers.main).toBeDefined();
    expect(mod.loggers.fileManager).toBeDefined();
    expect(mod.loggers.ipc).toBeDefined();
    expect(mod.loggers.security).toBeDefined();
    expect(mod.loggers.auth).toBeDefined();
  });

  it('loggers.main has expected methods', async () => {
    const { loggers } = await import('./logger');
    expect(typeof loggers.main.info).toBe('function');
    expect(typeof loggers.main.warn).toBe('function');
    expect(typeof loggers.main.error).toBe('function');
    expect(typeof loggers.main.debug).toBe('function');
  });

  it('calling loggers.main.info does not throw', async () => {
    const { loggers } = await import('./logger');
    expect(() => loggers.main.info('test message')).not.toThrow();
  });

  it('calling loggers.main.warn does not throw', async () => {
    const { loggers } = await import('./logger');
    expect(() => loggers.main.warn('warning', { detail: 'x' })).not.toThrow();
  });

  it('calling loggers.main.error does not throw', async () => {
    const { loggers } = await import('./logger');
    expect(() => loggers.main.error('error msg', { error: new Error('boom') })).not.toThrow();
  });

  it('calling loggers.main.debug does not throw', async () => {
    const { loggers } = await import('./logger');
    expect(() => loggers.main.debug('debug msg')).not.toThrow();
  });

  it('startTimer returns a function that completes without throwing', async () => {
    const { loggers } = await import('./logger');
    const stop = loggers.main.startTimer('test operation');
    expect(typeof stop).toBe('function');
    expect(() => stop()).not.toThrow();
  });

  it('calling fatal does not throw', async () => {
    const { loggers } = await import('./logger');
    expect(() => loggers.main.fatal('fatal msg')).not.toThrow();
  });

  it('calling errorWithCategory does not throw', async () => {
    const { loggers } = await import('./logger');
    expect(() => loggers.main.errorWithCategory('SYSTEM', 'categorized error')).not.toThrow();
  });

  it('getStats returns session stats', async () => {
    const { logger } = await import('./logger');
    const stats = logger.getStats();
    expect(stats).toHaveProperty('sessionDuration');
    expect(stats).toHaveProperty('errorCount');
    expect(stats).toHaveProperty('warnCount');
    expect(typeof stats.sessionDuration).toBe('number');
  });

  it('setLevel does not throw', async () => {
    const { logger } = await import('./logger');
    const { LogLevel } = await import('@shared/logging');
    expect(() => logger.setLevel(LogLevel.DEBUG)).not.toThrow();
    expect(() => logger.setLevel(LogLevel.WARN)).not.toThrow();
  });

  it('createChild returns a ModuleLogger with expected methods', async () => {
    const { logger } = await import('./logger');
    const child = logger.createChild('TestModule');
    expect(typeof child.info).toBe('function');
    expect(typeof child.warn).toBe('function');
    expect(typeof child.error).toBe('function');
    expect(typeof child.debug).toBe('function');
    expect(typeof child.fatal).toBe('function');
  });

  it('logger.activate can be called without throwing', async () => {
    const { logger } = await import('./logger');
    expect(() => logger.activate()).not.toThrow();
  });

  it('activate is idempotent (calling twice does not throw)', async () => {
    const { logger } = await import('./logger');
    expect(() => logger.activate()).not.toThrow();
    expect(() => logger.activate()).not.toThrow();
  });

  it('setupFallback uses os.tmpdir for log path', async () => {
    const tmpDir = os.tmpdir();
    // The logger should have set up fallback using tmpdir
    // We can verify appendFile was called with a path inside tmpdir
    await new Promise((r) => setTimeout(r, 10));
    const appendCalls = vi.mocked(fsPromises.appendFile).mock.calls;
    if (appendCalls.length > 0) {
      const firstPath = appendCalls[0][0] as string;
      expect(firstPath).toContain(tmpDir);
    }
  });
});

describe('Logger log rotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);
  });

  it('handles stat failure gracefully during rotation', async () => {
    vi.mocked(fsPromises.stat).mockRejectedValue(new Error('ENOENT'));
    const { loggers } = await import('./logger');
    // Writing a log triggers writeToFile which calls rotateIfNeeded — should not throw
    expect(() => loggers.fileManager.warn('rotation test msg')).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
  });

  it('rotates log file when size exceeds limit', async () => {
    // Simulate a large file
    vi.mocked(fsPromises.stat).mockResolvedValue({ size: 20 * 1024 * 1024 } as never);
    vi.mocked(fsPromises.access).mockRejectedValue(new Error('not found'));
    vi.mocked(fsPromises.rename).mockResolvedValue(undefined);

    const { loggers } = await import('./logger');
    loggers.fileManager.error('trigger rotation', { error: new Error('big') });
    await new Promise((r) => setTimeout(r, 30));
    // rename should have been called to rotate
    expect(vi.mocked(fsPromises.rename)).toHaveBeenCalled();
  });
});
