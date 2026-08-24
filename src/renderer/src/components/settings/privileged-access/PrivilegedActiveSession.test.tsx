import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PrivilegedPairingChallengeTarget } from '@shared/ipc';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import { PrivilegedActiveSession } from './PrivilegedActiveSession';

const activeSession: PrivilegedSessionView = {
  state: 'active',
  accountId: 'account-admin',
  username: 'admin',
  displayName: 'Relay Admin',
  role: 'admin',
  capabilities: ['privileged.status.read'],
  deviceId: 'device-1',
  expiresAt: null,
};

const targets: PrivilegedPairingChallengeTarget[] = [
  {
    accountId: 'account-owner',
    username: 'owner',
    displayName: 'Relay Owner',
    role: 'owner',
  },
  {
    accountId: 'account-publisher',
    username: 'publisher',
    displayName: 'Wiki Publisher',
    role: 'publisher',
  },
];

describe('PrivilegedActiveSession', () => {
  it('owns the pairing target selection and submits the selected account ID', async () => {
    const onCreatePairingChallenge = vi.fn().mockResolvedValue(null);
    render(
      <PrivilegedActiveSession
        session={activeSession}
        relayMode="server"
        busy={null}
        commandBusy={false}
        pairingTargets={targets}
        pairingChallenge={null}
        administrationLoading={false}
        onLogout={vi.fn()}
        onCreatePairingChallenge={onCreatePairingChallenge}
      />,
    );

    expect(screen.getByLabelText('Workstation owner')).toHaveValue('account-owner');
    fireEvent.change(screen.getByLabelText('Workstation owner'), {
      target: { value: 'account-publisher' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create pairing code' }));

    await waitFor(() => expect(onCreatePairingChallenge).toHaveBeenCalledWith('account-publisher'));
  });

  it('prevents sign-out while a protected command is active', () => {
    render(
      <PrivilegedActiveSession
        session={activeSession}
        relayMode="server"
        busy={null}
        commandBusy
        pairingTargets={targets}
        pairingChallenge={null}
        administrationLoading={false}
        onLogout={vi.fn()}
        onCreatePairingChallenge={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDisabled();
  });
});
