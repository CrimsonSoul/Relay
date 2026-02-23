import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FSWatcher } from 'chokidar';

// Capture the 'all' event handler registered by createFileWatcher
let capturedAllHandler: ((event: string, path: string) => void) | null = null;
let mockWatcher: {
  on: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  _cleanup?: () => void;
};

vi.mock('chokidar', () => ({
  watch: vi.fn(() => {
    mockWatcher = {
      on: vi.fn((event, handler) => {
        if (event === 'all') capturedAllHandler = handler as (event: string, path: string) => void;
        return mockWatcher;
      }),
      close: vi.fn(),
    };
    return mockWatcher;
  }),
}));

vi.mock('./logger', () => ({
  loggers: {
    fileManager: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

import { createFileWatcher } from './FileWatcher';

describe('FileWatcher', () => {
  let onFileChange: ReturnType<typeof vi.fn>;
  let shouldIgnore: ReturnType<typeof vi.fn>;
  const rootDir = '/some/data/path';

  beforeEach(() => {
    vi.useFakeTimers();
    capturedAllHandler = null;
    onFileChange = vi.fn();
    shouldIgnore = vi.fn(() => false);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('creates a chokidar watcher and registers "all" event', async () => {
    const { watch } = vi.mocked(await import('chokidar'));
    const watcher = createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    expect(watch).toHaveBeenCalledWith(rootDir, expect.objectContaining({ ignoreInitial: true }));
    expect(mockWatcher.on).toHaveBeenCalledWith('all', expect.any(Function));
    expect(watcher).toBe(mockWatcher);
  });

  it('debounces contacts.json changes and fires onFileChange with "contacts"', () => {
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    capturedAllHandler!('change', '/some/data/path/contacts.json');
    capturedAllHandler!('change', '/some/data/path/contacts.json');
    expect(onFileChange).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(onFileChange).toHaveBeenCalledOnce();
    expect(onFileChange).toHaveBeenCalledWith(new Set(['contacts']));
  });

  it('fires onFileChange with "servers" for servers.json changes', () => {
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    capturedAllHandler!('change', '/data/servers.json');
    vi.advanceTimersByTime(300);

    expect(onFileChange).toHaveBeenCalledWith(new Set(['servers']));
  });

  it('fires onFileChange with "oncall" for oncall.json changes', () => {
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    capturedAllHandler!('change', '/data/oncall.json');
    vi.advanceTimersByTime(300);

    expect(onFileChange).toHaveBeenCalledWith(new Set(['oncall']));
  });

  it('fires onFileChange with "oncall" for oncall_layout.json changes', () => {
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    capturedAllHandler!('change', '/data/oncall_layout.json');
    vi.advanceTimersByTime(300);

    expect(onFileChange).toHaveBeenCalledWith(new Set(['oncall']));
  });

  it('fires onFileChange with "groups" for bridgeGroups.json changes', () => {
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    capturedAllHandler!('change', '/data/bridgeGroups.json');
    vi.advanceTimersByTime(300);

    expect(onFileChange).toHaveBeenCalledWith(new Set(['groups']));
  });

  it('batches multiple file type changes in one debounce window', () => {
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    capturedAllHandler!('change', '/data/contacts.json');
    capturedAllHandler!('change', '/data/servers.json');
    vi.advanceTimersByTime(300);

    expect(onFileChange).toHaveBeenCalledOnce();
    const calledWith = onFileChange.mock.calls[0][0] as Set<string>;
    expect(calledWith.has('contacts')).toBe(true);
    expect(calledWith.has('servers')).toBe(true);
  });

  it('ignores .lock files', () => {
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    capturedAllHandler!('change', '/data/contacts.json.lock');
    vi.advanceTimersByTime(300);

    expect(onFileChange).not.toHaveBeenCalled();
  });

  it('ignores .tmp files', () => {
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    capturedAllHandler!('change', '/data/contacts.json.tmp');
    vi.advanceTimersByTime(300);

    expect(onFileChange).not.toHaveBeenCalled();
  });

  it('ignores files starting with ~', () => {
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    capturedAllHandler!('change', '/data/~contacts.json');
    vi.advanceTimersByTime(300);

    expect(onFileChange).not.toHaveBeenCalled();
  });

  it('ignores files starting with .~', () => {
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    capturedAllHandler!('change', '/data/.~contacts.json');
    vi.advanceTimersByTime(300);

    expect(onFileChange).not.toHaveBeenCalled();
  });

  it('ignores unknown json files silently (no callback)', () => {
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    capturedAllHandler!('change', '/data/unknown_file.json');
    vi.advanceTimersByTime(300);

    expect(onFileChange).not.toHaveBeenCalled();
  });

  it('does not call onFileChange when shouldIgnore returns true', () => {
    shouldIgnore.mockReturnValue(true);
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    capturedAllHandler!('change', '/data/contacts.json');
    vi.advanceTimersByTime(300);

    expect(onFileChange).not.toHaveBeenCalled();
  });

  it('handles case-insensitive file matching (uppercase)', () => {
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    capturedAllHandler!('change', '/data/CONTACTS.JSON');
    vi.advanceTimersByTime(300);

    expect(onFileChange).toHaveBeenCalledWith(new Set(['contacts']));
  });

  it('clears pending updates and debounce timer on _cleanup', () => {
    const watcher = createFileWatcher(rootDir, {
      onFileChange,
      shouldIgnore,
    }) as FSWatcher & { _cleanup: () => void };

    capturedAllHandler!('change', '/data/contacts.json');
    // cleanup before debounce fires
    watcher._cleanup();

    vi.advanceTimersByTime(300);
    expect(onFileChange).not.toHaveBeenCalled();
  });

  it('clears timer on _cleanup even with no pending events', () => {
    const watcher = createFileWatcher(rootDir, {
      onFileChange,
      shouldIgnore,
    }) as FSWatcher & { _cleanup: () => void };

    // No events fired; cleanup should not throw
    expect(() => watcher._cleanup()).not.toThrow();
  });

  it('resets pending updates after onFileChange fires', () => {
    createFileWatcher(rootDir, { onFileChange, shouldIgnore });

    // First batch
    capturedAllHandler!('change', '/data/contacts.json');
    vi.advanceTimersByTime(300);
    expect(onFileChange).toHaveBeenCalledOnce();

    // Second batch
    capturedAllHandler!('change', '/data/servers.json');
    vi.advanceTimersByTime(300);
    expect(onFileChange).toHaveBeenCalledTimes(2);
    expect(onFileChange.mock.calls[1][0]).toEqual(new Set(['servers']));
  });
});
