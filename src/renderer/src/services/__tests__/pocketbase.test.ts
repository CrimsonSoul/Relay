import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PbAuthSession, PbConnectionResult } from '@shared/ipc';

// ---------------------------------------------------------------------------
// Hoisted mocks – must be declared before any imports that reference them
// ---------------------------------------------------------------------------

const { networkWarn } = vi.hoisted(() => ({
  networkWarn: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  loggers: {
    network: { warn: networkWarn, error: vi.fn(), info: vi.fn() },
  },
}));

const mockAuthSave = vi.fn();
const mockAuthStore = { isValid: true, save: mockAuthSave };

vi.mock('pocketbase', () => {
  return {
    default: class MockPocketBase {
      baseURL: string;
      authStore = mockAuthStore;
      constructor(url: string) {
        this.baseURL = url;
      }
    },
  };
});

vi.mock('../pbErrors', () => ({
  isPbNotFoundError: vi.fn(
    (err: unknown) =>
      err instanceof Error && 'status' in err && (err as { status: number }).status === 404,
  ),
}));

// ---------------------------------------------------------------------------
// Import the module under test — AFTER mocks are in place
// ---------------------------------------------------------------------------

import * as pocketbaseService from '../pocketbase';
import {
  initPocketBase,
  getPb,
  getConnectionState,
  onConnectionStateChange,
  loadAuthSession,
  refreshAuthSession,
  startHealthCheck,
  stopHealthCheck,
  handleApiError,
  requireOnline,
  escapeFilter,
  isOnline,
} from '../pocketbase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset module-level state by re-initialising PocketBase. */
function resetPbState(url = 'http://localhost:8090'): void {
  initPocketBase(url);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pocketbase service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAuthStore.isValid = true;
    globalThis.api = {
      refreshPbConnection: vi.fn(),
    } as typeof globalThis.api;
    // Reset the module-level connection state by re-initializing
    resetPbState();
  });

  afterEach(() => {
    stopHealthCheck();
    delete globalThis.api;
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // getPb
  // -------------------------------------------------------------------------
  describe('getPb()', () => {
    it('returns a PocketBase instance after initPocketBase', () => {
      const pb = getPb();
      expect(pb).toBeDefined();
      expect(pb.baseURL).toBe('http://localhost:8090');
    });
  });

  // -------------------------------------------------------------------------
  // getConnectionState / isOnline
  // -------------------------------------------------------------------------
  describe('getConnectionState / isOnline', () => {
    it('starts in "connecting" state after init', () => {
      expect(getConnectionState()).toBe('connecting');
      expect(isOnline()).toBe(false);
    });
  });

  describe('module surface', () => {
    it('does not export renderer password auth entry points', () => {
      expect('authenticate' in pocketbaseService).toBe(false);
      expect('AUTH_TIMEOUT_MS' in pocketbaseService).toBe(false);
    });
  });

  describe('onConnectionStateChange', () => {
    it('calls listener when state changes and returns unsubscribe function', async () => {
      const listener = vi.fn();
      const unsub = onConnectionStateChange(listener);
      const auth: PbAuthSession = { token: 'token-1', record: { id: 'user-1' } };

      loadAuthSession(auth, true);

      expect(listener).toHaveBeenCalledWith('online');

      unsub();
      listener.mockClear();

      resetPbState();
      loadAuthSession(auth, true);

      expect(listener).not.toHaveBeenCalled();
    });

    it('does not call listener when state is set to the same value', async () => {
      const listener = vi.fn();
      onConnectionStateChange(listener);
      const auth: PbAuthSession = { token: 'token-1', record: { id: 'user-1' } };

      loadAuthSession(auth, true);
      expect(listener).toHaveBeenCalledTimes(1);

      listener.mockClear();
      loadAuthSession(auth, true);
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('loadAuthSession()', () => {
    it('hydrates authStore from main-provided session data and marks connection online', () => {
      const auth: PbAuthSession = {
        token: 'token-123',
        record: { id: 'user-1', email: 'relay@example.com' },
      };

      loadAuthSession(auth);

      expect(mockAuthSave).toHaveBeenCalledWith(auth.token, auth.record);
      expect(getConnectionState()).toBe('online');
    });
  });

  describe('refreshAuthSession()', () => {
    it('refreshes through main, hydrates returned auth, and reports success', async () => {
      const auth: PbAuthSession = {
        token: 'refreshed-token',
        record: { id: 'user-1' },
      };
      const resultFromMain: PbConnectionResult = {
        ok: true,
        connection: {
          pbUrl: 'http://localhost:8090',
          auth,
        },
      };
      const refreshPbConnection = vi.fn().mockResolvedValue(resultFromMain);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;

      const result = await refreshAuthSession();

      expect(result).toBe(true);
      expect(refreshPbConnection).toHaveBeenCalledTimes(1);
      expect(mockAuthSave).toHaveBeenCalledWith(auth.token, auth.record);
      expect(getConnectionState()).toBe('online');
    });

    it('updates the PocketBase base URL when refresh returns a different server URL', async () => {
      const auth: PbAuthSession = {
        token: 'refreshed-token',
        record: { id: 'user-1' },
      };
      const resultFromMain: PbConnectionResult = {
        ok: true,
        connection: {
          pbUrl: 'http://localhost:8091',
          auth,
        },
      };
      const refreshPbConnection = vi.fn().mockResolvedValue(resultFromMain);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;

      expect(getPb().baseURL).toBe('http://localhost:8090');

      const result = await refreshAuthSession(true);

      expect(result).toBe(true);
      expect(getPb().baseURL).toBe('http://localhost:8091');
      expect(mockAuthSave).toHaveBeenCalledWith(auth.token, auth.record);
    });

    it('returns false when main refresh does not provide an auth session', async () => {
      const resultFromMain: PbConnectionResult = {
        ok: false,
        error: 'auth-failed',
      };
      const refreshPbConnection = vi.fn().mockResolvedValue(resultFromMain);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;

      const result = await refreshAuthSession();

      expect(result).toBe(false);
      expect(mockAuthSave).not.toHaveBeenCalled();
    });

    it('returns false when main refresh is unavailable', async () => {
      const refreshPbConnection = vi.fn().mockResolvedValue(null);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;

      const result = await refreshAuthSession();

      expect(result).toBe(false);
      expect(mockAuthSave).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // startHealthCheck / stopHealthCheck
  // -------------------------------------------------------------------------
  describe('startHealthCheck / stopHealthCheck', () => {
    it('creates an interval that pings /api/health', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck(5000);

      // Advance past one interval tick
      await vi.advanceTimersByTimeAsync(5000);

      expect(fetchMock).toHaveBeenCalledWith('http://localhost:8090/api/health');

      vi.unstubAllGlobals();
    });

    it('sets state to offline when health check fetch fails', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);
      expect(getConnectionState()).toBe('online');

      const fetchMock = vi.fn().mockRejectedValue(new Error('net error'));
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck(5000);
      await vi.advanceTimersByTimeAsync(5000);

      expect(getConnectionState()).toBe('offline');

      vi.unstubAllGlobals();
    });

    it('sets state to offline when health check returns non-ok response', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);
      expect(getConnectionState()).toBe('online');

      const fetchMock = vi.fn().mockResolvedValue({ ok: false });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck(5000);
      await vi.advanceTimersByTimeAsync(5000);

      expect(getConnectionState()).toBe('offline');

      vi.unstubAllGlobals();
    });

    it('refreshes through main when coming back online with invalid auth', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);
      expect(getConnectionState()).toBe('online');

      // Simulate going offline
      const fetchMock = vi.fn().mockRejectedValueOnce(new Error('net'));
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck(5000);
      await vi.advanceTimersByTimeAsync(5000);
      expect(getConnectionState()).toBe('offline');

      // Now health returns OK but auth is invalid — should refresh via main
      mockAuthStore.isValid = false;
      fetchMock.mockResolvedValue({ ok: true });
      const refreshedAuth: PbAuthSession = {
        token: 'refreshed-token',
        record: { id: 'user-1' },
      };
      const resultFromMain: PbConnectionResult = {
        ok: true,
        connection: {
          pbUrl: 'http://localhost:8090',
          auth: refreshedAuth,
        },
      };
      const refreshPbConnection = vi.fn().mockResolvedValue(resultFromMain);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;

      await vi.advanceTimersByTimeAsync(5000);

      expect(getConnectionState()).toBe('online');
      expect(refreshPbConnection).toHaveBeenCalledTimes(1);
      expect(mockAuthSave).toHaveBeenCalledWith(refreshedAuth.token, refreshedAuth.record);
      // Restore
      mockAuthStore.isValid = true;

      vi.unstubAllGlobals();
    });

    it('does not reconnect when auth is invalid and main refresh fails', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);

      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('net'))
        .mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck(5000);
      // Go offline
      await vi.advanceTimersByTimeAsync(5000);

      // Now health OK but auth invalid and no secret
      mockAuthStore.isValid = false;
      const resultFromMain: PbConnectionResult = {
        ok: false,
        error: 'auth-failed',
      };
      const refreshPbConnection = vi.fn().mockResolvedValue(resultFromMain);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;
      await vi.advanceTimersByTimeAsync(5000);

      // Should NOT have reconnected — state still offline
      expect(getConnectionState()).not.toBe('online');
      expect(refreshPbConnection).toHaveBeenCalledTimes(1);

      mockAuthStore.isValid = true;
      vi.unstubAllGlobals();
    });

    it('sets state to online when coming back with valid auth (no re-auth needed)', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);

      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('net'))
        .mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck(5000);
      // Go offline
      await vi.advanceTimersByTimeAsync(5000);
      expect(getConnectionState()).toBe('offline');

      // Auth still valid, health OK => should go online
      mockAuthStore.isValid = true;
      await vi.advanceTimersByTimeAsync(5000);

      expect(getConnectionState()).toBe('online');

      vi.unstubAllGlobals();
    });

    it('logs warning when main refresh fails on reconnect', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);

      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('net'))
        .mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck(5000);
      await vi.advanceTimersByTimeAsync(5000);
      expect(getConnectionState()).toBe('offline');

      // Auth invalid, main refresh will fail
      mockAuthStore.isValid = false;
      const refreshPbConnection = vi.fn().mockRejectedValue(new Error('fail'));
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;

      await vi.advanceTimersByTimeAsync(5000);

      // Should remain offline and log warning
      expect(getConnectionState()).not.toBe('online');
      expect(networkWarn).toHaveBeenCalled();

      mockAuthStore.isValid = true;
      vi.unstubAllGlobals();
    });

    it('stopHealthCheck clears the interval', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck(5000);
      stopHealthCheck();

      await vi.advanceTimersByTimeAsync(10000);

      // Fetch should not have been called because interval was cleared
      expect(fetchMock).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it('stopHealthCheck is safe to call when no health check is running', () => {
      expect(() => stopHealthCheck()).not.toThrow();
    });

    it('does not change state when already offline and fetch fails', async () => {
      const listener = vi.fn();
      onConnectionStateChange(listener);

      // State is 'connecting' (not online, not offline)
      const fetchMock = vi.fn().mockRejectedValue(new Error('net'));
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck(5000);
      await vi.advanceTimersByTimeAsync(5000);

      // State was 'connecting', catch block only sets offline if currently 'online'
      // so the listener should NOT have been called with 'offline'
      expect(listener).not.toHaveBeenCalledWith('offline');

      vi.unstubAllGlobals();
    });
  });

  // -------------------------------------------------------------------------
  // handleApiError
  // -------------------------------------------------------------------------
  describe('handleApiError()', () => {
    it('sets offline for TypeError with "fetch" in message', () => {
      const listener = vi.fn();
      onConnectionStateChange(listener);

      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);
      listener.mockClear();

      handleApiError(new TypeError('Failed to fetch'));

      expect(listener).toHaveBeenCalledWith('offline');
    });

    it('sets offline for PocketBase ClientResponseError with status 0', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);
      expect(getConnectionState()).toBe('online');

      const listener = vi.fn();
      onConnectionStateChange(listener);

      handleApiError({ status: 0, message: 'network error' });

      expect(listener).toHaveBeenCalledWith('offline');
    });

    it('does not change state for non-network errors', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);
      expect(getConnectionState()).toBe('online');

      const listener = vi.fn();
      onConnectionStateChange(listener);

      handleApiError(new Error('Some other error'));

      expect(listener).not.toHaveBeenCalled();
      expect(getConnectionState()).toBe('online');
    });

    it('does not change state for errors with non-zero status', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);

      const listener = vi.fn();
      onConnectionStateChange(listener);

      handleApiError({ status: 400, message: 'bad request' });

      expect(listener).not.toHaveBeenCalled();
    });

    it('handles null/undefined errors gracefully', () => {
      expect(() => handleApiError(null)).not.toThrow();
      expect(() => handleApiError(undefined)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // requireOnline
  // -------------------------------------------------------------------------
  describe('requireOnline()', () => {
    it('throws when offline', () => {
      // State is 'connecting' (not online)
      expect(() => requireOnline()).toThrow('You are offline');
    });

    it('does not throw when online', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);
      expect(getConnectionState()).toBe('online');

      expect(() => requireOnline()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // escapeFilter
  // -------------------------------------------------------------------------
  describe('escapeFilter()', () => {
    it('escapes double quotes', () => {
      expect(escapeFilter('hello "world"')).toBe('hello \\"world\\"');
    });

    it('escapes backslashes', () => {
      expect(escapeFilter('path\\to\\file')).toBe('path\\\\to\\\\file');
    });

    it('escapes both backslashes and quotes', () => {
      expect(escapeFilter('a\\"b')).toBe('a\\\\\\"b');
    });

    it('returns empty string unchanged', () => {
      expect(escapeFilter('')).toBe('');
    });

    it('returns plain string unchanged', () => {
      expect(escapeFilter('hello world')).toBe('hello world');
    });
  });
});
