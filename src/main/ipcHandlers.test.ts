import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupIpcHandlers } from './ipcHandlers';
import { BrowserWindow } from 'electron';

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
}));

vi.mock('./handlers/weatherHandlers', () => ({
  setupWeatherHandlers: vi.fn(),
}));

vi.mock('./handlers/windowHandlers', () => ({
  setupWindowHandlers: vi.fn(),
}));

vi.mock('./handlers/configHandlers', () => ({
  setupConfigHandlers: vi.fn(),
}));

vi.mock('./handlers/dataHandlers', () => ({
  setupDataHandlers: vi.fn(),
}));

vi.mock('./handlers/fileHandlers', () => ({
  setupFileHandlers: vi.fn(),
}));

vi.mock('./handlers/locationHandlers', () => ({
  setupLocationHandlers: vi.fn(),
}));

vi.mock('./handlers/featureHandlers', () => ({
  setupFeatureHandlers: vi.fn(),
}));

vi.mock('./handlers/dataRecordHandlers', () => ({
  setupDataRecordHandlers: vi.fn(),
}));

vi.mock('./logger', () => ({
  loggers: {
    main: {
      error: vi.fn(),
      warn: vi.fn(),
    },
  },
}));

import { setupWeatherHandlers } from './handlers/weatherHandlers';
import { setupWindowHandlers } from './handlers/windowHandlers';
import { setupConfigHandlers } from './handlers/configHandlers';
import { setupDataHandlers } from './handlers/dataHandlers';
import { setupFileHandlers } from './handlers/fileHandlers';
import { setupLocationHandlers } from './handlers/locationHandlers';
import { setupFeatureHandlers } from './handlers/featureHandlers';
import { setupDataRecordHandlers } from './handlers/dataRecordHandlers';
import { loggers } from './logger';
import { FileManager } from './FileManager';

vi.mock('./FileManager', () => ({
  FileManager: vi.fn(),
}));

describe('ipcHandlers', () => {
  const getMainWindow = vi.fn(() => null as BrowserWindow | null);
  const getFileManager = vi.fn(() => null as FileManager | null);
  const getDataRoot = vi.fn(async () => '/data/relay');
  const onDataPathChange = vi.fn(async () => undefined);
  const getDefaultDataPath = vi.fn(() => '/default/relay');
  const createAuxWindow = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls all handler setup functions', () => {
    setupIpcHandlers(
      getMainWindow,
      getFileManager,
      getDataRoot,
      onDataPathChange,
      getDefaultDataPath,
      createAuxWindow,
    );

    expect(setupConfigHandlers).toHaveBeenCalled();
    expect(setupDataHandlers).toHaveBeenCalled();
    expect(setupFileHandlers).toHaveBeenCalled();
    expect(setupLocationHandlers).toHaveBeenCalled();
    expect(setupWeatherHandlers).toHaveBeenCalled();
    expect(setupWindowHandlers).toHaveBeenCalledWith(getMainWindow, createAuxWindow);
    expect(setupFeatureHandlers).toHaveBeenCalled();
    expect(setupDataRecordHandlers).toHaveBeenCalled();
  });

  it('works without optional createAuxWindow parameter', () => {
    setupIpcHandlers(
      getMainWindow,
      getFileManager,
      getDataRoot,
      onDataPathChange,
      getDefaultDataPath,
    );

    expect(setupWindowHandlers).toHaveBeenCalledWith(getMainWindow, undefined);
  });

  it('continues setup if one handler throws', () => {
    vi.mocked(setupConfigHandlers).mockImplementationOnce(() => {
      throw new Error('config setup failed');
    });

    setupIpcHandlers(
      getMainWindow,
      getFileManager,
      getDataRoot,
      onDataPathChange,
      getDefaultDataPath,
    );

    // Should log the error
    expect(loggers.main.error).toHaveBeenCalledWith(
      'Failed to setup config handlers',
      expect.any(Object),
    );
    // All other handlers should still have been called
    expect(setupDataHandlers).toHaveBeenCalled();
    expect(setupWeatherHandlers).toHaveBeenCalled();
  });

  it('guardedGetDataRoot warns when dataRoot is empty', async () => {
    getDataRoot.mockResolvedValueOnce('');
    setupIpcHandlers(
      getMainWindow,
      getFileManager,
      getDataRoot,
      onDataPathChange,
      getDefaultDataPath,
    );

    // Extract the guardedGetDataRoot by calling what was passed to setupConfigHandlers
    const configHandlerArgs = vi.mocked(setupConfigHandlers).mock.calls[0];
    const guardedGetDataRoot = configHandlerArgs[1] as () => Promise<string>;
    const result = await guardedGetDataRoot();
    expect(result).toBe('');
    expect(loggers.main.warn).toHaveBeenCalledWith(
      'getDataRoot() returned empty string — data root not yet initialized',
    );
  });

  it('guardedGetDataRoot returns data root without warning when non-empty', async () => {
    setupIpcHandlers(
      getMainWindow,
      getFileManager,
      getDataRoot,
      onDataPathChange,
      getDefaultDataPath,
    );

    const configHandlerArgs = vi.mocked(setupConfigHandlers).mock.calls[0];
    const guardedGetDataRoot = configHandlerArgs[1] as () => Promise<string>;
    const result = await guardedGetDataRoot();
    expect(result).toBe('/data/relay');
    expect(loggers.main.warn).not.toHaveBeenCalled();
  });
});
