import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebReauthenticationOverlay } from '../WebReauthenticationOverlay';

describe('WebReauthenticationOverlay', () => {
  it('contains keyboard focus and consumes Escape without dismissing the security gate', async () => {
    const onDiscard = vi.fn();
    render(
      <div>
        <button type="button">Outside action</button>
        <WebReauthenticationOverlay
          onAuthenticate={vi.fn(async () => false)}
          onAuthenticated={vi.fn()}
          onDiscard={onDiscard}
        />
      </div>,
    );

    const passphrase = screen.getByLabelText('Connection passphrase');
    const discard = screen.getByRole('button', { name: 'Discard and return to sign in' });
    await waitFor(() => expect(passphrase).toHaveFocus());

    discard.focus();
    expect(fireEvent.keyDown(discard, { key: 'Tab' })).toBe(false);
    expect(passphrase).toHaveFocus();

    expect(fireEvent.keyDown(passphrase, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(discard).toHaveFocus();

    expect(fireEvent.keyDown(discard, { key: 'Escape' })).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Sign in to keep working' })).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Outside action' })).not.toHaveFocus();
  });

  it('restores the previously focused control after successful reauthentication', async () => {
    const authenticate = vi.fn(async () => true);

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open protected gate
          </button>
          {open && (
            <WebReauthenticationOverlay
              onAuthenticate={authenticate}
              onAuthenticated={() => setOpen(false)}
              onDiscard={vi.fn()}
            />
          )}
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open protected gate' });
    trigger.focus();
    fireEvent.click(trigger);

    const passphrase = screen.getByLabelText('Connection passphrase');
    await waitFor(() => expect(passphrase).toHaveFocus());
    fireEvent.change(passphrase, { target: { value: 'correct-value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole('dialog', { name: 'Sign in to keep working' })).toBeNull();
  });

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
