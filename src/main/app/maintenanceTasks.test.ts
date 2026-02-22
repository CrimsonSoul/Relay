import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { setupMaintenanceTasks } from './maintenanceTasks';
import { FileManager } from '../FileManager';

vi.mock('../logger', () => ({
  loggers: {
    main: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

vi.mock('../FileManager', () => ({
  FileManager: vi.fn(),
}));

import { loggers } from '../logger';

describe('maintenanceTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a cleanup function', () => {
    const getFileManager = vi.fn(() => null);
    const cleanup = setupMaintenanceTasks(getFileManager);
    expect(typeof cleanup).toBe('function');
    cleanup();
  });

  it('cleanup function clears the interval and timeout', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    const getFileManager = vi.fn(() => null);
    const cleanup = setupMaintenanceTasks(getFileManager);
    cleanup();

    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('logs startup memory stats after 1 minute timeout', () => {
    const getFileManager = vi.fn(() => null);
    setupMaintenanceTasks(getFileManager);

    vi.advanceTimersByTime(60000);
    expect(loggers.main.info).toHaveBeenCalledWith('Startup Memory Stats:', expect.any(Object));
  });

  it('runs periodic maintenance at 24-hour interval', () => {
    const mockFileManager = {
      performBackup: vi.fn(async () => undefined),
    } as unknown as FileManager;

    const getFileManager = vi.fn(() => mockFileManager);
    setupMaintenanceTasks(getFileManager);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(loggers.main.info).toHaveBeenCalledWith('Running periodic maintenance...');
    expect(loggers.main.info).toHaveBeenCalledWith('Memory Stats:', expect.any(Object));
    expect(mockFileManager.performBackup).toHaveBeenCalledWith('periodic');
  });

  it('skips backup when fileManager is null during interval', () => {
    const getFileManager = vi.fn(() => null);
    setupMaintenanceTasks(getFileManager);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(loggers.main.info).toHaveBeenCalledWith('Running periodic maintenance...');
    // No crash expected
  });

  it('triggers GC if available on globalThis', () => {
    const gcMock = vi.fn();
    (globalThis as { gc?: () => void }).gc = gcMock;

    const getFileManager = vi.fn(() => null);
    setupMaintenanceTasks(getFileManager);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(gcMock).toHaveBeenCalled();
    expect(loggers.main.info).toHaveBeenCalledWith('Triggered manual garbage collection');

    delete (globalThis as { gc?: () => void }).gc;
  });

  it('handles GC throwing an error', () => {
    const gcMock = vi.fn(() => {
      throw new Error('gc failed');
    });
    (globalThis as { gc?: () => void }).gc = gcMock;

    const getFileManager = vi.fn(() => null);
    setupMaintenanceTasks(getFileManager);

    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(loggers.main.warn).toHaveBeenCalledWith(
      'Failed to trigger manual GC',
      expect.any(Object),
    );

    delete (globalThis as { gc?: () => void }).gc;
  });

  it('does not run interval tasks before 24 hours', () => {
    const getFileManager = vi.fn(() => null);
    setupMaintenanceTasks(getFileManager);

    vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    expect(loggers.main.info).not.toHaveBeenCalledWith('Running periodic maintenance...');
  });
});
