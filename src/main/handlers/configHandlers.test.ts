import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain, BrowserWindow, dialog } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupConfigHandlers } from './configHandlers';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  dialog: {
    showOpenDialog: vi.fn(),
  },
}));

vi.mock('../securityPolicy', () => ({
  registerTrustedWebviewOrigin: vi.fn(),
  clearTrustedRuntimeOrigins: vi.fn(),
}));

import { registerTrustedWebviewOrigin, clearTrustedRuntimeOrigins } from '../securityPolicy';

describe('configHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const getMainWindow = vi.fn(() => null as BrowserWindow | null);
  const getDataRoot = vi.fn(async () => '/data/relay');
  const onDataPathChange = vi.fn(async () => undefined);
  const getDefaultDataPath = vi.fn(() => '/default/relay');

  const mockWin = { id: 'main' } as unknown as BrowserWindow;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers[channel] = handler;
        return ipcMain;
      },
    );

    setupConfigHandlers(getMainWindow, getDataRoot, onDataPathChange, getDefaultDataPath);
  });

  describe('GET_DATA_PATH', () => {
    it('returns the current data root', async () => {
      const result = await handlers[IPC_CHANNELS.GET_DATA_PATH]();
      expect(result).toBe('/data/relay');
      expect(getDataRoot).toHaveBeenCalled();
    });
  });

  describe('CHANGE_DATA_FOLDER', () => {
    it('returns error when main window is null', async () => {
      getMainWindow.mockReturnValueOnce(null);
      const result = await handlers[IPC_CHANNELS.CHANGE_DATA_FOLDER]();
      expect(result).toEqual({ success: false, error: 'Main window not available' });
    });

    it('returns error when dialog is cancelled', async () => {
      getMainWindow.mockReturnValueOnce(mockWin);
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] });
      const result = await handlers[IPC_CHANNELS.CHANGE_DATA_FOLDER]();
      expect(result).toEqual({ success: false, error: 'Cancelled' });
    });

    it('returns error when no file path selected', async () => {
      getMainWindow.mockReturnValueOnce(mockWin);
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [] });
      const result = await handlers[IPC_CHANNELS.CHANGE_DATA_FOLDER]();
      expect(result).toEqual({ success: false, error: 'Cancelled' });
    });

    it('calls onDataPathChange and returns success', async () => {
      getMainWindow.mockReturnValueOnce(mockWin);
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/new/path'],
      });
      const result = await handlers[IPC_CHANNELS.CHANGE_DATA_FOLDER]();
      expect(onDataPathChange).toHaveBeenCalledWith('/new/path');
      expect(result).toEqual({ success: true });
    });

    it('returns error when onDataPathChange throws', async () => {
      getMainWindow.mockReturnValueOnce(mockWin);
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: ['/new/path'],
      });
      onDataPathChange.mockRejectedValueOnce(new Error('write failed'));
      const result = await handlers[IPC_CHANNELS.CHANGE_DATA_FOLDER]();
      expect(result).toEqual({ success: false, error: 'write failed' });
    });
  });

  describe('RESET_DATA_FOLDER', () => {
    it('resets to default path and returns success', async () => {
      const result = await handlers[IPC_CHANNELS.RESET_DATA_FOLDER]();
      expect(getDefaultDataPath).toHaveBeenCalled();
      expect(onDataPathChange).toHaveBeenCalledWith('/default/relay');
      expect(result).toEqual({ success: true });
    });

    it('returns error when onDataPathChange throws', async () => {
      onDataPathChange.mockRejectedValueOnce(new Error('reset failed'));
      const result = await handlers[IPC_CHANNELS.RESET_DATA_FOLDER]();
      expect(result).toEqual({ success: false, error: 'reset failed' });
    });
  });

  describe('REGISTER_RADAR_URL', () => {
    it('clears origins and registers a new URL', async () => {
      await handlers[IPC_CHANNELS.REGISTER_RADAR_URL](null, 'https://radar.example.com');
      expect(clearTrustedRuntimeOrigins).toHaveBeenCalled();
      expect(registerTrustedWebviewOrigin).toHaveBeenCalledWith('https://radar.example.com');
    });

    it('clears origins but skips registration when URL is empty', async () => {
      await handlers[IPC_CHANNELS.REGISTER_RADAR_URL](null, '');
      expect(clearTrustedRuntimeOrigins).toHaveBeenCalled();
      expect(registerTrustedWebviewOrigin).not.toHaveBeenCalled();
    });

    it('clears origins but skips registration when URL is falsy', async () => {
      await handlers[IPC_CHANNELS.REGISTER_RADAR_URL](null, null);
      expect(clearTrustedRuntimeOrigins).toHaveBeenCalled();
      expect(registerTrustedWebviewOrigin).not.toHaveBeenCalled();
    });
  });
});
