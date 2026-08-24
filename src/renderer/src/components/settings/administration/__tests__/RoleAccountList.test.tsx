import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { RelayRoleAccountAdminView } from '@shared/privilegedAccess';
import { RoleAccountList } from '../RoleAccountList';

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

describe('RoleAccountList', () => {
  it('owns account edit state and closes the editor after a successful rename', async () => {
    const onRename = vi.fn(async () => true);
    render(
      <RoleAccountList
        accounts={[account]}
        isOwner
        savingId={null}
        onRename={onRename}
        onRequestActiveChange={vi.fn()}
        onTransferOwnership={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('Rename Relay Admin');
    fireEvent.change(input, { target: { value: 'Operations Admin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onRename).toHaveBeenCalledWith(account, 'Operations Admin'));
    await waitFor(() => expect(screen.queryByLabelText('Rename Relay Admin')).toBeNull());
  });
});
