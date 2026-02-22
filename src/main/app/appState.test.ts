import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock electron before importing appState
vi.mock('electron', () => ({
  app: {
    // eslint-disable-next-line sonarjs/publicly-writable-directories
    getPath: vi.fn(() => '/tmp/userData'),
    isPackaged: false,
  },
  BrowserWindow: vi.fn(),
}));

vi.mock('../FileManager', () => ({
  FileManager: vi.fn().mockImplementation(function () {
    return { init: vi.fn(), destroy: vi.fn() };
  }),
}));

vi.mock('../ipcHandlers', () => ({
  setupIpcHandlers: vi.fn(),
}));

vi.mock('../handlers/authHandlers', () => ({
  setupAuthHandlers: vi.fn(),
  setupAuthInterception: vi.fn(),
}));

vi.mock('../handlers/loggerHandlers', () => ({
  setupLoggerHandlers: vi.fn(),
}));

vi.mock('../dataUtils', () => ({
  copyDataFilesAsync: vi.fn(),
  ensureDataFilesAsync: vi.fn(),
  loadConfigAsync: vi.fn(() => Promise.resolve({ dataRoot: '' })),
  saveConfigAsync: vi.fn(),
}));

vi.mock('../pathValidation', () => ({
  validateDataPath: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../logger', () => ({
  loggers: {
    main: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    security: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    fileManager: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}));

vi.mock('../securityPolicy', () => ({
  getSecureOrigin: vi.fn((url: string) => url),
  isTrustedGeolocationOrigin: vi.fn(() => false),
}));

import {
  state,
  getDataRoot,
  handleDataPathChange,
  setupPermissions,
  getDefaultDataPath,
  getBundledDataPath,
  resetDataRootCache,
} from './appState';
import {
  loadConfigAsync,
  ensureDataFilesAsync,
  copyDataFilesAsync,
  saveConfigAsync,
} from '../dataUtils';
import { validateDataPath } from '../pathValidation';
import { FileManager } from '../FileManager';
import * as securityPolicy from '../securityPolicy';

describe('appState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the state between tests
    state.currentDataRoot = '';
    state.mainWindow = null;
    state.fileManager = null;
    resetDataRootCache();
  });

  afterEach(() => {
    state.currentDataRoot = '';
    state.mainWindow = null;
    state.fileManager = null;
  });

  describe('getDefaultDataPath', () => {
    it('returns a path under userData', () => {
      const p = getDefaultDataPath();
      expect(p).toContain('userData');
      expect(p).toContain('data');
    });
  });

  describe('getBundledDataPath', () => {
    it('returns cwd/data in development', () => {
      const p = getBundledDataPath();
      expect(p).toContain('data');
    });
  });

  describe('getDataRoot', () => {
    it('resolves from config and sets state.currentDataRoot', async () => {
      vi.mocked(loadConfigAsync).mockResolvedValue({ dataRoot: '/custom/data' });
      vi.mocked(ensureDataFilesAsync).mockResolvedValue(undefined);

      const root = await getDataRoot();

      expect(root).toBe('/custom/data');
      expect(state.currentDataRoot).toBe('/custom/data');
      expect(ensureDataFilesAsync).toHaveBeenCalledWith('/custom/data');
    });

    it('returns cached value on subsequent calls without re-loading', async () => {
      state.currentDataRoot = '/already/set';

      const root = await getDataRoot();

      expect(root).toBe('/already/set');
      expect(loadConfigAsync).not.toHaveBeenCalled();
    });

    it('falls back to default path when config has no dataRoot', async () => {
      vi.mocked(loadConfigAsync).mockResolvedValue({ dataRoot: '' });
      vi.mocked(ensureDataFilesAsync).mockResolvedValue(undefined);

      const root = await getDataRoot();

      expect(root).toContain('data');
      expect(ensureDataFilesAsync).toHaveBeenCalled();
    });
  });

  describe('handleDataPathChange', () => {
    it('does nothing when mainWindow is null', async () => {
      state.mainWindow = null;
      await handleDataPathChange('/new/path');

      expect(validateDataPath).not.toHaveBeenCalled();
    });

    it('throws when validateDataPath fails', async () => {
      state.mainWindow = {} as never;
      state.currentDataRoot = '/old/path';

      vi.mocked(validateDataPath).mockResolvedValue({ success: false, error: 'Invalid path' });

      await expect(handleDataPathChange('/bad/path')).rejects.toThrow('Invalid path');
    });

    it('copies files, updates state and creates new FileManager', async () => {
      state.mainWindow = {} as never;
      state.currentDataRoot = '/old/path';
      state.fileManager = null;

      vi.mocked(validateDataPath).mockResolvedValue({ success: true });
      vi.mocked(copyDataFilesAsync).mockResolvedValue(undefined);
      vi.mocked(ensureDataFilesAsync).mockResolvedValue(undefined);
      vi.mocked(saveConfigAsync).mockResolvedValue(undefined);

      await handleDataPathChange('/new/path');

      expect(copyDataFilesAsync).toHaveBeenCalledWith('/old/path', '/new/path');
      expect(ensureDataFilesAsync).toHaveBeenCalledWith('/new/path');
      expect(saveConfigAsync).toHaveBeenCalledWith({ dataRoot: '/new/path' });
      expect(state.currentDataRoot).toBe('/new/path');
      expect(FileManager).toHaveBeenCalledWith('/new/path', expect.any(String));
    });

    it('destroys existing fileManager before creating new one', async () => {
      const mockDestroy = vi.fn();
      state.mainWindow = {} as never;
      state.currentDataRoot = '/old/path';
      state.fileManager = { destroy: mockDestroy, init: vi.fn() } as never;

      vi.mocked(validateDataPath).mockResolvedValue({ success: true });
      vi.mocked(copyDataFilesAsync).mockResolvedValue(undefined);
      vi.mocked(ensureDataFilesAsync).mockResolvedValue(undefined);
      vi.mocked(saveConfigAsync).mockResolvedValue(undefined);

      await handleDataPathChange('/new/path');

      expect(mockDestroy).toHaveBeenCalledOnce();
    });
  });

  describe('setupPermissions', () => {
    it('allows geolocation for main window', () => {
      const mockWindow = {
        webContents: { getURL: vi.fn(() => 'http://localhost') },
      };
      state.mainWindow = mockWindow as never;

      const callback = vi.fn();
      const mockSession = {
        setPermissionRequestHandler: vi.fn((handler) => {
          handler(mockWindow.webContents, 'geolocation', callback, {
            requestingUrl: 'http://localhost',
          });
        }),
        setPermissionCheckHandler: vi.fn(),
      };

      setupPermissions(mockSession as never);
      expect(callback).toHaveBeenCalledWith(true);
    });

    it('denies geolocation for non-main window', () => {
      const mockMainWebContents = { getURL: vi.fn(() => 'http://localhost') };
      state.mainWindow = { webContents: mockMainWebContents } as never;

      const otherWebContents = { send: vi.fn() };
      const callback = vi.fn();
      const mockSession = {
        setPermissionRequestHandler: vi.fn((handler) => {
          handler(otherWebContents, 'geolocation', callback, {
            requestingUrl: 'https://other.com',
          });
        }),
        setPermissionCheckHandler: vi.fn(),
      };

      setupPermissions(mockSession as never);
      expect(callback).toHaveBeenCalledWith(false);
    });

    it('allows media for main window', () => {
      const mockWebContents = { send: vi.fn() };
      state.mainWindow = { webContents: mockWebContents } as never;

      const callback = vi.fn();
      const mockSession = {
        setPermissionRequestHandler: vi.fn((handler) => {
          handler(mockWebContents, 'media', callback, { requestingUrl: '' });
        }),
        setPermissionCheckHandler: vi.fn(),
      };

      setupPermissions(mockSession as never);
      expect(callback).toHaveBeenCalledWith(true);
    });

    it('denies all other permissions', () => {
      const mockWebContents = { send: vi.fn() };
      state.mainWindow = { webContents: mockWebContents } as never;

      const callback = vi.fn();
      const mockSession = {
        setPermissionRequestHandler: vi.fn((handler) => {
          handler(mockWebContents, 'notifications', callback, { requestingUrl: '' });
        }),
        setPermissionCheckHandler: vi.fn(),
      };

      setupPermissions(mockSession as never);
      expect(callback).toHaveBeenCalledWith(false);
    });

    it('setPermissionCheckHandler allows geolocation for main window origin', () => {
      const { getSecureOrigin } = vi.mocked(securityPolicy);
      getSecureOrigin.mockImplementation((url: string) => url);

      state.mainWindow = {
        webContents: { getURL: vi.fn(() => 'http://localhost') },
      } as never;

      let checkHandler: ((wc: unknown, perm: string, origin: string) => boolean) | undefined;
      const mockSession = {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn((handler) => {
          checkHandler = handler;
        }),
      };

      setupPermissions(mockSession as never);
      const result = checkHandler!({}, 'geolocation', 'http://localhost');
      expect(result).toBe(true);
    });

    it('setPermissionCheckHandler denies media for non-main origin', () => {
      state.mainWindow = {
        webContents: { getURL: vi.fn(() => 'http://localhost') },
      } as never;

      let checkHandler: ((wc: unknown, perm: string, origin: string) => boolean) | undefined;
      const mockSession = {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn((handler) => {
          checkHandler = handler;
        }),
      };

      setupPermissions(mockSession as never);
      const result = checkHandler!({}, 'media', 'https://other.com');
      expect(result).toBe(false);
    });
  });
});
