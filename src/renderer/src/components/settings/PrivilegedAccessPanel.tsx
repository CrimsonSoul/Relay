import { useCallback, useEffect, useState } from 'react';
import { usePrivilegedAccess } from '../../contexts/PrivilegedAccessContext';
import { usePrivilegedCommands } from '../../contexts/PrivilegedCommandContext';
import { PrivilegedLoginForm } from './privileged-access/PrivilegedLoginForm';
import { InitialOwnerSetup } from './privileged-access/InitialOwnerSetup';
import { PrivilegedPairingForm } from './privileged-access/PrivilegedPairingForm';
import { PrivilegedActiveSession } from './privileged-access/PrivilegedActiveSession';

type Props = { relayMode: 'server' | 'client' | null };

export function PrivilegedAccessPanel({ relayMode }: Readonly<Props>) {
  const [username, setUsername] = useState('');
  const {
    busy: commandBusy,
    error: commandError,
    clearError: clearCommandError,
  } = usePrivilegedCommands();
  const { session, loading, busy, error, clearError, login, logout, completePairing } =
    usePrivilegedAccess();
  const clearErrors = useCallback(() => {
    clearError();
    clearCommandError();
  }, [clearCommandError, clearError]);
  const handleLogout = useCallback(async () => {
    clearCommandError();
    await logout();
  }, [clearCommandError, logout]);

  useEffect(() => {
    if (session.state !== 'active') clearCommandError();
  }, [clearCommandError, session.state]);
  const statusContent = (() => {
    if (loading) return <div className="privileged-access__state">Checking protected access…</div>;

    if (session.state === 'offline') {
      return (
        <div className="privileged-access__state privileged-access__state--offline">
          <strong>Privileged access is unavailable offline.</strong>
          <span>Relay’s normal read-only and cached features remain available.</span>
        </div>
      );
    }

    if (session.state === 'pairing-required') {
      return <PrivilegedPairingForm busy={busy} onComplete={completePairing} onLogout={logout} />;
    }

    if (session.state === 'active' && session.role && session.displayName && session.username) {
      return (
        <PrivilegedActiveSession
          session={session}
          busy={busy}
          commandBusy={commandBusy}
          onLogout={handleLogout}
        />
      );
    }

    return (
      <div className="privileged-access__form">
        <PrivilegedLoginForm
          username={username}
          busy={busy}
          error={error}
          onUsernameChange={setUsername}
          onClearError={clearErrors}
          onLogin={login}
        />
        {relayMode === 'server' && (
          <InitialOwnerSetup
            onClearError={clearErrors}
            onUsernameCreated={setUsername}
            onLogin={login}
          />
        )}
      </div>
    );
  })();

  return (
    <section
      className="administration-panel privileged-access"
      aria-labelledby="privileged-access-title"
    >
      <header className="administration-panel__header">
        <div>
          <h3 id="privileged-access-title">Sign-in</h3>
          <p>Sign in with your Relay role account to publish Wiki documents or administer Relay.</p>
        </div>
      </header>
      {(error || commandError) && (
        <div className="panel-error ink-rail ink-rail--alarm" role="alert">
          {error || commandError}
        </div>
      )}
      {statusContent}
    </section>
  );
}
