import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PrivilegedLoginForm } from './PrivilegedLoginForm';

describe('PrivilegedLoginForm', () => {
  it('owns and clears the submitted password before restoring focus', async () => {
    const onLogin = vi.fn().mockResolvedValue(false);
    function LoginHarness() {
      const [username, setUsername] = useState('');
      return (
        <PrivilegedLoginForm
          username={username}
          busy={null}
          error={null}
          onUsernameChange={setUsername}
          onClearError={vi.fn()}
          onLogin={onLogin}
        />
      );
    }
    render(<LoginHarness />);

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: ' Ryan ' } });
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'a-long-private-password' } });
    fireEvent.submit(password.closest('form')!);

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith('Ryan', 'a-long-private-password'));
    expect(password.value).toBe('');
    expect(password).toHaveFocus();
  });
});
