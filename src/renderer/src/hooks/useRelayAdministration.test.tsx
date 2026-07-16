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
  operatorId: 'operator-admin',
  operatorName: 'Ryan Bledsoe',
  role: 'admin',
  capabilities: ['settings.manage', 'operators.manage'],
  deviceId: 'device-1',
  expiresAt: '2026-07-15T22:00:00.000Z',
};

const snapshot: RelayAdministrationSnapshot = {
  operators: [
    {
      id: 'operator-admin',
      displayName: 'Ryan Bledsoe',
      active: true,
      revision: 1,
      role: 'admin',
      created: '2026-07-15T18:00:00.000Z',
      updated: '2026-07-15T19:00:00.000Z',
    },
  ],
  privilegedAccounts: [],
  devices: [],
  settings: [],
  adminOperatorId: 'operator-admin',
  publisherOperatorId: null,
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
        command: 'operator.rename',
        payload: {
          operatorId: 'operator-admin',
          displayName: 'Ryan Bledsoe',
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
        command: 'operator.create',
        payload: { displayName: 'Morgan Lee' },
        expectedRevision: null,
      });
    });

    expect(response).toEqual({ ok: false, error: 'offline' });
    expect(submitCommand).toHaveBeenCalledTimes(1);
  });
});
