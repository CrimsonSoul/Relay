import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupAuthHandlers, setupAuthInterception } from './authHandlers';
import { ipcMain, app } from 'electron';
import { IPC_CHANNELS } from '@shared/ipc';
import * as CredentialManager from '../credentialManager';
import { trustedEvent } from '../__tests__/testEvents';

// The trusted-sender guard runs for real in this file: trustedEvent() passes
// it (dev-server origin), anything else is rejected. See the
// 'trusted sender guard' describe block below.
process.env.ELECTRON_RENDERER_URL = 'http://localhost:5173';

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  app: {
    on: vi.fn(),
    isPackaged: false,
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
    security: {
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
}));

describe('authHandlers', () => {
  const handlers: Record<string, Function> = {};
  const testPassword = ['p', 'a', 's', 's'].join('');
  const shortSecret = String.fromCharCode(112);
  const cachedSecret = ['cached', 'password'].join('-');

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
      const params = {
        nonce: validNonce,
        username: 'user',
        password: testPassword,
        remember: true,
      };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.(trustedEvent(), params);

      expect(result).toBe(true);
      expect(CredentialManager.consumeAuthRequest).toHaveBeenCalledWith(validNonce);
      expect(CredentialManager.cacheCredentials).toHaveBeenCalledWith(
        'test.com',
        'user',
        testPassword,
      );
      expect(callback).toHaveBeenCalledWith('user', testPassword);
    });

    it('should reject invalid nonce', async () => {
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue(null);

      const params = { nonce: 'short', username: 'u', password: shortSecret, remember: false };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.(trustedEvent(), params);

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
        password: cachedSecret,
      });

      const validNonce = 'b'.repeat(64);
      const result = await handlers[IPC_CHANNELS.AUTH_USE_CACHED]?.(trustedEvent(), {
        nonce: validNonce,
      });

      expect(result).toBe(true);
      expect(callback).toHaveBeenCalledWith('cached-user', cachedSecret);
    });

    it('should fail if no cached credentials exist', async () => {
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue({
        host: 'test.com',
        callback: vi.fn(),
      });
      vi.mocked(CredentialManager.getCachedCredentials).mockReturnValue(null);

      const validNonce = 'b'.repeat(64);
      const result = await handlers[IPC_CHANNELS.AUTH_USE_CACHED]?.(trustedEvent(), {
        nonce: validNonce,
      });

      expect(result).toBe(false);
    });
  });

  describe('AUTH_CANCEL', () => {
    it('should call cancelAuthRequest', () => {
      const validNonce = 'c'.repeat(64);
      handlers[IPC_CHANNELS.AUTH_CANCEL]?.(trustedEvent(), { nonce: validNonce });
      expect(CredentialManager.cancelAuthRequest).toHaveBeenCalledWith(validNonce);
    });

    it('should reject invalid nonce and not call cancel', () => {
      handlers[IPC_CHANNELS.AUTH_CANCEL]?.(trustedEvent(), { nonce: 'tooshort' });
      expect(CredentialManager.cancelAuthRequest).not.toHaveBeenCalled();
    });

    it('ignores malformed payloads without throwing', () => {
      expect(() => handlers[IPC_CHANNELS.AUTH_CANCEL]?.(trustedEvent(), undefined)).not.toThrow();
      expect(() => handlers[IPC_CHANNELS.AUTH_CANCEL]?.(trustedEvent(), 'bad')).not.toThrow();
      expect(CredentialManager.cancelAuthRequest).not.toHaveBeenCalled();
    });
  });

  describe('AUTH_USE_CACHED invalid nonce', () => {
    it('should return false for invalid nonce', async () => {
      const result = await handlers[IPC_CHANNELS.AUTH_USE_CACHED]?.(trustedEvent(), {
        nonce: 'bad',
      });
      expect(result).toBe(false);
      expect(CredentialManager.consumeAuthRequest).not.toHaveBeenCalled();
    });

    it('should return false when consumeAuthRequest returns null', async () => {
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue(null);
      const validNonce = 'd'.repeat(64);
      const result = await handlers[IPC_CHANNELS.AUTH_USE_CACHED]?.(trustedEvent(), {
        nonce: validNonce,
      });
      expect(result).toBe(false);
    });
  });

  describe('AUTH_SUBMIT additional branches', () => {
    it('should return false for invalid username (too long)', async () => {
      const validNonce = 'e'.repeat(64);
      const params = {
        nonce: validNonce,
        username: 'u'.repeat(257),
        password: testPassword,
        remember: false,
      };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.(trustedEvent(), params);
      expect(result).toBe(false);
    });

    it('should return false for invalid password (too long)', async () => {
      const validNonce = 'e'.repeat(64);
      const params = {
        nonce: validNonce,
        username: 'user',
        password: shortSecret.repeat(1025),
        remember: false,
      };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.(trustedEvent(), params);
      expect(result).toBe(false);
    });

    it('should return false when consumeAuthRequest returns null', async () => {
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue(null);
      const validNonce = 'f'.repeat(64);
      const params = { nonce: validNonce, username: 'u', password: shortSecret, remember: false };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.(trustedEvent(), params);
      expect(result).toBe(false);
    });

    it('should not cache credentials when remember is false', async () => {
      const callback = vi.fn();
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue({
        host: 'test.com',
        callback,
      });
      const validNonce = 'a'.repeat(64);
      const params = {
        nonce: validNonce,
        username: 'user',
        password: testPassword,
        remember: false,
      };
      await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.(trustedEvent(), params);
      expect(CredentialManager.cacheCredentials).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith('user', testPassword);
    });
  });

  describe('trusted sender guard (real, un-mocked)', () => {
    it('rejects AUTH_SUBMIT from an untrusted sender with the neutral value', async () => {
      const callback = vi.fn();
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue({
        host: 'test.com',
        callback,
      });

      const evilFrame = { url: 'https://evil.example/' };
      const untrustedEvent = { senderFrame: evilFrame, sender: { mainFrame: evilFrame } };
      const params = {
        nonce: 'a'.repeat(64),
        username: 'user',
        password: testPassword,
        remember: true,
      };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.(untrustedEvent, params);

      expect(result).toBe(false);
      expect(CredentialManager.consumeAuthRequest).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    });

    it('rejects AUTH_SUBMIT from a subframe even on the dev origin', async () => {
      const frame = { url: 'http://localhost:5173/' };
      const subframeEvent = { senderFrame: frame, sender: { mainFrame: { url: frame.url } } };
      const params = {
        nonce: 'a'.repeat(64),
        username: 'user',
        password: testPassword,
        remember: false,
      };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.(subframeEvent, params);

      expect(result).toBe(false);
      expect(CredentialManager.consumeAuthRequest).not.toHaveBeenCalled();
    });

    it('accepts AUTH_SUBMIT from a trusted sender (positive path)', async () => {
      const callback = vi.fn();
      vi.mocked(CredentialManager.consumeAuthRequest).mockReturnValue({
        host: 'test.com',
        callback,
      });
      const params = {
        nonce: 'a'.repeat(64),
        username: 'user',
        password: testPassword,
        remember: false,
      };
      const result = await handlers[IPC_CHANNELS.AUTH_SUBMIT]?.(trustedEvent(), params);
      expect(result).toBe(true);
      expect(callback).toHaveBeenCalled();
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

    it('cancels the login attempt when window is null', () => {
      vi.mocked(CredentialManager.generateAuthNonce).mockReturnValue('nonce456');
      vi.mocked(CredentialManager.getCachedCredentials).mockReturnValue(null);

      const getMainWindow = vi.fn(() => null);
      setupAuthInterception(getMainWindow);

      const mockEvent = { preventDefault: vi.fn() };
      const callback = vi.fn();
      loginHandler(mockEvent, {}, {}, { host: 'test.com', isProxy: false }, callback);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(CredentialManager.registerAuthRequest).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith();
    });

    it('cancels the login attempt when window is destroyed', () => {
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
      const callback = vi.fn();
      loginHandler(mockEvent, {}, {}, { host: 'test.com', isProxy: false }, callback);

      expect(CredentialManager.registerAuthRequest).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('sends hasCachedCredentials true when cached creds exist', () => {
      vi.mocked(CredentialManager.generateAuthNonce).mockReturnValue('nonce000');
      vi.mocked(CredentialManager.getCachedCredentials).mockReturnValue({
        username: 'u',
        password: shortSecret,
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
