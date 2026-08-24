import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { PrivilegedPairingChallengeTarget } from '@shared/ipc';
import { usePrivilegedAccess } from '../../contexts/PrivilegedAccessContext';
import { usePrivilegedCommands } from '../../contexts/PrivilegedCommandContext';
import { useRelayAdministration } from '../../hooks/useRelayAdministration';
import { WebApprovalRequestsPanel } from './WebApprovalRequestsPanel';
import { PrivilegedLoginForm } from './privileged-access/PrivilegedLoginForm';
import { InitialOwnerSetup } from './privileged-access/InitialOwnerSetup';
import { PrivilegedPairingForm } from './privileged-access/PrivilegedPairingForm';
import { PrivilegedActiveSession } from './privileged-access/PrivilegedActiveSession';

type Props = { relayMode: 'server' | 'client' | null };

export function PrivilegedAccessPanel({ relayMode }: Readonly<Props>) {
  const administration = useRelayAdministration();
  const [username, setUsername] = useState('');
  const {
    busy: commandBusy,
    error: commandError,
    clearError: clearCommandError,
  } = usePrivilegedCommands();
  const {
    session,
    loading,
    busy,
    error,
    pairingChallenge,
    clearError,
    login,
    logout,
    createPairingChallenge,
    completePairing,
  } = usePrivilegedAccess();
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
  const pairingTargets = useMemo<PrivilegedPairingChallengeTarget[]>(() => {
    const accounts = administration.snapshot?.accounts ?? [];
    return accounts.flatMap((account) =>
      account.active && account.effectiveRole
        ? [
            {
              accountId: account.accountId,
              username: account.username,
              displayName: account.displayName,
              role: account.effectiveRole,
            },
          ]
        : [],
    );
  }, [administration.snapshot?.accounts]);

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
          relayMode={relayMode}
          busy={busy}
          commandBusy={commandBusy}
          pairingTargets={pairingTargets}
          pairingChallenge={pairingChallenge}
          administrationLoading={administration.loading}
          onLogout={handleLogout}
          onCreatePairingChallenge={createPairingChallenge}
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
    <>
      <section
        className="settings-section privileged-access"
        aria-labelledby="privileged-access-title"
      >
        <header className="privileged-access__header">
          <div className="settings-section-heading">Access</div>
          <h2 id="privileged-access-title" className="privileged-access__title">
            Privileged access
          </h2>
          <p className="settings-description">
            Sign in to administer Relay or publish Wiki documents with a protected role account.
          </p>
        </header>
        {(error || commandError) && (
          <div className="privileged-access__feedback" role="alert">
            {error || commandError}
          </div>
        )}
        {statusContent}
      </section>
      <WebApprovalRequestsPanel relayMode={relayMode} />
    </>
  );
}
