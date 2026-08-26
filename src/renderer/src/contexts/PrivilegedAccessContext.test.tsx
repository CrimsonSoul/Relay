import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BridgeAPI } from '@shared/ipc';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';

import { PrivilegedAccessProvider, usePrivilegedAccess } from './PrivilegedAccessContext';
import { usePrivilegedCommands } from './PrivilegedCommandContext';

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

const otherActive: PrivilegedSessionView = {
  ...active,
  accountId: 'account-2',
  username: 'paris',
  displayName: 'Paris',
  deviceId: 'device-2',
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <PrivilegedAccessProvider>{children}</PrivilegedAccessProvider>
);

describe('PrivilegedAccessProvider', () => {
  let eventListener: ((view: PrivilegedSessionView) => void) | null;
  let unsubscribe: Mock<() => void>;
  let api: Partial<BridgeAPI>;

  beforeEach(() => {
    vi.clearAllMocks();
    eventListener = null;
    unsubscribe = vi.fn<() => void>();
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

  it('moves protected command progress and failures out of authentication state', async () => {
    let resolveCommand!: (value: { ok: false; error: 'server-error' }) => void;
    api.submitPrivilegedCommand = vi.fn(
      () =>
        new Promise<{ ok: false; error: 'server-error' }>((resolve) => {
          resolveCommand = resolve;
        }),
    );
    const { result } = renderHook(
      () => ({ access: usePrivilegedAccess(), commands: usePrivilegedCommands() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.access.loading).toBe(false));

    let command!: ReturnType<typeof result.current.commands.submitCommand>;
    act(() => {
      command = result.current.commands.submitCommand({
        command: 'administration.snapshot.read',
        payload: {},
        expectedRevision: null,
      });
    });

    expect(result.current.access.busy).toBeNull();
    expect(result.current.access.error).toBeNull();
    expect(result.current.commands.busy).toBe(true);
    expect(result.current.commands.error).toBeNull();

    await act(async () => {
      resolveCommand({ ok: false, error: 'server-error' });
      await expect(command).resolves.toEqual({ ok: false, error: 'server-error' });
    });
    expect(result.current.access.busy).toBeNull();
    expect(result.current.access.error).toBeNull();
    expect(result.current.commands.busy).toBe(false);
    expect(result.current.commands.error).toBe('Privileged access could not be completed.');
  });

  it('keeps command progress active until every concurrent operation settles', async () => {
    const resolvers: Array<(value: { ok: true; requestId: string; value: null }) => void> = [];
    api.submitPrivilegedCommand = vi.fn(
      () =>
        new Promise<{ ok: true; requestId: string; value: null }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    const { result } = renderHook(
      () => ({ access: usePrivilegedAccess(), commands: usePrivilegedCommands() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.access.loading).toBe(false));

    let first!: ReturnType<typeof result.current.commands.submitCommand>;
    let second!: ReturnType<typeof result.current.commands.submitCommand>;
    act(() => {
      first = result.current.commands.submitCommand({
        command: 'administration.snapshot.read',
        payload: {},
        expectedRevision: null,
      });
      second = result.current.commands.submitCommand({
        command: 'administration.snapshot.read',
        payload: {},
        expectedRevision: null,
      });
    });
    expect(result.current.commands.busy).toBe(true);

    await act(async () => {
      resolvers[0]?.({ ok: true, requestId: 'command-1', value: null });
      await first;
    });
    expect(result.current.commands.busy).toBe(true);

    await act(async () => {
      resolvers[1]?.({ ok: true, requestId: 'command-2', value: null });
      await second;
    });
    expect(result.current.commands.busy).toBe(false);
  });

  it('clears command progress when the privileged session changes', async () => {
    let resolveCommand!: (value: { ok: true; requestId: string; value: null }) => void;
    api.getPrivilegedSession = vi.fn().mockResolvedValue(active);
    api.submitPrivilegedCommand = vi.fn(
      () =>
        new Promise<{ ok: true; requestId: string; value: null }>((resolve) => {
          resolveCommand = resolve;
        }),
    );
    const { result } = renderHook(
      () => ({ access: usePrivilegedAccess(), commands: usePrivilegedCommands() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.access.session).toEqual(active));

    let command!: ReturnType<typeof result.current.commands.submitCommand>;
    act(() => {
      command = result.current.commands.submitCommand({
        command: 'administration.snapshot.read',
        payload: {},
        expectedRevision: null,
      });
    });
    expect(result.current.commands.busy).toBe(true);

    act(() => eventListener?.(otherActive));

    expect(result.current.access.session).toEqual(otherActive);
    expect(result.current.commands.busy).toBe(false);

    await act(async () => {
      resolveCommand({ ok: true, requestId: 'account-1-command', value: null });
      await command;
    });
  });

  it('ignores a late command failure from a previous privileged session', async () => {
    let resolveCommand!: (value: { ok: false; error: 'server-error' }) => void;
    api.getPrivilegedSession = vi.fn().mockResolvedValue(active);
    api.submitPrivilegedCommand = vi.fn(
      () =>
        new Promise<{ ok: false; error: 'server-error' }>((resolve) => {
          resolveCommand = resolve;
        }),
    );
    const { result } = renderHook(
      () => ({ access: usePrivilegedAccess(), commands: usePrivilegedCommands() }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.access.session).toEqual(active));

    let command!: ReturnType<typeof result.current.commands.submitCommand>;
    act(() => {
      command = result.current.commands.submitCommand({
        command: 'administration.snapshot.read',
        payload: {},
        expectedRevision: null,
      });
    });
    act(() => eventListener?.(otherActive));

    await act(async () => {
      resolveCommand({ ok: false, error: 'server-error' });
      await command;
    });

    expect(result.current.commands.error).toBeNull();
  });

  it('unsubscribes from public session events on unmount', async () => {
    const { result, unmount } = renderHook(() => usePrivilegedAccess(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
