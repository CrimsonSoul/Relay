import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PrivilegedPairingChallengeTarget } from '@shared/ipc';
import type { PrivilegedSessionView } from '@shared/privilegedAccess';
import { PrivilegedActiveSession, WorkstationPairing } from './PrivilegedActiveSession';

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
      <WorkstationPairing
        relayMode="server"
        busy={null}
        pairingTargets={targets}
        pairingChallenge={null}
        administrationLoading={false}
        onCreatePairingChallenge={onCreatePairingChallenge}
      />,
    );

    expect(screen.getByLabelText('Workstation owner')).toHaveValue('account-owner');
    fireEvent.change(screen.getByLabelText('Workstation owner'), {
      target: { value: 'account-publisher' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Pairing Code' }));

    await waitFor(() => expect(onCreatePairingChallenge).toHaveBeenCalledWith('account-publisher'));
  });

  it('prevents sign-out while a protected command is active', () => {
    render(
      <PrivilegedActiveSession
        session={activeSession}
        busy={null}
        commandBusy
        onLogout={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Sign Out' })).toBeDisabled();
  });

  it('sends pairing to the Relay server PC from a client workstation', () => {
    render(
      <WorkstationPairing
        relayMode="client"
        busy={null}
        pairingTargets={targets}
        pairingChallenge={null}
        administrationLoading={false}
        onCreatePairingChallenge={vi.fn()}
      />,
    );

    expect(screen.getByText('Pair workstations on the Relay server PC')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Create Pairing Code' })).toBeNull();
  });
});
