import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicRelayConfig } from '@shared/ipc';
import {
  CLIENT_PRESENCE_SESSION_STORAGE_KEY,
  CLIENT_PRESENCE_TTL_MS,
  useClientPresence,
} from '../useClientPresence';

type PresenceRecord = {
  id: string;
  sessionId: string;
  hostname: string;
  mode: 'client';
  lastSeen: string;
  created: string;
  updated: string;
};

const mockGetFullList = vi.fn();
const mockGetFirstListItem = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockHandleApiError = vi.fn();
let realtimeCallback: ((event: { action: string; record: PresenceRecord }) => void) | null = null;

vi.mock('../../services/pocketbase', () => ({
  getPb: () => ({
    collection: () => ({
      getFullList: mockGetFullList,
      getFirstListItem: mockGetFirstListItem,
      create: mockCreate,
      update: mockUpdate,
      subscribe: mockSubscribe,
    }),
  }),
  isOnline: vi.fn(() => true),
  onConnectionStateChange: vi.fn((_callback: (state: string) => void) => {
    return () => undefined;
  }),
  onPocketBaseClientChange: vi.fn((_callback: () => void) => {
    return () => undefined;
  }),
  handleApiError: (...args: unknown[]) => mockHandleApiError(...args),
}));

const serverConfig: PublicRelayConfig = {
  mode: 'server',
  port: 8090,
  bindHost: '0.0.0.0',
};

const clientConfig: PublicRelayConfig = {
  mode: 'client',
  serverUrl: ['http', '://relay.local:8090'].join(''),
};

function makePresence(id: string, sessionId: string, hostname: string, ageMs = 0): PresenceRecord {
  const timestamp = new Date(Date.now() - ageMs).toISOString();
  return {
    id,
    sessionId,
    hostname,
    mode: 'client',
    lastSeen: timestamp,
    created: timestamp,
    updated: timestamp,
  };
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  sessionStorage.clear();
  realtimeCallback = null;
  mockGetFullList.mockResolvedValue([]);
  mockGetFirstListItem.mockRejectedValue({ status: 404 });
  mockCreate.mockImplementation(async (payload: Record<string, unknown>) =>
    makePresence('created-presence', String(payload.sessionId), String(payload.hostname)),
  );
  mockUpdate.mockImplementation(async (id: string, payload: Record<string, unknown>) =>
    makePresence(id, String(payload.sessionId ?? 'session'), String(payload.hostname ?? 'host')),
  );
  mockSubscribe.mockImplementation(
    async (
      _topic: string,
      callback: (event: { action: string; record: PresenceRecord }) => void,
    ) => {
      realtimeCallback = callback;
      return mockUnsubscribe;
    },
  );
  globalThis.api = {
    getClientHostname: vi.fn().mockResolvedValue('ops-laptop'),
  } as typeof globalThis.api;
});

describe('useClientPresence', () => {
  it('does not heartbeat from the server app', async () => {
    const { result } = renderHook(() => useClientPresence(serverConfig, vi.fn()));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockGetFullList).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.current.count).toBe(0);
  });

  it('heartbeats only when the app is configured as a client', async () => {
    renderHook(() => useClientPresence(clientConfig, vi.fn()));

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());

    expect(globalThis.api?.getClientHostname).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'ops-laptop',
        mode: 'client',
        lastSeen: expect.any(String),
      }),
    );
    expect(mockCreate.mock.calls[0]?.[0]).toHaveProperty('sessionId');
  });

  it('filters stale client records out of the visible count', async () => {
    mockGetFullList.mockResolvedValue([
      makePresence('fresh', 'fresh-session', 'ops-laptop'),
      makePresence('stale', 'stale-session', 'old-kiosk', CLIENT_PRESENCE_TTL_MS + 1),
    ]);

    const { result } = renderHook(() => useClientPresence(serverConfig, vi.fn()));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.count).toBe(1);
    expect(result.current.hostnames).toEqual(['ops-laptop']);
  });

  it('toasts when a new client connects after the initial snapshot', async () => {
    const onClientConnected = vi.fn();
    mockGetFullList.mockResolvedValue([makePresence('existing', 'session-1', 'ops-laptop')]);

    renderHook(() => useClientPresence(serverConfig, onClientConnected));

    await waitFor(() => expect(realtimeCallback).not.toBeNull());
    expect(onClientConnected).not.toHaveBeenCalled();

    act(() => {
      realtimeCallback?.({
        action: 'create',
        record: makePresence('new', 'session-2', 'war-room-mac'),
      });
    });

    await waitFor(() => expect(onClientConnected).toHaveBeenCalledWith('war-room-mac'));
  });

  it('does not toast for this client app heartbeat', async () => {
    const onClientConnected = vi.fn();
    sessionStorage.setItem(CLIENT_PRESENCE_SESSION_STORAGE_KEY, 'self-session');

    renderHook(() => useClientPresence(clientConfig, onClientConnected));

    await waitFor(() => expect(realtimeCallback).not.toBeNull());

    act(() => {
      realtimeCallback?.({
        action: 'create',
        record: makePresence('self', 'self-session', 'ops-laptop'),
      });
    });

    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    expect(onClientConnected).not.toHaveBeenCalled();
  });
});
