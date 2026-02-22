import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupAuthHandlers, setupAuthInterception } from './authHandlers';
import { ipcMain, app } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import * as CredentialManager from '../credentialManager';

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
vi.mock('../credentialManager', () => ({
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
      return ipcMain;
    });

    setupAuthHandlers();
  });

  describe('AUTH_SUBMIT', () => {
    it('should consume nonce and execute callback', async () => {
      const callback = vi.fn();
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue({
        host: 'test.com',
        callback,
      });

      const validNonce = 'a'.repeat(64);
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords
      const params = { nonce: validNonce, username: 'user', password: 'pass', remember: true };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.({}, params);

      expect(result).toBe(true);
      expect(CredentialManager.consumeAuthRequest).toHaveBeenCalledWith(validNonce);
      expect(CredentialManager.cacheCredentials).toHaveBeenCalledWith('test.com', 'user', 'pass');
      expect(callback).toHaveBeenCalledWith(['user', 'pass']);
    });

    it('should reject invalid nonce', async () => {
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue(null);

      // eslint-disable-next-line sonarjs/no-hardcoded-passwords
      const params = { nonce: 'short', username: 'u', password: 'p', remember: false };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.({}, params);

      expect(result).toBe(false);
      expect(CredentialManager.cacheCredentials).not.toHaveBeenCalled();
    });
  });

  describe('AUTH_USE_CACHED', () => {
    it('should use cached credentials if available', async () => {
      const callback = vi.fn();
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue({
        host: 'test.com',
        callback,
      });
      vi.mocked(CredentialManager.getCachedCredentials).mockReturnValue({
        username: 'cached-user',
        // eslint-disable-next-line sonarjs/no-hardcoded-passwords
        password: 'cached-password',
      });

      const validNonce = 'b'.repeat(64);
      const result = await handlers[IPC_CHANNELS.AUTH_USE_CACHED]?.({}, { nonce: validNonce });

      expect(result).toBe(true);
      expect(callback).toHaveBeenCalledWith(['cached-user', 'cached-password']);
    });

    it('should fail if no cached credentials exist', async () => {
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue({
        host: 'test.com',
        callback: vi.fn(),
      });
      vi.mocked(CredentialManager.getCachedCredentials).mockReturnValue(null);

      const validNonce = 'b'.repeat(64);
      const result = await handlers[IPC_CHANNELS.AUTH_USE_CACHED]?.({}, { nonce: validNonce });

      expect(result).toBe(false);
    });
  });

  describe('AUTH_CANCEL', () => {
    it('should call cancelAuthRequest', () => {
      const validNonce = 'c'.repeat(64);
      handlers[IPC_CHANNELS.AUTH_CANCEL]?.({}, { nonce: validNonce });
      expect(CredentialManager.cancelAuthRequest).toHaveBeenCalledWith(validNonce);
    });

    it('should reject invalid nonce and not call cancel', () => {
      handlers[IPC_CHANNELS.AUTH_CANCEL]?.({}, { nonce: 'tooshort' });
      expect(CredentialManager.cancelAuthRequest).not.toHaveBeenCalled();
    });
  });

  describe('AUTH_USE_CACHED invalid nonce', () => {
    it('should return false for invalid nonce', async () => {
      const result = await handlers[IPC_CHANNELS.AUTH_USE_CACHED]?.({}, { nonce: 'bad' });
      expect(result).toBe(false);
      expect(CredentialManager.consumeAuthRequest).not.toHaveBeenCalled();
    });

    it('should return false when consumeAuthRequest returns null', async () => {
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue(null);
      const validNonce = 'd'.repeat(64);
      const result = await handlers[IPC_CHANNELS.AUTH_USE_CACHED]?.({}, { nonce: validNonce });
      expect(result).toBe(false);
    });
  });

  describe('AUTH_SUBMIT additional branches', () => {
    it('should return false for invalid username (too long)', async () => {
      const validNonce = 'e'.repeat(64);
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords
      const params = {
        nonce: validNonce,
        username: 'u'.repeat(257),
        password: 'pass',
        remember: false,
      };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.({}, params);
      expect(result).toBe(false);
    });

    it('should return false for invalid password (too long)', async () => {
      const validNonce = 'e'.repeat(64);
      const params = {
        nonce: validNonce,
        username: 'user',
        password: 'p'.repeat(1025),
        remember: false,
      };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.({}, params);
      expect(result).toBe(false);
    });

    it('should return false when consumeAuthRequest returns null', async () => {
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue(null);
      const validNonce = 'f'.repeat(64);
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords
      const params = { nonce: validNonce, username: 'u', password: 'p', remember: false };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.({}, params);
      expect(result).toBe(false);
    });

    it('should not cache credentials when remember is false', async () => {
      const callback = vi.fn();
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue({
        host: 'test.com',
        callback,
      });
      const validNonce = 'a'.repeat(64);
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords
      const params = { nonce: validNonce, username: 'user', password: 'pass', remember: false };
      await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.({}, params);
      expect(CredentialManager.cacheCredentials).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(['user', 'pass']);
    });
  });

  describe('setupAuthInterception', () => {
    let loginHandler: Function;

    beforeEach(() => {
      vi.mocked(app.on).mockImplementation((_event: string, handler: Function) => {
        loginHandler = handler;
        return app;
      });
    });

    it('sends AUTH_REQUESTED to main window when window is open', () => {
      vi.mocked(CredentialManager.generateAuthNonce).mockReturnValue('nonce123');
      vi.mocked(CredentialManager.getCachedCredentials).mockReturnValue(null);

      const mockSend = vi.fn();
      const mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: mockSend },
      };
      const getMainWindow = vi.fn(() => mockWindow as never);
      setupAuthInterception(getMainWindow);

      const mockEvent = { preventDefault: vi.fn() };
      loginHandler(mockEvent, {}, {}, { host: 'test.com', isProxy: false }, vi.fn());

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(CredentialManager.registerAuthRequest).toHaveBeenCalledWith(
        'nonce123',
        'test.com',
        expect.any(Function),
      );
      expect(mockSend).toHaveBeenCalledWith(IPC_CHANNELS.AUTH_REQUESTED, {
        host: 'test.com',
        isProxy: false,
        nonce: 'nonce123',
        hasCachedCredentials: false,
      });
    });

    it('does not send when window is null', () => {
      vi.mocked(CredentialManager.generateAuthNonce).mockReturnValue('nonce456');
      vi.mocked(CredentialManager.getCachedCredentials).mockReturnValue(null);

      const getMainWindow = vi.fn(() => null);
      setupAuthInterception(getMainWindow);

      const mockEvent = { preventDefault: vi.fn() };
      loginHandler(mockEvent, {}, {}, { host: 'test.com', isProxy: false }, vi.fn());

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      // No send — no window
    });

    it('does not send when window is destroyed', () => {
      vi.mocked(CredentialManager.generateAuthNonce).mockReturnValue('nonce789');
      vi.mocked(CredentialManager.getCachedCredentials).mockReturnValue(null);

      const mockSend = vi.fn();
      const mockWindow = {
        isDestroyed: vi.fn(() => true),
        webContents: { send: mockSend },
      };
      const getMainWindow = vi.fn(() => mockWindow as never);
      setupAuthInterception(getMainWindow);

      const mockEvent = { preventDefault: vi.fn() };
      loginHandler(mockEvent, {}, {}, { host: 'test.com', isProxy: false }, vi.fn());

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('sends hasCachedCredentials true when cached creds exist', () => {
      vi.mocked(CredentialManager.generateAuthNonce).mockReturnValue('nonce000');
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords
      vi.mocked(CredentialManager.getCachedCredentials).mockReturnValue({
        username: 'u',
        password: 'p',
      });

      const mockSend = vi.fn();
      const mockWindow = {
        isDestroyed: vi.fn(() => false),
        webContents: { send: mockSend },
      };
      const getMainWindow = vi.fn(() => mockWindow as never);
      setupAuthInterception(getMainWindow);

      const mockEvent = { preventDefault: vi.fn() };
      loginHandler(mockEvent, {}, {}, { host: 'myhost.com', isProxy: true }, vi.fn());

      expect(mockSend).toHaveBeenCalledWith(
        IPC_CHANNELS.AUTH_REQUESTED,
        expect.objectContaining({
          hasCachedCredentials: true,
        }),
      );
    });
  });
});
