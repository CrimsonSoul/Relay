import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RelayRoleAccountAdminView } from '@shared/privilegedAccess';
import { RoleAccountCredentialManager } from '../RoleAccountCredentialManager';

const account: RelayRoleAccountAdminView = {
  accountId: 'account-admin',
  username: 'admin',
  displayName: 'Relay Admin',
  storedRole: 'administrator',
  effectiveRole: 'admin',
  active: true,
  credentialState: 'configured',
  mustChangePassword: false,
  credentialVersion: 1,
  revision: 1,
  createdAt: '2026-08-23T18:00:00.000Z',
  updatedAt: '2026-08-23T18:00:00.000Z',
};

describe('RoleAccountCredentialManager', () => {
  afterEach(() => {
    delete globalThis.api;
  });

  it('clears sensitive fields and permits retry after a transport rejection', async () => {
    const setupPrivilegedCredential = vi.fn().mockRejectedValue(new Error('network'));
    globalThis.api = { setupPrivilegedCredential } as never;
    const onFeedback = vi.fn();
    render(
      <RoleAccountCredentialManager
        relayMode="server"
        credentialTargets={[account]}
        unassignedAccounts={[]}
        onFeedback={onFeedback}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Set credential for Relay Admin' }));
    for (const label of ['New password', 'Confirm password'])
      fireEvent.change(screen.getByLabelText(label), { target: { value: 'long-secure-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set credential' }));
    await waitFor(() =>
      expect(onFeedback).toHaveBeenCalledWith(
        'Credential setup could not be completed. Try again.',
      ),
    );
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByLabelText('Confirm password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Set credential' })).toBeEnabled();
  });

  it('keeps password mismatch handling inside the credential workflow', () => {
    const setupPrivilegedCredential = vi.fn();
    globalThis.api = { setupPrivilegedCredential } as never;
    const onFeedback = vi.fn();
    render(
      <RoleAccountCredentialManager
        relayMode="server"
        credentialTargets={[account]}
        unassignedAccounts={[]}
        onFeedback={onFeedback}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set credential for Relay Admin' }));
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'one-secure-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set credential' }));

    expect(onFeedback).toHaveBeenCalledWith('Passwords must match.');
    expect(setupPrivilegedCredential).not.toHaveBeenCalled();
  });
});
