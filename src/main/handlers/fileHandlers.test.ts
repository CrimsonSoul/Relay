import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain, shell } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupFileHandlers } from './fileHandlers';
import { rateLimiters } from '../rateLimiter';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    openPath: vi.fn(async () => ''),
    openExternal: vi.fn(async () => undefined),
  },
}));

vi.mock('../utils/pathSafety', () => ({
  validatePath: vi.fn(async () => true),
}));

vi.mock('../logger', () => ({
  loggers: {
    security: {
      error: vi.fn(),
    },
  },
}));

vi.mock('../rateLimiter', () => ({
  rateLimiters: {
    fsOperations: {
      tryConsume: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
    },
  },
}));

vi.mock('../operations', () => ({
  importGroupsFromCsv: vi.fn(async () => true),
}));

import { validatePath } from '../utils/pathSafety';
import { importGroupsFromCsv } from '../operations';
import { loggers } from '../logger';

describe('fileHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const getDataRoot = vi.fn(async () => '/data/relay');

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers[channel] = handler;
        return ipcMain;
      },
    );
    vi.mocked(rateLimiters.fsOperations.tryConsume).mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    });
    vi.mocked(validatePath).mockResolvedValue(true);

    setupFileHandlers(getDataRoot);
  });

  describe('OPEN_PATH', () => {
    it('opens a safe file path', async () => {
      await handlers[IPC_CHANNELS.OPEN_PATH](null, '/data/relay/contacts.csv');
      expect(shell.openPath).toHaveBeenCalledWith('/data/relay/contacts.csv');
    });

    it('blocks when rate limited', async () => {
      vi.mocked(rateLimiters.fsOperations.tryConsume).mockReturnValueOnce({
        allowed: false,
        retryAfterMs: 100,
      });
      await handlers[IPC_CHANNELS.OPEN_PATH](null, '/data/relay/contacts.csv');
      expect(shell.openPath).not.toHaveBeenCalled();
    });

    it('blocks path outside data root', async () => {
      vi.mocked(validatePath).mockResolvedValueOnce(false);
      await handlers[IPC_CHANNELS.OPEN_PATH](null, '/etc/passwd');
      expect(shell.openPath).not.toHaveBeenCalled();
      expect(loggers.security.error).toHaveBeenCalled();
    });

    it('blocks unsafe file extensions', async () => {
      await handlers[IPC_CHANNELS.OPEN_PATH](null, '/data/relay/evil.exe');
      expect(shell.openPath).not.toHaveBeenCalled();
      expect(loggers.security.error).toHaveBeenCalled();
    });

    it('allows safe extensions: .json', async () => {
      await handlers[IPC_CHANNELS.OPEN_PATH](null, '/data/relay/data.json');
      expect(shell.openPath).toHaveBeenCalledWith('/data/relay/data.json');
    });

    it('allows safe extensions: .log', async () => {
      await handlers[IPC_CHANNELS.OPEN_PATH](null, '/data/relay/app.log');
      expect(shell.openPath).toHaveBeenCalledWith('/data/relay/app.log');
    });

    it('allows safe extensions: .txt', async () => {
      await handlers[IPC_CHANNELS.OPEN_PATH](null, '/data/relay/notes.txt');
      expect(shell.openPath).toHaveBeenCalledWith('/data/relay/notes.txt');
    });
  });

  describe('OPEN_EXTERNAL', () => {
    it('opens http URLs', async () => {
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL](null, 'http://example.com');
      expect(shell.openExternal).toHaveBeenCalledWith('http://example.com');
    });

    it('opens https URLs', async () => {
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL](null, 'https://example.com');
      expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
    });

    it('opens mailto URLs', async () => {
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL](null, 'mailto:user@example.com');
      expect(shell.openExternal).toHaveBeenCalledWith('mailto:user@example.com');
    });

    it('blocks ftp protocol', async () => {
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL](null, 'ftp://files.example.com');
      expect(shell.openExternal).not.toHaveBeenCalled();
      expect(loggers.security.error).toHaveBeenCalled();
    });

    it('blocks file protocol', async () => {
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL](null, 'file:///etc/passwd');
      expect(shell.openExternal).not.toHaveBeenCalled();
      expect(loggers.security.error).toHaveBeenCalled();
    });

    it('handles invalid URL gracefully', async () => {
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL](null, 'not-a-url');
      expect(shell.openExternal).not.toHaveBeenCalled();
      expect(loggers.security.error).toHaveBeenCalled();
    });

    it('blocks when rate limited', async () => {
      vi.mocked(rateLimiters.fsOperations.tryConsume).mockReturnValueOnce({
        allowed: false,
        retryAfterMs: 100,
      });
      await handlers[IPC_CHANNELS.OPEN_EXTERNAL](null, 'https://example.com');
      expect(shell.openExternal).not.toHaveBeenCalled();
    });
  });

  describe('IMPORT_GROUPS_FROM_CSV', () => {
    it('returns success when import succeeds', async () => {
      vi.mocked(importGroupsFromCsv).mockResolvedValueOnce(true);
      const result = await handlers[IPC_CHANNELS.IMPORT_GROUPS_FROM_CSV]();
      expect(result).toEqual({ success: true });
    });

    it('returns failure when import fails', async () => {
      vi.mocked(importGroupsFromCsv).mockResolvedValueOnce(false);
      const result = await handlers[IPC_CHANNELS.IMPORT_GROUPS_FROM_CSV]();
      expect(result).toEqual({ success: false });
    });

    it('returns failure when rate limited', async () => {
      vi.mocked(rateLimiters.fsOperations.tryConsume).mockReturnValueOnce({
        allowed: false,
        retryAfterMs: 100,
      });
      const result = await handlers[IPC_CHANNELS.IMPORT_GROUPS_FROM_CSV]();
      expect(result).toEqual({ success: false });
    });
  });
});
