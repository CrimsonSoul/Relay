import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';

const { mockUseOperator, mockUsePrivilegedAccess } = vi.hoisted(() => ({
  mockUseOperator: vi.fn(),
  mockUsePrivilegedAccess: vi.fn(),
}));

vi.mock('../../contexts/OperatorContext', () => ({ useOperator: mockUseOperator }));
vi.mock('../../contexts/PrivilegedAccessContext', () => ({
  usePrivilegedAccess: mockUsePrivilegedAccess,
}));

import { PrivilegedAccessPanel } from './PrivilegedAccessPanel';

const session = (state: PrivilegedSessionView['state']): PrivilegedSessionView => ({
  state,
  accountId: state === 'active' ? 'account-1' : null,
  operatorId: state === 'active' ? 'operator-1' : null,
  operatorName: state === 'active' ? 'Ryan Bledsoe' : null,
  role: state === 'active' ? 'admin' : null,
  capabilities: state === 'active' ? ['privileged.status.read', 'operators.manage'] : [],
  deviceId: state === 'active' ? 'device-1' : null,
  expiresAt: state === 'active' ? '2026-07-15T20:15:00.000Z' : null,
});

describe('PrivilegedAccessPanel', () => {
  const login = vi.fn().mockResolvedValue(true);
  const completePairing = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseOperator.mockReturnValue({
      selectedOperator: { id: 'operator-1', displayName: 'Ryan Bledsoe' },
    });
    mockUsePrivilegedAccess.mockReturnValue({
      session: session('signed-out'),
      loading: false,
      busy: null,
      error: null,
      login,
      logout: vi.fn(),
      lock: vi.fn(),
      createPairingChallenge: vi.fn(),
      completePairing,
      pairingChallenge: null,
      clearError: vi.fn(),
    });
  });

  it('submits from the keyboard, clears the password, and returns focus', async () => {
    render(<PrivilegedAccessPanel relayMode="server" />);
    const password = screen.getByLabelText('Privileged password') as HTMLInputElement;

    fireEvent.change(password, { target: { value: 'a-long-private-password' } });
    fireEvent.submit(password.closest('form')!);

    await waitFor(() => expect(login).toHaveBeenCalledWith('a-long-private-password'));
    expect(password.value).toBe('');
    expect(password).toHaveFocus();
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
    ['admin', 'Administrator'],
    ['publisher', 'Knowledge publisher'],
  ] as const)('labels an active %s session', (role, label) => {
    mockUsePrivilegedAccess.mockReturnValue({
      ...mockUsePrivilegedAccess(),
      session: { ...session('active'), role },
    });
    render(<PrivilegedAccessPanel relayMode="server" />);

    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Lock' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });

  it('offers unlock for a locked session', () => {
    mockUsePrivilegedAccess.mockReturnValue({
      ...mockUsePrivilegedAccess(),
      session: { ...session('locked'), operatorName: 'Ryan Bledsoe' },
    });
    render(<PrivilegedAccessPanel relayMode="server" />);

    expect(screen.getByRole('button', { name: 'Unlock' })).toBeVisible();
  });

  it('renders an explicit offline state without authentication controls', () => {
    mockUsePrivilegedAccess.mockReturnValue({
      ...mockUsePrivilegedAccess(),
      session: session('offline'),
    });
    render(<PrivilegedAccessPanel relayMode="server" />);

    expect(screen.getByText('Privileged access is unavailable offline.')).toBeVisible();
    expect(screen.queryByLabelText('Privileged password')).toBeNull();
  });

  it('does not offer local-only challenge creation from a client workstation', () => {
    mockUsePrivilegedAccess.mockReturnValue({
      ...mockUsePrivilegedAccess(),
      session: session('active'),
    });
    render(<PrivilegedAccessPanel relayMode="client" />);

    expect(screen.queryByRole('button', { name: 'Create pairing code' })).toBeNull();
    expect(screen.getByText(/Pair additional workstations from the Relay server/)).toBeVisible();
  });
});
