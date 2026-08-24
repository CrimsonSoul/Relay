import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import { WEB_RUNTIME } from '@shared/runtime';

const { mockUsePrivilegedAccess, mockUsePrivilegedCommands, mockUseRelayAdministration } =
  vi.hoisted(() => ({
    mockUsePrivilegedAccess: vi.fn(),
    mockUsePrivilegedCommands: vi.fn(),
    mockUseRelayAdministration: vi.fn(),
  }));

vi.mock('../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: mockUsePrivilegedAccess,
}));
vi.mock('../../contexts/PrivilegedCommandContext', () => ({
  usePrivilegedCommands: mockUsePrivilegedCommands,
}));
vi.mock('../../hooks/useRelayAdministration', () => ({
  useRelayAdministration: mockUseRelayAdministration,
}));

import { PrivilegedAccessPanel } from './PrivilegedAccessPanel';

const session = (
  state: PrivilegedSessionView['state'],
  role: PrivilegedSessionView['role'] = null,
): PrivilegedSessionView => ({
  state,
  accountId: state === 'active' ? 'account-ryan' : null,
  username: state === 'active' ? 'ryan' : null,
  displayName: state === 'active' ? 'Ryan Bledsoe' : null,
  role: state === 'active' ? role : null,
  capabilities: state === 'active' ? ['privileged.status.read'] : [],
  deviceId: state === 'active' ? 'device-1' : null,
  expiresAt: null,
});

