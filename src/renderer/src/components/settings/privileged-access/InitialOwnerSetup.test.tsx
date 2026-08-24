import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

    fireEvent.click(screen.getByRole('button', { name: 'Set initial Owner password' }));
    fireEvent.change(screen.getByLabelText('Owner username'), { target: { value: 'ryan' } });
    fireEvent.change(screen.getByLabelText('New Owner password'), {
      target: { value: 'a-new-owner-password' },
    });
    fireEvent.change(screen.getByLabelText('Confirm Owner password'), {
      target: { value: 'a-different-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Owner password' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Passwords must match.');
    expect(globalThis.api?.setupInitialAdministratorCredential).not.toHaveBeenCalled();
  });
});
