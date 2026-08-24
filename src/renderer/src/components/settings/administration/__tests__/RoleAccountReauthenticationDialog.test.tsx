import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RoleAccountReauthenticationDialog } from '../RoleAccountReauthenticationDialog';

describe('RoleAccountReauthenticationDialog', () => {
  it('clears the password before forwarding protected confirmation', async () => {
    const onConfirm = vi.fn(async () => undefined);
    render(
      <RoleAccountReauthenticationDialog
        action={{ kind: 'publisher', accountId: 'account-publisher' }}
        busy={false}
        error={null}
        currentAccountName="Relay Owner"
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'a-secure-owner-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Publisher change' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith('a-secure-owner-password'));
    expect(password.value).toBe('');
  });
});
