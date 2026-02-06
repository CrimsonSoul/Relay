import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupAuthHandlers } from './authHandlers';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc';
import * as CredentialManager from '../CredentialManager';

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  app: {
    on: vi.fn(),
  },
}));

// Mock CredentialManager
vi.mock('../CredentialManager', () => ({
  generateAuthNonce: vi.fn(),
  registerAuthRequest: vi.fn(),
  consumeAuthRequest: vi.fn(),
  cancelAuthRequest: vi.fn(),
  cacheCredentials: vi.fn(),
  getCachedCredentials: vi.fn(),
}));

// Mock logger
vi.mock('../logger', () => ({
  loggers: {
    auth: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('authHandlers', () => {
  const handlers: Record<string, Function> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Capture handlers
    vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });
    vi.mocked(ipcMain.on).mockImplementation((channel, handler) => {
      handlers[channel] = handler;
    });

    setupAuthHandlers();
  });

  describe('AUTH_SUBMIT', () => {
    it('should consume nonce and execute callback', async () => {
      const callback = vi.fn();
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue({
        host: 'test.com',
        callback
      });

      const validNonce = 'a'.repeat(64);
      const params = { nonce: validNonce, username: 'user', password: 'pass', remember: true };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]({}, params);

      expect(result).toBe(true);
      expect(CredentialManager.consumeAuthRequest).toHaveBeenCalledWith(validNonce);
      expect(CredentialManager.cacheCredentials).toHaveBeenCalledWith('test.com', 'user', 'pass');
      expect(callback).toHaveBeenCalledWith(['user', 'pass']);
    });

    it('should reject invalid nonce', async () => {
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue(null);

      const params = { nonce: 'short', username: 'u', password: 'p', remember: false };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]({}, params);

      expect(result).toBe(false);
      expect(CredentialManager.cacheCredentials).not.toHaveBeenCalled();
    });
  });

  describe('AUTH_USE_CACHED', () => {
    it('should use cached credentials if available', async () => {
      const callback = vi.fn();
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue({
        host: 'test.com',
        callback
      });
      vi.mocked(CredentialManager.getCachedCredentials).mockReturnValue({
        username: 'cached-user',
        password: 'cached-password'
      });

      const validNonce = 'b'.repeat(64);
      const result = await handlers[IPC_CHANNELS.AUTH_USE_CACHED]({}, { nonce: validNonce });

      expect(result).toBe(true);
      expect(callback).toHaveBeenCalledWith(['cached-user', 'cached-password']);
    });

    it('should fail if no cached credentials exist', async () => {
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue({
        host: 'test.com',
        callback: vi.fn()
      });
      vi.mocked(CredentialManager.getCachedCredentials).mockReturnValue(null);

      const validNonce = 'b'.repeat(64);
      const result = await handlers[IPC_CHANNELS.AUTH_USE_CACHED]({}, { nonce: validNonce });

      expect(result).toBe(false);
    });
  });

  describe('AUTH_CANCEL', () => {
    it('should call cancelAuthRequest', () => {
      const validNonce = 'c'.repeat(64);
      handlers[IPC_CHANNELS.AUTH_CANCEL]({}, { nonce: validNonce });
      expect(CredentialManager.cancelAuthRequest).toHaveBeenCalledWith(validNonce);
    });
  });
});