describe('PrivilegedAccessPanel', () => {
  const login = vi.fn().mockResolvedValue(true);
  const completePairing = vi.fn().mockResolvedValue(true);
  const createPairingChallenge = vi.fn().mockResolvedValue(null);
  const clearError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePrivilegedCommands.mockReturnValue({
      busy: false,
      error: null,
      clearError: vi.fn(),
      submitCommand: vi.fn(),
    });
    mockUseRelayAdministration.mockReturnValue({
      snapshot: {
        accounts: [
          {
            accountId: 'account-ryan',
            username: 'ryan',
            displayName: 'Ryan Bledsoe',
            storedRole: 'administrator',
            effectiveRole: 'owner',
            active: true,
          },
          {
            accountId: 'account-charles',
            username: 'charles',
            displayName: 'Charles Gibbs',
            storedRole: 'administrator',
            effectiveRole: 'admin',
            active: true,
          },
          {
            accountId: 'account-publisher',
            username: 'publisher',
            displayName: 'Tristan Bowles',
            storedRole: 'publisher',
            effectiveRole: 'publisher',
            active: true,
          },
        ],
      },
      loading: false,
    });
    mockUsePrivilegedAccess.mockReturnValue({
      session: session('signed-out'),
      loading: false,
      busy: null,
      error: null,
      login,
      logout: vi.fn(),
      createPairingChallenge,
      completePairing,
      pairingChallenge: null,
      clearError,
    });
  });

  it('signs in with username and password, clears the password, and returns focus', async () => {
    render(<PrivilegedAccessPanel relayMode="server" />);
    const username = screen.getByLabelText('Username');
    const password = screen.getByLabelText('Password') as HTMLInputElement;

    expect(username).toHaveClass('tactile-input');
    expect(password).toHaveClass('tactile-input');

    fireEvent.change(username, { target: { value: 'ryan' } });
    fireEvent.change(password, { target: { value: 'a-long-private-password' } });
    fireEvent.submit(password.closest('form')!);

    await waitFor(() => expect(login).toHaveBeenCalledWith('ryan', 'a-long-private-password'));
    expect(password.value).toBe('');
    expect(password).toHaveFocus();
    expect(screen.queryByText(/operator profile/i)).toBeNull();
  });

  it('preserves the login username after an active session signs out', () => {
    const access = mockUsePrivilegedAccess();
    const { rerender } = render(<PrivilegedAccessPanel relayMode="server" />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'ryan' } });

    mockUsePrivilegedAccess.mockReturnValue({
      ...access,
      session: session('active', 'owner'),
    });
    rerender(<PrivilegedAccessPanel relayMode="server" />);
    expect(screen.queryByLabelText('Username')).toBeNull();

    mockUsePrivilegedAccess.mockReturnValue({
      ...access,
      session: session('signed-out'),
    });
    rerender(<PrivilegedAccessPanel relayMode="server" />);

    expect(screen.getByLabelText('Username')).toHaveValue('ryan');
  });

  it('shows paired-device guidance and submits the one-time challenge', async () => {
    mockUsePrivilegedAccess.mockReturnValue({
      ...mockUsePrivilegedAccess(),
      session: session('pairing-required'),
    });
    render(<PrivilegedAccessPanel relayMode="server" />);

    fireEvent.change(screen.getByLabelText('Pairing challenge ID'), {
      target: { value: 'challenge-1' },
    });
    fireEvent.change(screen.getByLabelText('One-time pairing code'), {
      target: { value: 'ABCD2345' },
    });
    fireEvent.change(screen.getByLabelText('Device label'), {
      target: { value: 'Ryan work laptop' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pair device' }));

    await waitFor(() =>
      expect(completePairing).toHaveBeenCalledWith({
        challengeId: 'challenge-1',
        code: 'ABCD2345',
        deviceLabel: 'Ryan work laptop',
      }),
    );
  });

  it.each([
    ['owner', 'Owner'],
    ['admin', 'Administrator'],
    ['publisher', 'Publisher'],
  ] as const)('labels an active %s session from its effective role', (role, label) => {
    mockUsePrivilegedAccess.mockReturnValue({
      ...mockUsePrivilegedAccess(),
      session: session('active', role),
    });
    render(<PrivilegedAccessPanel relayMode="server" />);

    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText('Ryan Bledsoe')).toBeVisible();
    expect(screen.getByText('@ryan')).toBeVisible();
    if (role === 'publisher') {
      expect(screen.queryByRole('button', { name: 'Create pairing code' })).toBeNull();
    }
  });

  it('keeps active access until sign out and does not offer Lock', () => {
    mockUsePrivilegedAccess.mockReturnValue({
      ...mockUsePrivilegedAccess(),
      session: session('active', 'owner'),
    });
    render(<PrivilegedAccessPanel relayMode="server" />);

    expect(screen.getByText('Active until you sign out')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Lock' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  it('creates a pairing challenge for active role accounts by account ID', async () => {
    mockUsePrivilegedAccess.mockReturnValue({
      ...mockUsePrivilegedAccess(),
      session: session('active', 'admin'),
    });
    render(<PrivilegedAccessPanel relayMode="server" />);

    expect(screen.getByRole('option', { name: 'Ryan Bledsoe — Owner' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Charles Gibbs — Administrator' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Tristan Bowles — Publisher' })).toBeVisible();
    fireEvent.change(screen.getByLabelText('Workstation owner'), {
      target: { value: 'account-publisher' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));

    await waitFor(() => expect(createPairingChallenge).toHaveBeenCalledWith('account-publisher'));
  });

  it('offers server-local first-owner credential setup by username without exposing account IDs', async () => {
    const setupInitialAdministratorCredential = vi.fn().mockResolvedValue({
      ok: true,
      value: { accountId: 'account-ryan', username: 'ryan' },
    });
    globalThis.api = { setupInitialAdministratorCredential } as never;
    render(<PrivilegedAccessPanel relayMode="server" />);

    fireEvent.click(screen.getByRole('button', { name: 'Set initial Owner password' }));
    expect(clearError).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('Owner account ID')).toBeNull();
    fireEvent.change(screen.getByLabelText('Owner username'), {
      target: { value: 'Ryan' },
    });
    fireEvent.change(screen.getByLabelText('New Owner password'), {
      target: { value: 'a-new-owner-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Owner password'), {
      target: { value: 'a-new-owner-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Owner password' }));

    await waitFor(() =>
      expect(setupInitialAdministratorCredential).toHaveBeenCalledWith({
        username: 'Ryan',
        // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate fake password asserts the exact initial-owner submission payload.
        password: 'a-new-owner-password',
        // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Matching fake confirmation asserts both credential fields are forwarded.
        passwordConfirm: 'a-new-owner-password',
      }),
    );
    expect(login).toHaveBeenCalledWith('ryan', 'a-new-owner-password');
  });

  it('seeds the login username when automatic first-owner login fails', async () => {
    const setupInitialAdministratorCredential = vi.fn().mockResolvedValue({
      ok: true,
      value: { accountId: 'account-ryan', username: 'ryan' },
    });
    login.mockResolvedValueOnce(false);
    globalThis.api = { setupInitialAdministratorCredential } as never;
    render(<PrivilegedAccessPanel relayMode="server" />);

    fireEvent.click(screen.getByRole('button', { name: 'Set initial Owner password' }));
    fireEvent.change(screen.getByLabelText('Owner username'), { target: { value: 'Ryan' } });
    fireEvent.change(screen.getByLabelText('New Owner password'), {
      target: { value: 'a-new-owner-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Owner password'), {
      target: { value: 'a-new-owner-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Owner password' }));

    await waitFor(() => expect(login).toHaveBeenCalledWith('ryan', 'a-new-owner-password'));
    expect(screen.getByLabelText('Username')).toHaveValue('ryan');
  });

  it('completes browser first-owner setup only after desktop approval', async () => {
    const approvalRequest = {
      requestId: 'approval-1',
      operation: 'initial-owner-credential' as const,
      sourceLabel: 'Chrome from 10.0.0.8',
      createdAt: '2026-07-20T12:00:00.000Z',
      expiresAt: '2026-07-20T12:10:00.000Z',
    };
    const setupInitialAdministratorCredential = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'approval-required', approvalRequest })
      .mockResolvedValueOnce({
        ok: true,
        value: { accountId: 'account-ryan', username: 'ryan' },
      });
    globalThis.api = { runtime: WEB_RUNTIME, setupInitialAdministratorCredential } as never;
    render(<PrivilegedAccessPanel relayMode="server" />);

    fireEvent.click(screen.getByRole('button', { name: 'Set initial Owner password' }));
    const fillCredential = () => {
      fireEvent.change(screen.getByLabelText('Owner username'), { target: { value: 'ryan' } });
      fireEvent.change(screen.getByLabelText('New Owner password'), {
        target: { value: 'a-new-owner-password' },
      });
      fireEvent.change(screen.getByLabelText('Confirm Owner password'), {
        target: { value: 'a-new-owner-password' },
      });
    };
    fillCredential();
    fireEvent.click(screen.getByRole('button', { name: 'Create Owner password' }));
    expect(await screen.findByText(/Approve this request on the Relay server PC/i)).toBeVisible();
    fillCredential();
    fireEvent.change(screen.getByLabelText('Desktop approval code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Owner password' }));

    await waitFor(() => expect(setupInitialAdministratorCredential).toHaveBeenCalledTimes(2));
    expect(setupInitialAdministratorCredential).toHaveBeenLastCalledWith({
      username: 'ryan',
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Deliberate fake password asserts approved browser setup payload fidelity.
      password: 'a-new-owner-password',
      // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- Matching fake confirmation asserts approved browser setup payload fidelity.
      passwordConfirm: 'a-new-owner-password',
      approvalRequestId: 'approval-1',
      approvalCode: '123456',
    });
  });
});
