import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';

import { PrivilegedAccessProvider, usePrivilegedAccess } from './PrivilegedAccessContext';

const signedOut: PrivilegedSessionView = {
  state: 'signed-out',
  accountId: null,
  username: null,
  displayName: null,
  role: null,
  capabilities: [],
  deviceId: null,
  expiresAt: null,
};

const active: PrivilegedSessionView = {
  state: 'active',
  accountId: 'account-1',
  username: 'ryan',
  displayName: 'Ryan Bledsoe',
  role: 'owner',
  capabilities: ['privileged.status.read', 'accounts.manage'],
  deviceId: 'device-1',
  expiresAt: null,
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
    api = {
      getPrivilegedSession: vi.fn().mockResolvedValue(signedOut),
      loginPrivileged: vi.fn().mockResolvedValue({ ok: true, value: active }),
      logoutPrivileged: vi.fn().mockResolvedValue(signedOut),
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
    expect('lock' in result.current).toBe(false);
  });

  it('authenticates with username and password without reading operator selection', async () => {
    const { result } = renderHook(() => usePrivilegedAccess(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.login('Ryan', 'a-long-private-password'));

    expect(api.loginPrivileged).toHaveBeenCalledWith({
      username: 'Ryan',
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate fake credential asserts context-to-bridge payload fidelity.
      password: 'a-long-private-password',
    });
    expect(result.current.session).toEqual(active);
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
