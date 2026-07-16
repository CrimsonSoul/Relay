import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PrivilegedPairingChallengeTarget } from '@shared/ipc';
import { useOperator } from '../../contexts/OperatorContext';
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

const pairingTargetLabel = (target: PrivilegedPairingChallengeTarget | undefined) => {
  if (!target) return 'Selected privileged account';
  const role = target.role === 'admin' ? 'Administrator' : 'Knowledge publisher';
  return `${target.operatorName} · ${role}`;
};

export function PrivilegedAccessPanel({ relayMode }: Readonly<Props>) {
  const { selectedOperator } = useOperator();
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
    lock,
    createPairingChallenge,
    completePairing,
  } = usePrivilegedAccess();
  const [password, setPassword] = useState('');
  const [initialSetupOpen, setInitialSetupOpen] = useState(false);
  const [initialPassword, setInitialPassword] = useState('');
  const [initialPasswordConfirm, setInitialPasswordConfirm] = useState('');
  const [setupFeedback, setSetupFeedback] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [pairingTargetAccountId, setPairingTargetAccountId] = useState('');
  const passwordRef = useRef<HTMLInputElement>(null);
  const pairingTargets = useMemo<PrivilegedPairingChallengeTarget[]>(() => {
    const snapshot = administration.snapshot;
    if (!snapshot) return [];
    const operators = new Map(
      snapshot.operators.map((operator) => [operator.id, operator] as const),
    );
    return snapshot.privilegedAccounts.flatMap((account) => {
      const operator = operators.get(account.operatorId);
      const assigned =
        (account.role === 'admin' && account.operatorId === snapshot.adminOperatorId) ||
        (account.role === 'publisher' && account.operatorId === snapshot.publisherOperatorId);
      if (!account.active || !operator?.active || !assigned) return [];
      return [
        {
          accountId: account.accountId,
          operatorId: account.operatorId,
          operatorName: operator.displayName,
          role: account.role,
        },
      ];
    });
  }, [administration.snapshot]);

  useEffect(() => {
    setPairingTargetAccountId((current) => {
      if (pairingTargets.some(({ accountId }) => accountId === current)) return current;
      return pairingTargets.find(({ role }) => role === 'admin')?.accountId ?? '';
    });
  }, [pairingTargets]);

  const challengeTarget = pairingTargets.find(
    ({ accountId }) => accountId === pairingChallenge?.accountId,
  );
  const challengeOwnerLabel = pairingTargetLabel(challengeTarget);

  const handleLogin = async (event: FormSubmitEvent) => {
    event.preventDefault();
    try {
      await login(password);
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

  const handleInitialSetup = async (event: FormSubmitEvent) => {
    event.preventDefault();
    setSetupFeedback(null);
    if (!selectedOperator) {
      setSetupFeedback('Choose the Ryan Bledsoe operator profile first.');
      return;
    }
    if (initialPassword !== initialPasswordConfirm) {
      setSetupFeedback('Passwords must match.');
      return;
    }
    const passwordToUse = initialPassword;
    try {
      const result = await globalThis.api?.setupInitialAdministratorCredential({
        operatorId: selectedOperator.id,
        password: passwordToUse,
        passwordConfirm: initialPasswordConfirm,
      });
      setInitialPassword('');
      setInitialPasswordConfirm('');
      if (!result?.ok) {
        setSetupFeedback('Initial setup was not accepted. It may already be complete.');
        return;
      }
      setInitialSetupOpen(false);
      await login(passwordToUse);
    } catch {
      setInitialPassword('');
      setInitialPasswordConfirm('');
      setSetupFeedback('Initial setup could not be completed.');
    }
  };

  const statusContent = (() => {
    if (loading) {
      return <div className="privileged-access__state">Checking privileged access…</div>;
    }

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

    if (session.state === 'active') {
      const roleLabel = session.role === 'admin' ? 'Administrator' : 'Knowledge publisher';
      const expiry = formatExpiry(session.expiresAt);
      return (
        <div className="privileged-access__active">
          <div className="privileged-access__identity">
            <div>
              <span className={`privileged-access__role privileged-access__role--${session.role}`}>
                {roleLabel}
              </span>
              <strong>{session.operatorName}</strong>
              <span>
                {expiry ? `Locks after inactivity · session expires ${expiry}` : 'Active session'}
              </span>
            </div>
            <div className="privileged-access__actions">
              <TactileButton type="button" onClick={() => void lock()} disabled={busy !== null}>
                Lock
              </TactileButton>
              <TactileButton type="button" onClick={() => void logout()} disabled={busy !== null}>
                Sign out
              </TactileButton>
            </div>
          </div>

          {session.role === 'admin' && relayMode === 'server' && (
            <div className="privileged-access__pairing-console">
              <div>
                <strong>Pair a privileged workstation</strong>
                <span>
                  Choose its owner. Challenge codes expire after 10 minutes and work once.
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
                        {target.operatorName} —{' '}
                        {target.role === 'admin' ? 'Administrator' : 'Knowledge publisher'}
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
                    <dd>{challengeOwnerLabel}</dd>
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
          {session.role === 'admin' && relayMode === 'client' && (
            <div className="privileged-access__state">
              <strong>Pairing is controlled locally</strong>
              <span>Pair additional workstations from the Relay server PC.</span>
            </div>
          )}
        </div>
      );
    }

    const locked = session.state === 'locked';
    return (
      <div className="privileged-access__form">
        <form className="privileged-access__form" onSubmit={handleLogin}>
          <div className="privileged-access__state">
            <strong>
              {locked ? 'Privileged access is locked' : 'Sign in for protected actions'}
            </strong>
            <span>
              {selectedOperator
                ? `Authenticating as ${selectedOperator.displayName}.`
                : 'Choose your operator profile in the sidebar first.'}
            </span>
          </div>
          <label className="privileged-access__field privileged-access__password">
            <span>Privileged password</span>
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
              disabled={!selectedOperator || busy !== null}
              required
            />
          </label>
          <div className="privileged-access__actions">
            <TactileButton
              type="submit"
              variant="primary"
              loading={busy === 'login'}
              disabled={!selectedOperator}
            >
              {locked ? 'Unlock' : 'Sign in'}
            </TactileButton>
          </div>
        </form>
        {relayMode === 'server' && (
          <div className="privileged-access__bootstrap">
            <div className="privileged-access__state">
              <strong>First-time administrator setup</strong>
              <span>
                Available only on this Relay server PC for Ryan Bledsoe. There is no default
                password.
              </span>
            </div>
            {!initialSetupOpen ? (
              <TactileButton type="button" onClick={() => setInitialSetupOpen(true)}>
                Set initial administrator password
              </TactileButton>
            ) : (
              <form className="privileged-access__form" onSubmit={handleInitialSetup}>
                <div className="privileged-access__field-grid">
                  <label className="privileged-access__field">
                    <span>New administrator password</span>
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
                    <span>Confirm administrator password</span>
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
                    Create administrator password
                  </TactileButton>
                  <TactileButton
                    type="button"
                    onClick={() => {
                      setInitialPassword('');
                      setInitialPasswordConfirm('');
                      setInitialSetupOpen(false);
                    }}
                  >
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
          Unlock administration and Knowledge Base publishing. Normal operator attribution stays
          passwordless.
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
