import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebReauthenticationOverlay } from '../WebReauthenticationOverlay';

describe('WebReauthenticationOverlay', () => {
  it('keeps the page mounted, clears credentials, and closes only after accepted sign-in', async () => {
    const authenticate = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onAuthenticated = vi.fn();
    render(
      <div>
        <input aria-label="Unsaved title" defaultValue="Draft runbook" />
        <WebReauthenticationOverlay
          onAuthenticate={authenticate}
          onAuthenticated={onAuthenticated}
          onDiscard={vi.fn()}
        />
      </div>,
    );

    const passphrase = screen.getByLabelText('Connection passphrase');
    fireEvent.change(passphrase, { target: { value: 'wrong-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    await screen.findByRole('alert');
    expect(passphrase).toHaveValue('');
    expect(screen.getByLabelText('Unsaved title')).toHaveValue('Draft runbook');

    fireEvent.change(passphrase, { target: { value: 'correct-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledOnce());
  });
});
