import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PrivilegedPairingForm } from './PrivilegedPairingForm';

describe('PrivilegedPairingForm', () => {
  it('normalizes the one-time code and clears it after successful pairing', async () => {
    const onComplete = vi.fn().mockResolvedValue(true);
    render(<PrivilegedPairingForm busy={null} onComplete={onComplete} onLogout={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Pairing challenge ID'), {
      target: { value: ' challenge-1 ' },
    });
    const code = screen.getByLabelText('One-time pairing code') as HTMLInputElement;
    fireEvent.change(code, { target: { value: 'abcd2345' } });
    fireEvent.change(screen.getByLabelText('Device label'), {
      target: { value: ' Ryan laptop ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pair device' }));

    await waitFor(() =>
      expect(onComplete).toHaveBeenCalledWith({
        challengeId: 'challenge-1',
        code: 'ABCD2345',
        deviceLabel: 'Ryan laptop',
      }),
    );
    expect(code.value).toBe('');
  });
});
