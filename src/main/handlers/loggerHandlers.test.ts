import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupLoggerHandlers } from './loggerHandlers';
import { rateLimiters } from '../rateLimiter';
import { loggers } from '../logger';

vi.mock('electron', () => ({
  ipcMain: {
    on: vi.fn(),
  },
}));

vi.mock('../rateLimiter', () => ({
  rateLimiters: {
    rendererLogging: {
      tryConsume: vi.fn(() => ({ allowed: true, retryAfterMs: 0 })),
    },
  },
}));

vi.mock('../logger', () => ({
  loggers: {
    ipc: {
      warn: vi.fn(),
      error: vi.fn(),
    },
    bridge: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    },
  },
}));

vi.mock('@shared/ipcValidation', () => ({
  LogEntrySchema: {
    safeParse: vi.fn((entry) => {
      if (entry && entry.level && entry.module && entry.message !== undefined) {
        return { success: true, data: entry };
      }
      return { success: false, error: { message: 'invalid' } };
    }),
  },
}));

describe('loggerHandlers', () => {
  const onHandlers: Record<string, (...args: unknown[]) => void> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ipcMain.on).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => void) => {
        onHandlers[channel] = handler;
        return ipcMain;
      },
    );
    vi.mocked(rateLimiters.rendererLogging.tryConsume).mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    });
    setupLoggerHandlers();
  });

  describe('LOG_BRIDGE', () => {
    it('logs bridge info for valid string array', () => {
      onHandlers[IPC_CHANNELS.LOG_BRIDGE](null, ['SRE', 'Platform']);
      expect(loggers.bridge.info).toHaveBeenCalledWith('Bridge composed', {
        groups: ['SRE', 'Platform'],
        groupCount: 2,
      });
    });

    it('warns for non-array payload', () => {
      onHandlers[IPC_CHANNELS.LOG_BRIDGE](null, 'not-an-array');
      expect(loggers.ipc.warn).toHaveBeenCalledWith(
        'Invalid LOG_BRIDGE payload — expected string[]',
      );
      expect(loggers.bridge.info).not.toHaveBeenCalled();
    });

    it('warns for array containing non-strings', () => {
      onHandlers[IPC_CHANNELS.LOG_BRIDGE](null, ['SRE', 123]);
      expect(loggers.ipc.warn).toHaveBeenCalledWith(
        'Invalid LOG_BRIDGE payload — expected string[]',
      );
    });

    it('handles thrown error gracefully', () => {
      // Cause the bridge.info to throw, triggering the catch block
      vi.mocked(loggers.bridge.info).mockImplementationOnce(() => {
        throw new Error('log failed');
      });
      onHandlers[IPC_CHANNELS.LOG_BRIDGE](null, ['SRE']);
      expect(loggers.ipc.error).toHaveBeenCalledWith(
        'Failed to process bridge log',
        expect.any(Object),
      );
    });
  });

  describe('LOG_TO_MAIN', () => {
    it('respects rate limit — drops when not allowed', () => {
      vi.mocked(rateLimiters.rendererLogging.tryConsume).mockReturnValueOnce({
        allowed: false,
        retryAfterMs: 100,
      });
      onHandlers[IPC_CHANNELS.LOG_TO_MAIN](null, { level: 'INFO', module: 'test', message: 'hi' });
      expect(loggers.bridge.info).not.toHaveBeenCalled();
    });

    it('warns for invalid log entry schema', () => {
      onHandlers[IPC_CHANNELS.LOG_TO_MAIN](null, { invalid: true });
      expect(loggers.ipc.warn).toHaveBeenCalledWith(
        'Invalid log entry received from renderer',
        expect.any(Object),
      );
    });

    it('logs DEBUG level', () => {
      onHandlers[IPC_CHANNELS.LOG_TO_MAIN](null, {
        level: 'debug',
        module: 'comp',
        message: 'msg',
      });
      expect(loggers.bridge.debug).toHaveBeenCalledWith('[comp] msg', undefined);
    });

    it('logs INFO level', () => {
      onHandlers[IPC_CHANNELS.LOG_TO_MAIN](null, { level: 'info', module: 'comp', message: 'msg' });
      expect(loggers.bridge.info).toHaveBeenCalledWith('[comp] msg', undefined);
    });

    it('logs WARN level', () => {
      onHandlers[IPC_CHANNELS.LOG_TO_MAIN](null, { level: 'warn', module: 'comp', message: 'msg' });
      expect(loggers.bridge.warn).toHaveBeenCalledWith('[comp] msg', undefined);
    });

    it('logs ERROR level', () => {
      onHandlers[IPC_CHANNELS.LOG_TO_MAIN](null, {
        level: 'error',
        module: 'comp',
        message: 'msg',
      });
      expect(loggers.bridge.error).toHaveBeenCalledWith('[comp] msg', undefined);
    });

    it('logs FATAL level', () => {
      onHandlers[IPC_CHANNELS.LOG_TO_MAIN](null, {
        level: 'fatal',
        module: 'comp',
        message: 'msg',
      });
      expect(loggers.bridge.fatal).toHaveBeenCalledWith('[comp] msg', undefined);
    });

    it('logs unknown level as INFO', () => {
      onHandlers[IPC_CHANNELS.LOG_TO_MAIN](null, {
        level: 'trace',
        module: 'comp',
        message: 'msg',
      });
      expect(loggers.bridge.info).toHaveBeenCalledWith('[comp] msg', undefined);
    });

    it('passes data field to logger', () => {
      const data = { key: 'value' };
      onHandlers[IPC_CHANNELS.LOG_TO_MAIN](null, {
        level: 'info',
        module: 'comp',
        message: 'msg',
        data,
      });
      expect(loggers.bridge.info).toHaveBeenCalledWith('[comp] msg', data);
    });

    it('handles error thrown during processing gracefully', () => {
      vi.mocked(loggers.bridge.info).mockImplementationOnce(() => {
        throw new Error('crash');
      });
      onHandlers[IPC_CHANNELS.LOG_TO_MAIN](null, { level: 'info', module: 'comp', message: 'msg' });
      expect(loggers.ipc.error).toHaveBeenCalledWith(
        'Failed to process log from renderer',
        expect.any(Object),
      );
    });
  });
});
