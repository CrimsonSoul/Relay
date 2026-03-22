import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import { setupConfigHandlers } from './configHandlers';

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
}));

vi.mock('../securityPolicy', () => ({
  registerTrustedWebviewOrigin: vi.fn(),
  clearTrustedRuntimeOrigins: vi.fn(),
}));

import { registerTrustedWebviewOrigin, clearTrustedRuntimeOrigins } from '../securityPolicy';

describe('configHandlers', () => {
  const handlers: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(ipcMain.handle).mockImplementation(
      (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers[channel] = handler;
        return ipcMain;
      },
    );

    setupConfigHandlers();
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
