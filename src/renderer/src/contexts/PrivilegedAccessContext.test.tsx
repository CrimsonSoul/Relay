import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';

const { mockUseOperator } = vi.hoisted(() => ({
  mockUseOperator: vi.fn(),
}));

vi.mock('./OperatorContext', () => ({
  useOperator: mockUseOperator,
}));

import { PrivilegedAccessProvider, usePrivilegedAccess } from './PrivilegedAccessContext';

const signedOut: PrivilegedSessionView = {
  state: 'signed-out',
  accountId: null,
  operatorId: null,
  operatorName: null,
  role: null,
  capabilities: [],
  deviceId: null,
  expiresAt: null,
};

const active: PrivilegedSessionView = {
  state: 'active',
  accountId: 'account-1',
  operatorId: 'operator-1',
  operatorName: 'Ryan Bledsoe',
  role: 'admin',
  capabilities: ['privileged.status.read', 'operators.manage'],
  deviceId: 'device-1',
  expiresAt: '2026-07-15T20:15:00.000Z',
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PrivilegedAccessProvider>{children}</PrivilegedAccessProvider>
);

describe('PrivilegedAccessProvider', () => {
  let eventListener: ((view: PrivilegedSessionView) => void) | null;
  let unsubscribe: ReturnType<typeof vi.fn>;
  let api: Partial<BridgeAPI>;

  beforeEach(() => {
    vi.clearAllMocks();
    eventListener = null;
    unsubscribe = vi.fn();
    mockUseOperator.mockReturnValue({
      selectedOperator: { id: 'operator-1', displayName: 'Ryan Bledsoe', active: true },
      loading: false,
      setPickerOpen: vi.fn(),
    });
    api = {
      getPrivilegedSession: vi.fn().mockResolvedValue(signedOut),
      loginPrivileged: vi.fn().mockResolvedValue({ ok: true, value: active }),
      logoutPrivileged: vi.fn().mockResolvedValue(signedOut),
      lockPrivileged: vi.fn().mockResolvedValue({ ...active, state: 'locked' }),
      createPrivilegedPairingChallenge: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          challengeId: 'challenge-1',
          accountId: 'account-publisher',
          code: 'ABCD2345',
          expiresAt: '2026-07-15T20:10:00.000Z',
        },
      }),
      onPrivilegedSessionChanged: vi.fn((listener) => {
        eventListener = listener;
        return unsubscribe;
      }),
    };
    globalThis.api = api as BridgeAPI;
  });

  it('loads the public session and follows public session events', async () => {
    const { result } = renderHook(() => usePrivilegedAccess(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toEqual(signedOut);

    act(() => eventListener?.(active));
    expect(result.current.session).toEqual(active);
  });

  it('authenticates only the selected operator and never accepts an operator from the caller', async () => {
    const { result } = renderHook(() => usePrivilegedAccess(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.login('a-long-private-password'));

    expect(api.loginPrivileged).toHaveBeenCalledWith({
      operatorId: 'operator-1',
      password: 'a-long-private-password',
    });
    expect(result.current.session).toEqual(active);
  });

  it('opens the operator picker instead of attempting login without attribution', async () => {
    const setPickerOpen = vi.fn();
    mockUseOperator.mockReturnValue({ selectedOperator: null, loading: false, setPickerOpen });
    const { result } = renderHook(() => usePrivilegedAccess(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    let succeeded = true;
    await act(async () => {
      succeeded = await result.current.login('a-long-private-password');
    });

    expect(succeeded).toBe(false);
    expect(setPickerOpen).toHaveBeenCalledWith(true);
    expect(api.loginPrivileged).not.toHaveBeenCalled();
  });

  it('locks an active session when workstation attribution changes', async () => {
    api.getPrivilegedSession = vi.fn().mockResolvedValue(active);
    mockUseOperator.mockReturnValue({
      selectedOperator: { id: 'operator-2', displayName: 'Tristan Bowles', active: true },
      loading: false,
      setPickerOpen: vi.fn(),
    });

    const { result } = renderHook(() => usePrivilegedAccess(), { wrapper });

    await waitFor(() => expect(api.lockPrivileged).toHaveBeenCalledTimes(1));
    expect(result.current.session.state).toBe('locked');
  });

  it('forwards the selected privileged account when creating a pairing challenge', async () => {
    const { result } = renderHook(() => usePrivilegedAccess(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.createPairingChallenge('account-publisher'));

    expect(api.createPrivilegedPairingChallenge).toHaveBeenCalledWith('account-publisher');
    expect(result.current.pairingChallenge).toMatchObject({ accountId: 'account-publisher' });
  });

  it('unsubscribes from public session events on unmount', async () => {
    const { result, unmount } = renderHook(() => usePrivilegedAccess(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
