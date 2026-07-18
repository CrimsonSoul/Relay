import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivilegedSessionView, RelayAdministrationSnapshot } from '@shared/privilegedAccess';

const { mockUsePrivilegedAccess } = vi.hoisted(() => ({
  mockUsePrivilegedAccess: vi.fn(),
}));

vi.mock('../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: mockUsePrivilegedAccess,
}));

import { useRelayAdministration } from './useRelayAdministration';

const activeSession: PrivilegedSessionView = {
  state: 'active',
  accountId: 'account-admin',
  username: 'charles',
  displayName: 'Charles Gibbs',
  role: 'admin',
  capabilities: ['settings.manage', 'publisher.assign'],
  deviceId: 'device-1',
  expiresAt: '2026-07-15T22:00:00.000Z',
};

const snapshot: RelayAdministrationSnapshot = {
  accounts: [
    {
      accountId: 'account-owner',
      username: 'ryan',
      displayName: 'Ryan Bledsoe',
      storedRole: 'administrator',
      effectiveRole: 'owner',
      active: true,
      credentialState: 'configured',
      mustChangePassword: false,
      credentialVersion: 1,
      revision: 1,
      createdAt: '2026-07-15T18:00:00.000Z',
      updatedAt: '2026-07-15T19:00:00.000Z',
    },
    {
      accountId: 'account-admin',
      username: 'charles',
      displayName: 'Charles Gibbs',
      storedRole: 'administrator',
      effectiveRole: 'admin',
      active: true,
      credentialState: 'configured',
      mustChangePassword: false,
      credentialVersion: 1,
      revision: 1,
      createdAt: '2026-07-15T18:00:00.000Z',
      updatedAt: '2026-07-15T19:00:00.000Z',
    },
  ],
  devices: [],
  settings: [],
  ownerAccountId: 'account-owner',
  publisherAccountId: null,
  assignmentRevision: 1,
  generatedAt: '2026-07-15T20:00:00.000Z',
};

describe('useRelayAdministration', () => {
  const submitCommand = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    submitCommand.mockResolvedValue({ ok: true, requestId: 'request-snapshot', value: snapshot });
    mockUsePrivilegedAccess.mockReturnValue({
      session: activeSession,
      submitCommand,
    });
  });

  it('loads and normalizes the signed administration snapshot for an administrator', async () => {
    const { result } = renderHook(() => useRelayAdministration());

    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));
    expect(submitCommand).toHaveBeenCalledWith({
      command: 'administration.snapshot.read',
      payload: {},
      expectedRevision: null,
    });
  });

  it('refreshes the snapshot once after a revision conflict', async () => {
    submitCommand
      .mockResolvedValueOnce({ ok: true, requestId: 'request-snapshot', value: snapshot })
      .mockResolvedValueOnce({
        ok: false,
        requestId: 'request-mutation',
        error: 'conflict',
        currentRevision: 4,
        refresh: true,
      })
      .mockResolvedValueOnce({
        ok: true,
        requestId: 'request-refresh',
        value: { ...snapshot, assignmentRevision: 4 },
      });
    const { result } = renderHook(() => useRelayAdministration());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    await act(async () => {
      await result.current.execute({
        command: 'account.display-name.update',
        payload: {
          accountId: 'account-admin',
          displayName: 'Charles Gibbs',
          expectedRevision: 1,
        },
        expectedRevision: null,
      });
    });

    expect(submitCommand).toHaveBeenCalledTimes(3);
    expect(result.current.snapshot?.assignmentRevision).toBe(4);
    expect(result.current.error).toContain('changed');
  });

  it('rejects management offline and clears privileged data when the session locks', async () => {
    const { result, rerender } = renderHook(() => useRelayAdministration());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    mockUsePrivilegedAccess.mockReturnValue({
      session: { ...activeSession, state: 'offline' },
      submitCommand,
    });
    rerender();
    await waitFor(() => expect(result.current.snapshot).toBeNull());

    let response: Awaited<ReturnType<typeof result.current.execute>> | undefined;
    await act(async () => {
      response = await result.current.execute({
        command: 'account.publisher.create',
        payload: { username: 'morgan', displayName: 'Morgan Lee', expectedStateRevision: 1 },
        expectedRevision: null,
      });
    });

    expect(response).toEqual({ ok: false, error: 'offline' });
    expect(submitCommand).toHaveBeenCalledTimes(1);
  });

  it('loads administration for the Owner and rejects a Publisher session', async () => {
    mockUsePrivilegedAccess.mockReturnValue({
      session: { ...activeSession, accountId: 'account-owner', role: 'owner' },
      submitCommand,
    });
    const { result, rerender } = renderHook(() => useRelayAdministration());
    await waitFor(() => expect(result.current.snapshot).toEqual(snapshot));

    mockUsePrivilegedAccess.mockReturnValue({
      session: { ...activeSession, accountId: 'account-publisher', role: 'publisher' },
      submitCommand,
    });
    rerender();

    await waitFor(() => expect(result.current.snapshot).toBeNull());
    expect(result.current.canAdminister).toBe(false);
  });
});
