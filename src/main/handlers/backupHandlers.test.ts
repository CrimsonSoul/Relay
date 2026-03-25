import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../logger', () => ({
  loggers: { backup: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } },
}));

import { setupBackupHandlers } from './backupHandlers';

describe('setupBackupHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers three IPC handlers', () => {
    setupBackupHandlers(
      () => null,
      async () => true,
    );

    expect(ipcMain.handle).toHaveBeenCalledTimes(3);
    const calls = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0]);
    expect(calls).toContain('backup:list');
    expect(calls).toContain('backup:create');
    expect(calls).toContain('backup:restore');
  });
});
