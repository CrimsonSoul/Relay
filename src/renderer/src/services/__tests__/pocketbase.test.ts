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
  getPocketBaseClientGeneration,
  onPocketBaseClientChange,
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
    // startHealthCheck probes immediately, so give tests that don't stub
    // fetch themselves a never-settling default — it avoids real network
    // calls AND can't drive state changes that would mask test assertions.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    // Reset the module-level connection state by re-initializing
    resetPbState();
  });

  afterEach(() => {
    stopHealthCheck();
    delete globalThis.api;
    vi.unstubAllGlobals();
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

  describe('PocketBase client generation', () => {
    it('notifies listeners when initPocketBase replaces the client URL', () => {
      const listener = vi.fn();
      const unsubscribe = onPocketBaseClientChange(listener);
      const before = getPocketBaseClientGeneration();

      initPocketBase('http://localhost:8091');

      expect(getPocketBaseClientGeneration()).toBe(before + 1);
      expect(listener).toHaveBeenCalledWith(before + 1);

      listener.mockClear();
      initPocketBase('http://localhost:8091');
      expect(listener).not.toHaveBeenCalled();

      unsubscribe();
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

      expect(result).toBe('ok');
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

      expect(result).toBe('ok');
      expect(getPb().baseURL).toBe('http://localhost:8091');
      expect(mockAuthSave).toHaveBeenCalledWith(auth.token, auth.record);
    });

    it('returns auth-failed when main refresh reports an auth failure', async () => {
      const resultFromMain: PbConnectionResult = {
        ok: false,
        error: 'auth-failed',
      };
      const refreshPbConnection = vi.fn().mockResolvedValue(resultFromMain);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;

      const result = await refreshAuthSession();

      expect(result).toBe('auth-failed');
      expect(mockAuthSave).not.toHaveBeenCalled();
    });

    it('returns unavailable when main refresh is unavailable', async () => {
      const refreshPbConnection = vi.fn().mockResolvedValue(null);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;

      const result = await refreshAuthSession();

      expect(result).toBe('unavailable');
      expect(mockAuthSave).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // startHealthCheck / stopHealthCheck
  // -------------------------------------------------------------------------
  describe('startHealthCheck / stopHealthCheck', () => {
    it('starts a probe loop that pings /api/health', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck();

      // The first probe fires immediately
      await vi.advanceTimersByTimeAsync(0);

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:8090/api/health',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('does not start overlapping health checks while a previous probe is still pending', async () => {
      const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck();
      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('aborts a stuck health check probe', async () => {
      let signal: AbortSignal | undefined;
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck();
      await vi.advanceTimersByTimeAsync(0);

      expect(signal).toBeDefined();
      expect(signal?.aborted).toBe(false);

      await vi.advanceTimersByTimeAsync(10_000);

      expect(signal?.aborted).toBe(true);
    });

    it('aborts an in-flight probe when stopping health checks', async () => {
      let signal: AbortSignal | undefined;
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck();
      await vi.advanceTimersByTimeAsync(0);

      expect(signal?.aborted).toBe(false);

      stopHealthCheck();

      expect(signal?.aborted).toBe(true);
    });

    it('sets state to offline when health check fetch fails', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);
      expect(getConnectionState()).toBe('online');

      const fetchMock = vi.fn().mockRejectedValue(new Error('net error'));
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck();
      await vi.advanceTimersByTimeAsync(0);

      expect(getConnectionState()).toBe('offline');
    });

    it('sets state to offline when health check returns non-ok response', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);
      expect(getConnectionState()).toBe('online');

      const fetchMock = vi.fn().mockResolvedValue({ ok: false });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck();
      await vi.advanceTimersByTimeAsync(0);

      expect(getConnectionState()).toBe('offline');
    });

    it('refreshes through main when coming back online with invalid auth', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);
      expect(getConnectionState()).toBe('online');

      // Simulate going offline — the immediate probe fails
      const fetchMock = vi.fn().mockRejectedValueOnce(new Error('net'));
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck();
      await vi.advanceTimersByTimeAsync(0);
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
    });

    it('refreshes through main when health is OK but online auth has expired', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);
      mockAuthStore.isValid = false;

      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
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

      startHealthCheck();
      await vi.advanceTimersByTimeAsync(0);

      expect(getConnectionState()).toBe('online');
      expect(refreshPbConnection).toHaveBeenCalledTimes(1);
      expect(mockAuthSave).toHaveBeenCalledWith(refreshedAuth.token, refreshedAuth.record);

      mockAuthStore.isValid = true;
    });

    it('does not reconnect when auth is invalid and main refresh fails', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);

      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('net'))
        .mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck();
      // Go offline — the immediate probe fails
      await vi.advanceTimersByTimeAsync(0);

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
    });

    it('sets state to online when coming back with valid auth (no re-auth needed)', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);

      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('net'))
        .mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck();
      // Go offline — the immediate probe fails
      await vi.advanceTimersByTimeAsync(0);
      expect(getConnectionState()).toBe('offline');

      // Auth still valid, health OK => should go online
      mockAuthStore.isValid = true;
      await vi.advanceTimersByTimeAsync(5000);

      expect(getConnectionState()).toBe('online');
    });

    it('logs warning when main refresh fails on reconnect', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);

      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('net'))
        .mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck();
      await vi.advanceTimersByTimeAsync(0);
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
    });

    it('stopHealthCheck stops further probes', async () => {
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);

      startHealthCheck();
      await vi.advanceTimersByTimeAsync(0);
      const callsAfterStart = fetchMock.mock.calls.length;

      stopHealthCheck();
      await vi.advanceTimersByTimeAsync(60_000);

      // No further probes after the health check was stopped
      expect(fetchMock.mock.calls.length).toBe(callsAfterStart);
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

      startHealthCheck();
      await vi.advanceTimersByTimeAsync(0);

      // State was 'connecting', catch block only sets offline if currently 'online'
      // so the listener should NOT have been called with 'offline'
      expect(listener).not.toHaveBeenCalledWith('offline');
    });
  });

  // -------------------------------------------------------------------------
  // adaptive health check cadence
  // -------------------------------------------------------------------------
  describe('adaptive health check cadence', () => {
    it('probes immediately when the health check starts', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchSpy);
      initPocketBase('http://localhost:8090');
      loadAuthSession({ token: 't', record: null }); // starts health check
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchSpy).toHaveBeenCalledWith('http://localhost:8090/api/health', expect.anything());
    });

    it('polls every 5s while offline and 30s while online', async () => {
      const fetchSpy = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
      vi.stubGlobal('fetch', fetchSpy);
      initPocketBase('http://localhost:8090');
      loadAuthSession({ token: 't', record: null });
      await vi.advanceTimersByTimeAsync(0); // immediate probe fails → offline
      const callsAfterFirst = fetchSpy.mock.calls.length;

      await vi.advanceTimersByTimeAsync(5_000); // degraded cadence
      expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst + 1);

      fetchSpy.mockResolvedValue({ ok: true }); // server back
      await vi.advanceTimersByTimeAsync(5_000);
      expect(getConnectionState()).toBe('online');

      const callsWhenOnline = fetchSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5_000); // online cadence is 30s — nothing yet
      expect(fetchSpy.mock.calls.length).toBe(callsWhenOnline);
      await vi.advanceTimersByTimeAsync(25_000);
      expect(fetchSpy.mock.calls.length).toBe(callsWhenOnline + 1);
    });

    it('probes immediately on a window online event', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchSpy);
      initPocketBase('http://localhost:8090');
      loadAuthSession({ token: 't', record: null });
      await vi.advanceTimersByTimeAsync(0);
      const before = fetchSpy.mock.calls.length;
      globalThis.window.dispatchEvent(new Event('online'));
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchSpy.mock.calls.length).toBe(before + 1);
    });

    it('probes immediately on a window offline event', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchSpy);
      initPocketBase('http://localhost:8090');
      loadAuthSession({ token: 't', record: null });
      await vi.advanceTimersByTimeAsync(0);
      const before = fetchSpy.mock.calls.length;
      globalThis.window.dispatchEvent(new Event('offline'));
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchSpy.mock.calls.length).toBe(before + 1);
    });
  });

  // -------------------------------------------------------------------------
  // auth-failed state
  // -------------------------------------------------------------------------
  describe('auth-failed state', () => {
    it('enters auth-failed state when refresh reports auth-failed', async () => {
      initPocketBase('http://localhost:8090');
      loadAuthSession({ token: 't', record: null });
      const refreshPbConnection = vi.fn().mockResolvedValue({
        ok: false,
        error: 'auth-failed',
      } satisfies PbConnectionResult);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;

      handleApiError({ status: 401 });
      await vi.advanceTimersByTimeAsync(0);

      expect(getConnectionState()).toBe('auth-failed');
    });

    it('stays offline (not auth-failed) when refresh reports pb-unavailable', async () => {
      initPocketBase('http://localhost:8090');
      loadAuthSession({ token: 't', record: null });
      const refreshPbConnection = vi.fn().mockResolvedValue({
        ok: false,
        error: 'pb-unavailable',
      } satisfies PbConnectionResult);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;

      handleApiError({ status: 401 });
      await vi.advanceTimersByTimeAsync(0);

      expect(getConnectionState()).toBe('offline');
    });

    it('uses the relaxed 30s cadence while auth-failed (no hot auth retry loop)', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchSpy);
      const refreshPbConnection = vi.fn().mockResolvedValue({
        ok: false,
        error: 'auth-failed',
      } satisfies PbConnectionResult);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;
      // Probe path: healthy fetch, invalid token → refresh → auth-failed, so
      // scheduleNextProbe fires while state is already 'auth-failed'.
      mockAuthStore.isValid = false;
      initPocketBase('http://localhost:8090');
      loadAuthSession({ token: 't', record: null });
      await vi.advanceTimersByTimeAsync(0); // immediate probe lands in auth-failed via applyRefreshFailure
      expect(getConnectionState()).toBe('auth-failed');

      // Token now looks locally valid again — out of auth-failed it must NOT
      // be trusted (the server already rejected it), so no flap to online.
      mockAuthStore.isValid = true;

      const callsAfter = fetchSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetchSpy.mock.calls.length).toBe(callsAfter); // NOT the 5s degraded cadence
      await vi.advanceTimersByTimeAsync(25_000);
      expect(fetchSpy.mock.calls.length).toBe(callsAfter + 1); // 30s cadence
      expect(getConnectionState()).toBe('auth-failed'); // no flap back to online
    });

    it('does not trust a rejected token after an offline detour', async () => {
      // 401 with locally-valid token → auth-failed
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchSpy);
      const refreshPbConnection = vi.fn().mockResolvedValue({
        ok: false,
        error: 'auth-failed',
      } satisfies PbConnectionResult);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;
      initPocketBase('http://localhost:8090');
      loadAuthSession({ token: 't', record: null });
      handleApiError({ status: 401 });
      await vi.advanceTimersByTimeAsync(0);
      expect(getConnectionState()).toBe('auth-failed');

      // server outage → offline
      fetchSpy.mockRejectedValue(new TypeError('fetch failed'));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getConnectionState()).toBe('offline');

      // server returns, passphrase still broken: must NOT go online off the stale token
      fetchSpy.mockResolvedValue({ ok: true });
      const refreshCallsBefore = refreshPbConnection.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5_000); // degraded cadence probe
      expect(getConnectionState()).toBe('auth-failed'); // re-derived via refresh, not laundered to online
      expect(refreshPbConnection.mock.calls.length).toBeGreaterThan(refreshCallsBefore);
    });

    it('demotes auth-failed to offline when the server becomes unreachable', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchSpy);
      const refreshPbConnection = vi.fn().mockResolvedValue({
        ok: false,
        error: 'auth-failed',
      } satisfies PbConnectionResult);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;
      mockAuthStore.isValid = false;
      initPocketBase('http://localhost:8090');
      loadAuthSession({ token: 't', record: null });
      await vi.advanceTimersByTimeAsync(0); // immediate probe lands in auth-failed
      expect(getConnectionState()).toBe('auth-failed');

      // Server outage: the diagnosis is now connectivity, not credentials.
      fetchSpy.mockRejectedValue(new Error('net down'));
      await vi.advanceTimersByTimeAsync(30_000); // next probe (30s cadence) fails
      expect(getConnectionState()).toBe('offline');

      // Offline resumes the 5s degraded cadence.
      const callsAfterOutage = fetchSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetchSpy.mock.calls.length).toBe(callsAfterOutage + 1);
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

    it('refreshes auth for unauthorized API errors', async () => {
      loadAuthSession({ token: 'token', record: { id: 'user-1' } }, true);
      const listener = vi.fn();
      onConnectionStateChange(listener);
      const refreshedAuth: PbAuthSession = {
        token: 'refreshed-token',
        record: { id: 'user-1' },
      };
      const refreshPbConnection = vi.fn().mockResolvedValue({
        ok: true,
        connection: {
          pbUrl: 'http://localhost:8090',
          auth: refreshedAuth,
        },
      } satisfies PbConnectionResult);
      globalThis.api = { refreshPbConnection } as typeof globalThis.api;

      handleApiError({ status: 401, message: 'unauthorized' });
      await Promise.resolve();

      expect(listener).toHaveBeenCalledWith('reconnecting');
      expect(refreshPbConnection).toHaveBeenCalledOnce();
      expect(mockAuthSave).toHaveBeenCalledWith(refreshedAuth.token, refreshedAuth.record);
      expect(getConnectionState()).toBe('online');
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
