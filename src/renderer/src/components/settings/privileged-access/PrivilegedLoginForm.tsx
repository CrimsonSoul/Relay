import React, { useRef, useState } from 'react';
import type { PrivilegedAccessContextValue } from '../../../contexts/PrivilegedAccessContext';
import { TactileButton } from '../../TactileButton';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

export function PrivilegedLoginForm({
  username,
  busy,
  error,
  onUsernameChange,
  onClearError,
  onLogin,
}: Readonly<{
  username: string;
  busy: PrivilegedAccessContextValue['busy'];
  error: string | null;
  onUsernameChange: (username: string) => void;
  onClearError: () => void;
  onLogin: (username: string, password: string) => Promise<boolean>;
}>) {
  const [password, setPassword] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormSubmitEvent) => {
    event.preventDefault();
    try {
      await onLogin(username.trim(), password);
    } finally {
      setPassword('');
      passwordRef.current?.focus();
    }
  };

  return (
    <form className="privileged-access__form" onSubmit={(event) => void submit(event)}>
      <div className="privileged-access__state">
        <strong>Sign in for protected actions</strong>
        <span>Use your protected Relay account credentials.</span>
      </div>
      <div className="privileged-access__field-grid">
        <label className="privileged-access__field">
          <span>Username</span>
          <input
            className="tactile-input"
            value={username}
            onChange={(event) => {
              onUsernameChange(event.target.value);
              if (error) onClearError();
            }}
            autoComplete="username"
            maxLength={64}
            disabled={busy !== null}
            required
          />
        </label>
        <label className="privileged-access__field privileged-access__password">
          <span>Password</span>
          <input
            ref={passwordRef}
            type="password"
            className="tactile-input"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (error) onClearError();
            }}
            autoComplete="current-password"
            minLength={12}
            maxLength={128}
            disabled={busy !== null}
            required
          />
        </label>
      </div>
      <div className="privileged-access__actions">
        <TactileButton type="submit" variant="primary" loading={busy === 'login'}>
          Sign in
        </TactileButton>
      </div>
    </form>
  );
}
