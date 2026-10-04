import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebLoginScreen, type WebLoginOutcome } from '../WebLoginScreen';

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
    const onLogin = vi.fn(async () => 'rejected' as const);
    render(<WebLoginScreen serverLabel="Relay server" onLogin={onLogin} />);
    const input = screen.getByLabelText('Connection passphrase');
    fireEvent.change(input, { target: { value: '  exact passphrase bytes  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('  exact passphrase bytes  '));
    expect(input).toHaveValue('');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Sign-in failed. Check the passphrase and try again.',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
      'Sign-in failed. Check the passphrase and try again.',
    );
  });

  it.each([
    ['rate-limited', 'Too many attempts. Wait a minute, then try the same passphrase again.'],
    ['unavailable', 'Relay Web is unavailable right now. Try again in a moment.'],
  ] as const)('tells the operator what to do next after a %s sign-in', async (outcome, message) => {
    const onLogin = vi.fn(async () => outcome);
    render(<WebLoginScreen serverLabel="Relay server" onLogin={onLogin} />);
    fireEvent.change(screen.getByLabelText('Connection passphrase'), {
      target: { value: 'fixture-passphrase' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    // A throttled or unreachable server must never be reported as a wrong passphrase.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(message));
    expect(screen.queryByText(/Check the passphrase/u)).toBeNull();
  });

  it('keeps the passphrase after a rate-limited sign-in so it can be retried as is', async () => {
    const onLogin = vi.fn(async () => 'rate-limited' as const);
    render(<WebLoginScreen serverLabel="Relay server" onLogin={onLogin} />);
    const input = screen.getByLabelText('Connection passphrase');
    fireEvent.change(input, { target: { value: 'fixture-passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeVisible());
    expect(input).toHaveValue('fixture-passphrase');
  });

  it('disables duplicate submission while authentication is pending', async () => {
    let resolveLogin!: (value: WebLoginOutcome) => void;
    const onLogin = vi.fn(
      () =>
        new Promise<WebLoginOutcome>((resolve) => {
          resolveLogin = resolve;
        }),
    );
    render(<WebLoginScreen serverLabel="Relay server" onLogin={onLogin} />);
    fireEvent.change(screen.getByLabelText('Connection passphrase'), {
      target: { value: 'fixture-passphrase' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(screen.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    resolveLogin('accepted');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign In' })).toBeDisabled());
    expect(screen.getByLabelText('Connection passphrase')).toHaveValue('');
  });
});
