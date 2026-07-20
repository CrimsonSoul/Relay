import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PrivilegedPairingChallengeTarget } from '@shared/ipc';
import { usePrivilegedAccess } from '../../contexts/PrivilegedAccessContext';
import { useRelayAdministration } from '../../hooks/useRelayAdministration';
import { TactileButton } from '../TactileButton';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];
type Props = { relayMode: 'server' | 'client' | null };

const formatExpiry = (value: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(parsed);
};

const roleLabel = (role: 'owner' | 'admin' | 'publisher') => {
  if (role === 'owner') return 'Owner';
  if (role === 'admin') return 'Administrator';
  return 'Publisher';
};

const pairingTargetLabel = (target: PrivilegedPairingChallengeTarget | undefined) =>
  target ? `${target.displayName} · ${roleLabel(target.role)}` : 'Selected protected account';

export function PrivilegedAccessPanel({ relayMode }: Readonly<Props>) {
  const administration = useRelayAdministration();
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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [initialSetupOpen, setInitialSetupOpen] = useState(false);
  const [initialUsername, setInitialUsername] = useState('');
  const [initialPassword, setInitialPassword] = useState('');
  const [initialPasswordConfirm, setInitialPasswordConfirm] = useState('');
  const [setupFeedback, setSetupFeedback] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [pairingTargetAccountId, setPairingTargetAccountId] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    setPairingTargetAccountId((current) => {
      if (pairingTargets.some(({ accountId }) => accountId === current)) return current;
      return (
        pairingTargets.find(({ role }) => role === 'owner' || role === 'admin')?.accountId ?? ''
      );
    });
  }, [pairingTargets]);

  useEffect(
    () => () => {
      setPassword('');
      setInitialPassword('');
      setInitialPasswordConfirm('');
    },
    [],
  );

  const handleLogin = async (event: FormSubmitEvent) => {
    event.preventDefault();
    try {
      await login(username.trim(), password);
    } finally {
      setPassword('');
      passwordRef.current?.focus();
    }
  };

  const handlePair = async (event: FormSubmitEvent) => {
    event.preventDefault();
    const paired = await completePairing({
      challengeId: challengeId.trim(),
      code: pairingCode.trim().toUpperCase(),
      deviceLabel: deviceLabel.trim(),
    });
    if (paired) setPairingCode('');
  };

  const closeInitialSetup = () => {
    setInitialPassword('');
    setInitialPasswordConfirm('');
    setInitialSetupOpen(false);
  };

  const openInitialSetup = () => {
    clearError();
    setSetupFeedback(null);
    setInitialSetupOpen(true);
  };

  const handleInitialSetup = async (event: FormSubmitEvent) => {
    event.preventDefault();
    setSetupFeedback(null);
    if (initialPassword !== initialPasswordConfirm) {
      setSetupFeedback('Passwords must match.');
      return;
    }
    const passwordToUse = initialPassword;
    try {
      const result = await globalThis.api?.setupInitialAdministratorCredential({
        username: initialUsername.trim(),
        password: passwordToUse,
        passwordConfirm: initialPasswordConfirm,
      });
      setInitialPassword('');
      setInitialPasswordConfirm('');
      if (!result?.ok) {
        setSetupFeedback('Initial Owner setup was not accepted. It may already be complete.');
        return;
      }
      setInitialSetupOpen(false);
      setUsername(result.value.username);
      await login(result.value.username, passwordToUse);
    } catch {
      setInitialPassword('');
      setInitialPasswordConfirm('');
      setSetupFeedback('Initial Owner setup could not be completed.');
    }
  };

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
      return (
        <form className="privileged-access__form" onSubmit={handlePair}>
          <div className="privileged-access__state">
            <strong>Pair this workstation</strong>
            <span>Create a one-time challenge on the Relay server, then enter it here.</span>
          </div>
          <div className="privileged-access__field-grid">
            <label className="privileged-access__field">
              <span>Pairing challenge ID</span>
              <input
                className="input"
                value={challengeId}
                onChange={(event) => setChallengeId(event.target.value)}
                autoComplete="off"
                required
              />
            </label>
            <label className="privileged-access__field">
              <span>One-time pairing code</span>
              <input
                className="input privileged-access__code"
                value={pairingCode}
                onChange={(event) => setPairingCode(event.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={8}
                required
              />
            </label>
            <label className="privileged-access__field privileged-access__field--wide">
              <span>Device label</span>
              <input
                className="input"
                value={deviceLabel}
                onChange={(event) => setDeviceLabel(event.target.value)}
                placeholder="Work laptop"
                maxLength={80}
                required
              />
            </label>
          </div>
          <div className="privileged-access__actions">
            <TactileButton type="submit" variant="primary" loading={busy === 'pair'}>
              Pair device
            </TactileButton>
            <TactileButton type="button" onClick={() => void logout()} disabled={busy !== null}>
              Sign out
            </TactileButton>
          </div>
        </form>
      );
    }

    if (session.state === 'active' && session.role && session.displayName && session.username) {
      const canPair = session.role === 'owner' || session.role === 'admin';
      const challengeTarget = pairingTargets.find(
        ({ accountId }) => accountId === pairingChallenge?.accountId,
      );
      return (
        <div className="privileged-access__active">
          <div className="privileged-access__identity">
            <div>
              <span className={`privileged-access__role privileged-access__role--${session.role}`}>
                {roleLabel(session.role)}
              </span>
              <strong>{session.displayName}</strong>
              <span>@{session.username}</span>
              <span>Active until you sign out</span>
            </div>
            <div className="privileged-access__actions">
              <TactileButton type="button" onClick={() => void logout()} disabled={busy !== null}>
                Sign out
              </TactileButton>
            </div>
          </div>

          {canPair && relayMode === 'server' && (
            <div className="privileged-access__pairing-console">
              <div>
                <strong>Pair a protected workstation</strong>
                <span>
                  Choose its account. Challenge codes expire after 10 minutes and work once.
                </span>
              </div>
              <div className="privileged-access__pairing-actions">
                <label className="privileged-access__field">
                  <span>Workstation owner</span>
                  <select
                    className="input"
                    value={pairingTargetAccountId}
                    onChange={(event) => setPairingTargetAccountId(event.target.value)}
                    disabled={administration.loading || pairingTargets.length === 0}
                    required
                  >
                    {pairingTargets.length === 0 && <option value="">No eligible accounts</option>}
                    {pairingTargets.map((target) => (
                      <option key={target.accountId} value={target.accountId}>
                        {target.displayName} — {roleLabel(target.role)}
                      </option>
                    ))}
                  </select>
                </label>
                <TactileButton
                  type="button"
                  onClick={() => void createPairingChallenge(pairingTargetAccountId)}
                  loading={busy === 'challenge'}
                  disabled={!pairingTargetAccountId}
                >
                  Create pairing code
                </TactileButton>
              </div>
              {pairingChallenge && (
                <dl className="privileged-access__challenge" aria-label="Active pairing challenge">
                  <div className="privileged-access__challenge-owner">
                    <dt>Workstation owner</dt>
                    <dd>{pairingTargetLabel(challengeTarget)}</dd>
                  </div>
                  <div>
                    <dt>Challenge ID</dt>
                    <dd>{pairingChallenge.challengeId}</dd>
                  </div>
                  <div>
                    <dt>Code</dt>
                    <dd className="privileged-access__challenge-code">{pairingChallenge.code}</dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd>{formatExpiry(pairingChallenge.expiresAt) ?? 'Soon'}</dd>
                  </div>
                </dl>
              )}
            </div>
          )}
          {canPair && relayMode === 'client' && (
            <div className="privileged-access__state">
              <strong>Pairing is controlled locally</strong>
              <span>Pair additional workstations from the Relay server PC.</span>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="privileged-access__form">
        <form className="privileged-access__form" onSubmit={handleLogin}>
          <div className="privileged-access__state">
            <strong>Sign in for protected actions</strong>
            <span>Use your protected Relay account credentials.</span>
          </div>
          <div className="privileged-access__field-grid">
            <label className="privileged-access__field">
              <span>Username</span>
              <input
                className="input"
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  if (error) clearError();
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
                className="input"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (error) clearError();
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
        {relayMode === 'server' && (
          <div className="privileged-access__bootstrap">
            <div className="privileged-access__state">
              <strong>First-time Owner setup</strong>
              <span>Available only on this Relay server PC. Relay has no default password.</span>
            </div>
            {!initialSetupOpen ? (
              <TactileButton type="button" onClick={openInitialSetup}>
                Set initial Owner password
              </TactileButton>
            ) : (
              <form className="privileged-access__form" onSubmit={handleInitialSetup}>
                <div className="privileged-access__field-grid">
                  <label className="privileged-access__field">
                    <span>Owner username</span>
                    <input
                      className="input"
                      value={initialUsername}
                      onChange={(event) => setInitialUsername(event.target.value)}
                      autoComplete="off"
                      required
                    />
                  </label>
                  <label className="privileged-access__field">
                    <span>New Owner password</span>
                    <input
                      type="password"
                      className="input"
                      value={initialPassword}
                      onChange={(event) => setInitialPassword(event.target.value)}
                      minLength={12}
                      maxLength={128}
                      required
                    />
                  </label>
                  <label className="privileged-access__field">
                    <span>Confirm Owner password</span>
                    <input
                      type="password"
                      className="input"
                      value={initialPasswordConfirm}
                      onChange={(event) => setInitialPasswordConfirm(event.target.value)}
                      minLength={12}
                      maxLength={128}
                      required
                    />
                  </label>
                </div>
                <div className="privileged-access__actions">
                  <TactileButton type="submit" variant="primary">
                    Create Owner password
                  </TactileButton>
                  <TactileButton type="button" onClick={closeInitialSetup}>
                    Cancel
                  </TactileButton>
                </div>
              </form>
            )}
            {setupFeedback && (
              <div className="privileged-access__feedback" role="alert">
                {setupFeedback}
              </div>
            )}
          </div>
        )}
      </div>
    );
  })();

  return (
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
      {error && (
        <div className="privileged-access__feedback" role="alert">
          {error}
        </div>
      )}
      {statusContent}
    </section>
  );
}
