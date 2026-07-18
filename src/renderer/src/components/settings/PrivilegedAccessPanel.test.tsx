import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';

const { mockUsePrivilegedAccess, mockUseRelayAdministration } = vi.hoisted(() => ({
  mockUsePrivilegedAccess: vi.fn(),
  mockUseRelayAdministration: vi.fn(),
}));

vi.mock('../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: mockUsePrivilegedAccess,
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
  expiresAt: state === 'active' ? '2026-07-15T20:15:00.000Z' : null,
});

describe('PrivilegedAccessPanel', () => {
  const login = vi.fn().mockResolvedValue(true);
  const completePairing = vi.fn().mockResolvedValue(true);
  const createPairingChallenge = vi.fn().mockResolvedValue(null);

  beforeEach(() => {
    vi.clearAllMocks();
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
      lock: vi.fn(),
      createPairingChallenge,
      completePairing,
      pairingChallenge: null,
      clearError: vi.fn(),
    });
  });

  it('signs in with username and password, clears the password, and returns focus', async () => {
    render(<PrivilegedAccessPanel relayMode="server" />);
    const username = screen.getByLabelText('Username');
    const password = screen.getByLabelText('Password') as HTMLInputElement;

    fireEvent.change(username, { target: { value: 'ryan' } });
    fireEvent.change(password, { target: { value: 'a-long-private-password' } });
    fireEvent.submit(password.closest('form')!);

    await waitFor(() => expect(login).toHaveBeenCalledWith('ryan', 'a-long-private-password'));
    expect(password.value).toBe('');
    expect(password).toHaveFocus();
    expect(screen.queryByText(/operator profile/i)).toBeNull();
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

  it('offers server-local first-owner credential setup by account ID without operator selection', async () => {
    const setupInitialAdministratorCredential = vi.fn().mockResolvedValue({
      ok: true,
      value: { accountId: 'account-ryan', username: 'ryan' },
    });
    globalThis.api = { setupInitialAdministratorCredential } as never;
    render(<PrivilegedAccessPanel relayMode="server" />);

    fireEvent.click(screen.getByRole('button', { name: 'Set initial Owner password' }));
    fireEvent.change(screen.getByLabelText('Owner account ID'), {
      target: { value: 'account-ryan' },
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
        accountId: 'account-ryan',
        password: 'a-new-owner-password',
        passwordConfirm: 'a-new-owner-password',
      }),
    );
    expect(login).toHaveBeenCalledWith('ryan', 'a-new-owner-password');
  });
});
