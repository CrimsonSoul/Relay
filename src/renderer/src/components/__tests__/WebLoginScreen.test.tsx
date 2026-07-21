import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebLoginScreen } from '../WebLoginScreen';

describe('WebLoginScreen', () => {
  it('shows only browser sign-in, server identity, and the permanent HTTP warning', () => {
    render(<WebLoginScreen serverLabel="Relay server" onLogin={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Relay Web' })).toBeVisible();
    expect(screen.getByText('Relay server')).toBeVisible();
    expect(screen.getByLabelText('Connection passphrase')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
    expect(
      screen.getByText('Trusted LAN/VPN only - browser traffic is not encrypted'),
    ).toBeVisible();
    expect(screen.queryByText(/configure|server setup|client mode/i)).toBeNull();
  });

  it('submits exact passphrase bytes, clears the field, and uses generic failure copy', async () => {
    const onLogin = vi.fn(async () => false);
    render(<WebLoginScreen serverLabel="Relay server" onLogin={onLogin} />);
    const input = screen.getByLabelText('Connection passphrase');
    fireEvent.change(input, { target: { value: '  exact passphrase bytes  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('  exact passphrase bytes  '));
    expect(input).toHaveValue('');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Sign-in failed. Check the passphrase and try again.',
    );
  });

  it('disables duplicate submission while authentication is pending', async () => {
    let resolveLogin!: (value: boolean) => void;
    const onLogin = vi.fn(() => new Promise<boolean>((resolve) => (resolveLogin = resolve)));
    render(<WebLoginScreen serverLabel="Relay server" onLogin={onLogin} />);
    fireEvent.change(screen.getByLabelText('Connection passphrase'), {
      target: { value: 'fixture-passphrase' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    resolveLogin(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled());
    expect(screen.getByLabelText('Connection passphrase')).toHaveValue('');
  });
});
