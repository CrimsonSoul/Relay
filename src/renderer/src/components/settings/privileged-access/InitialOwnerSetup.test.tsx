import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InitialOwnerSetup } from './InitialOwnerSetup';

describe('InitialOwnerSetup', () => {
  beforeEach(() => {
    globalThis.api = { setupInitialAdministratorCredential: vi.fn() } as never;
  });

  it('keeps mismatched credentials local and does not call the bridge', () => {
    render(
      <InitialOwnerSetup onClearError={vi.fn()} onUsernameCreated={vi.fn()} onLogin={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set Initial Owner Password' }));
    fireEvent.change(screen.getByLabelText('Owner username'), { target: { value: 'ryan' } });
    fireEvent.change(screen.getByLabelText('New Owner password'), {
      target: { value: 'a-new-owner-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Owner password'), {
      target: { value: 'a-different-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Owner Password' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Passwords must match.');
    expect(globalThis.api?.setupInitialAdministratorCredential).not.toHaveBeenCalled();
  });

  it('sends one setup request when the form is submitted again while the first is pending', async () => {
    let resolveSetup!: (value: unknown) => void;
    const setup = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSetup = resolve;
        }),
    );
    globalThis.api = { setupInitialAdministratorCredential: setup } as never;
    const onLogin = vi.fn().mockResolvedValue(true);
    render(
      <InitialOwnerSetup onClearError={vi.fn()} onUsernameCreated={vi.fn()} onLogin={onLogin} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Set Initial Owner Password' }));
    fireEvent.change(screen.getByLabelText('Owner username'), { target: { value: 'ryan' } });
    for (const label of ['New Owner password', 'Confirm Owner password']) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: 'a-new-owner-password' } });
    }
    const create = screen.getByRole('button', { name: 'Create Owner Password' });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(setup).toHaveBeenCalledTimes(1);

    await act(async () => resolveSetup({ ok: true, value: { username: 'ryan' } }));
    expect(onLogin).toHaveBeenCalledWith('ryan', 'a-new-owner-password');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
