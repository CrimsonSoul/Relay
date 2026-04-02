import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PbAuthSession } from '@shared/ipc';

const mockInitPocketBase = vi.fn();
const mockLoadAuthSession = vi.fn();
const mockStopHealthCheck = vi.fn();
let capturedStateListener: ((state: string) => void) | null = null;
const mockUnsubscribe = vi.fn();

vi.mock('../../services/pocketbase', () => ({
  initPocketBase: (...args: unknown[]) => mockInitPocketBase(...args),
  loadAuthSession: (...args: unknown[]) => mockLoadAuthSession(...args),
  stopHealthCheck: (...args: unknown[]) => mockStopHealthCheck(...args),
  onConnectionStateChange: (listener: (state: string) => void) => {
    capturedStateListener = listener;
    return mockUnsubscribe;
  },
}));

import * as usePocketBaseModule from '../usePocketBase';
import { usePocketBase } from '../usePocketBase';

describe('usePocketBase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    capturedStateListener = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns connecting state initially', () => {
    const { result } = renderHook(() => usePocketBase(null, null));

    expect(result.current.connectionState).toBe('connecting');
  });

  it('does not export stale connection timeout helpers', () => {
    expect('CONNECTION_TIMEOUT_MS' in usePocketBaseModule).toBe(false);
  });

  it('does not init or hydrate when url is null', () => {
    const auth: PbAuthSession = { token: 'token', record: { id: 'user-1' } };

    renderHook(() => usePocketBase(null, auth));

    expect(mockInitPocketBase).not.toHaveBeenCalled();
    expect(mockLoadAuthSession).not.toHaveBeenCalled();
  });

  it('initializes when auth session is null', () => {
    renderHook(() => usePocketBase('http://localhost:8090', null));

    expect(mockInitPocketBase).toHaveBeenCalledWith('http://localhost:8090');
    expect(mockLoadAuthSession).not.toHaveBeenCalled();
  });

  it('calls initPocketBase and hydrates auth with the bootstrap payload', () => {
    const auth: PbAuthSession = { token: 'token-123', record: { id: 'user-1' } };

    renderHook(() => usePocketBase('http://localhost:8090', auth));

    expect(mockInitPocketBase).toHaveBeenCalledWith('http://localhost:8090');
    expect(mockLoadAuthSession).toHaveBeenCalledWith(auth);
  });

  it('subscribes to connection state changes', () => {
    const auth: PbAuthSession = { token: 'token', record: { id: 'user-1' } };

    renderHook(() => usePocketBase('http://localhost:8090', auth));

    expect(capturedStateListener).toBeTruthy();
  });

  it('updates connectionState when listener fires', () => {
    const auth: PbAuthSession = { token: 'token', record: { id: 'user-1' } };
    const { result } = renderHook(() => usePocketBase('http://localhost:8090', auth));

    act(() => {
      capturedStateListener?.('online');
    });

    expect(result.current.connectionState).toBe('online');
  });

  it('calls unsubscribe and stopHealthCheck on unmount', () => {
    const auth: PbAuthSession = { token: 'token', record: { id: 'user-1' } };
    const { unmount } = renderHook(() => usePocketBase('http://localhost:8090', auth));

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockStopHealthCheck).toHaveBeenCalled();
  });

  it('does not call cleanup when url/auth are null (no effect ran)', () => {
    const { unmount } = renderHook(() => usePocketBase(null, null));

    unmount();

    expect(mockUnsubscribe).not.toHaveBeenCalled();
    expect(mockStopHealthCheck).not.toHaveBeenCalled();
  });

  it('re-initializes when url changes', () => {
    const auth: PbAuthSession = { token: 'token', record: { id: 'user-1' } };
    const { rerender } = renderHook(
      ({ url, currentAuth }: { url: string; currentAuth: PbAuthSession }) =>
        usePocketBase(url, currentAuth),
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      { initialProps: { url: 'http://host1:8090', currentAuth: auth } },
    );

    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    expect(mockInitPocketBase).toHaveBeenCalledWith('http://host1:8090');

    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    rerender({ url: 'http://host2:8090', currentAuth: auth });

    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    expect(mockInitPocketBase).toHaveBeenCalledWith('http://host2:8090');
    expect(mockUnsubscribe).toHaveBeenCalled();
    expect(mockStopHealthCheck).toHaveBeenCalled();
  });

  it('resets local connection state to connecting when reinitialized', () => {
    const firstAuth: PbAuthSession = { token: 'first', record: { id: 'user-1' } };
    const secondAuth: PbAuthSession = { token: 'second', record: { id: 'user-1' } };
    const { result, rerender } = renderHook(
      ({ url, auth }: { url: string; auth: PbAuthSession }) => usePocketBase(url, auth),
      {
        initialProps: {
          url: 'http://localhost:8090',
          auth: firstAuth,
        },
      },
    );

    act(() => {
      capturedStateListener?.('online');
    });

    expect(result.current.connectionState).toBe('online');

    rerender({ url: 'http://localhost:8091', auth: secondAuth });

    expect(result.current.connectionState).toBe('connecting');
  });

  it('resets local connection state when url becomes null', () => {
    const auth: PbAuthSession = { token: 'token', record: { id: 'user-1' } };
    const { result, rerender } = renderHook(
      ({ url, currentAuth }: { url: string | null; currentAuth: PbAuthSession | null }) =>
        usePocketBase(url, currentAuth),
      {
        initialProps: {
          url: 'http://localhost:8090',
          currentAuth: auth,
        },
      },
    );

    act(() => {
      capturedStateListener?.('online');
    });

    expect(result.current.connectionState).toBe('online');

    rerender({ url: null, currentAuth: null });

    expect(result.current.connectionState).toBe('connecting');
  });

  it('rehydrates when bootstrap auth changes', () => {
    const { rerender } = renderHook(
      ({ url, auth }: { url: string; auth: PbAuthSession }) => usePocketBase(url, auth),
      {
        initialProps: {
          url: 'http://localhost:8090',
          auth: { token: 'first', record: { id: 'user-1' } },
        },
      },
    );

    expect(mockLoadAuthSession).toHaveBeenCalledWith({
      token: 'first',
      record: { id: 'user-1' },
    });

    rerender({
      url: 'http://localhost:8090',
      auth: { token: 'second', record: { id: 'user-1' } },
    });

    expect(mockLoadAuthSession).toHaveBeenCalledWith({
      token: 'second',
      record: { id: 'user-1' },
    });
  });

  it('does not reinitialize or tear down when only auth changes', () => {
    const { rerender } = renderHook(
      ({ url, auth }: { url: string; auth: PbAuthSession }) => usePocketBase(url, auth),
      {
        initialProps: {
          url: 'http://localhost:8090',
          auth: { token: 'first', record: { id: 'user-1' } },
        },
      },
    );

    expect(mockInitPocketBase).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).not.toHaveBeenCalled();
    expect(mockStopHealthCheck).not.toHaveBeenCalled();

    rerender({
      url: 'http://localhost:8090',
      auth: { token: 'second', record: { id: 'user-1' } },
    });

    expect(mockInitPocketBase).toHaveBeenCalledTimes(1);
    expect(mockUnsubscribe).not.toHaveBeenCalled();
    expect(mockStopHealthCheck).not.toHaveBeenCalled();
    expect(mockLoadAuthSession).toHaveBeenLastCalledWith({
      token: 'second',
      record: { id: 'user-1' },
    });
  });
});
