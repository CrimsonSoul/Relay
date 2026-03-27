import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupSetupHandlers } from './setupHandlers';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock('../logger', () => ({
  loggers: {
    main: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

describe('setupHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};

  const mockAppConfig = {
    load: vi.fn(),
    save: vi.fn(),
    isConfigured: vi.fn(),
  };

  const mockOfflineCache = {
    clear: vi.fn(),
  };

  const mockPendingChanges = {
    clear: vi.fn(),
  };

  const getAppConfig = vi.fn(() => mockAppConfig as never);
  const getOfflineCache = vi.fn(() => mockOfflineCache as never);
  const getPendingChanges = vi.fn(() => mockPendingChanges as never);

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers[channel] = handler;
        return ipcMain;
      },
    );

    setupSetupHandlers(getAppConfig, getOfflineCache, getPendingChanges);
  });

  describe('SETUP_GET_CONFIG', () => {
    it('returns config when appConfig is available', () => {
      const configData = { mode: 'server', port: 8090, secret: 'test12345678' };
      mockAppConfig.load.mockReturnValue(configData);

      const result = handlers[IPC_CHANNELS.SETUP_GET_CONFIG]();

      expect(mockAppConfig.load).toHaveBeenCalled();
      expect(result).toEqual(configData);
    });

    it('returns null when appConfig is null', () => {
      getAppConfig.mockReturnValueOnce(null as never);

      const result = handlers[IPC_CHANNELS.SETUP_GET_CONFIG]();

      expect(result).toBeNull();
    });
  });

  describe('SETUP_SAVE_CONFIG', () => {
    it('saves valid server mode config and returns true', () => {
      const config = { mode: 'server', port: 8090, secret: 'test12345678' };

      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(mockAppConfig.save).toHaveBeenCalledWith(config);
      expect(result).toBe(true);
    });

    it('saves valid client mode config and returns true', () => {
      const config = {
        mode: 'client',
        serverUrl: 'https://relay.example.com',
        secret: 'test12345678',
      };

      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(mockAppConfig.save).toHaveBeenCalledWith(config);
      expect(result).toBe(true);
    });

    it('returns false when appConfig is null', () => {
      getAppConfig.mockReturnValueOnce(null as never);

      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        {
          mode: 'server',
          port: 8090,
          secret: 'test12345678',
        },
      );

      expect(result).toBe(false);
    });

    it('rejects invalid config with missing fields', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, { mode: 'server' });

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects config with invalid mode', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        {
          mode: 'invalid',
          port: 8090,
          secret: 'test12345678',
        },
      );

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects server config with port below 1024', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        {
          mode: 'server',
          port: 80,
          secret: 'test12345678',
        },
      );

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects server config with port above 65535', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        {
          mode: 'server',
          port: 70000,
          secret: 'test12345678',
        },
      );

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects config with secret shorter than 8 chars', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        {
          mode: 'server',
          port: 8090,
          secret: 'short',
        },
      );

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('rejects client config with invalid URL', () => {
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG](
        {},
        {
          mode: 'client',
          serverUrl: 'not-a-url',
          secret: 'test12345678',
        },
      );

      expect(mockAppConfig.save).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });

    it('clears offline cache after saving config', () => {
      const config = { mode: 'server', port: 8090, secret: 'test12345678' };
      handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(mockOfflineCache.clear).toHaveBeenCalled();
    });

    it('clears pending changes after saving config', () => {
      const config = { mode: 'server', port: 8090, secret: 'test12345678' };
      handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(mockPendingChanges.clear).toHaveBeenCalled();
    });

    it('handles offline cache clear failure gracefully', () => {
      mockOfflineCache.clear.mockImplementation(() => {
        throw new Error('disk error');
      });

      const config = { mode: 'server', port: 8090, secret: 'test12345678' };
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(result).toBe(true);
      expect(mockAppConfig.save).toHaveBeenCalled();
    });

    it('handles pending changes clear failure gracefully', () => {
      mockPendingChanges.clear.mockImplementation(() => {
        throw new Error('disk error');
      });

      const config = { mode: 'server', port: 8090, secret: 'test12345678' };
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(result).toBe(true);
    });

    it('handles null offline cache gracefully', () => {
      getOfflineCache.mockReturnValueOnce(null as never);

      const config = { mode: 'server', port: 8090, secret: 'test12345678' };
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(result).toBe(true);
    });

    it('handles null pending changes gracefully', () => {
      getPendingChanges.mockReturnValueOnce(null as never);

      const config = { mode: 'server', port: 8090, secret: 'test12345678' };
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(result).toBe(true);
    });

    it('works when optional getters are not provided', () => {
      vi.clearAllMocks();
      vi.mocked(ipcMain.handle).mockImplementation(
        (channel: string, handler: (...args: unknown[]) => unknown) => {
          handlers[channel] = handler;
          return ipcMain;
        },
      );

      setupSetupHandlers(getAppConfig); // no optional params

      const config = { mode: 'server', port: 8090, secret: 'test12345678' };
      const result = handlers[IPC_CHANNELS.SETUP_SAVE_CONFIG]({}, config);

      expect(result).toBe(true);
      expect(mockAppConfig.save).toHaveBeenCalled();
    });
  });

  describe('SETUP_IS_CONFIGURED', () => {
    it('returns true when config is configured', () => {
      mockAppConfig.isConfigured.mockReturnValue(true);

      const result = handlers[IPC_CHANNELS.SETUP_IS_CONFIGURED]();

      expect(result).toBe(true);
    });

    it('returns false when config is not configured', () => {
      mockAppConfig.isConfigured.mockReturnValue(false);

      const result = handlers[IPC_CHANNELS.SETUP_IS_CONFIGURED]();

      expect(result).toBe(false);
    });

    it('returns false when appConfig is null', () => {
      getAppConfig.mockReturnValueOnce(null as never);

      const result = handlers[IPC_CHANNELS.SETUP_IS_CONFIGURED]();

      expect(result).toBe(false);
    });
  });
});
