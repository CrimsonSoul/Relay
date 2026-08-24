import React, { useEffect, useState } from 'react';
import type { PrivilegedPairingChallengeTarget } from '@shared/ipc';
import type {
  PrivilegedPairingChallengeView,
  PrivilegedSessionView,
} from '@shared/privilegedAccess';
import type { PrivilegedAccessContextValue } from '../../../contexts/PrivilegedAccessContext';
import { TactileButton } from '../../TactileButton';

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

export function PrivilegedActiveSession({
  session,
  relayMode,
  busy,
  commandBusy,
  pairingTargets,
  pairingChallenge,
  administrationLoading,
  onLogout,
  onCreatePairingChallenge,
}: Readonly<{
  session: PrivilegedSessionView;
  relayMode: 'server' | 'client' | null;
  busy: PrivilegedAccessContextValue['busy'];
  commandBusy: boolean;
  pairingTargets: PrivilegedPairingChallengeTarget[];
  pairingChallenge: PrivilegedPairingChallengeView | null;
  administrationLoading: boolean;
  onLogout: PrivilegedAccessContextValue['logout'];
  onCreatePairingChallenge: PrivilegedAccessContextValue['createPairingChallenge'];
}>) {
  const [pairingTargetAccountId, setPairingTargetAccountId] = useState('');

  useEffect(() => {
    setPairingTargetAccountId((current) => {
      if (pairingTargets.some(({ accountId }) => accountId === current)) return current;
      return (
        pairingTargets.find(({ role }) => role === 'owner' || role === 'admin')?.accountId ?? ''
      );
    });
  }, [pairingTargets]);

  if (!session.role || !session.displayName || !session.username) return null;

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
          <TactileButton
            type="button"
            onClick={() => void onLogout()}
            disabled={busy !== null || commandBusy}
          >
            Sign out
          </TactileButton>
        </div>
      </div>

      {canPair && relayMode === 'server' && (
        <div className="privileged-access__pairing-console">
          <div>
            <strong>Pair a protected workstation</strong>
            <span>Choose its account. Challenge codes expire after 10 minutes and work once.</span>
          </div>
          <div className="privileged-access__pairing-actions">
            <label className="privileged-access__field">
              <span>Workstation owner</span>
              <select
                className="tactile-input"
                value={pairingTargetAccountId}
                onChange={(event) => setPairingTargetAccountId(event.target.value)}
                disabled={administrationLoading || pairingTargets.length === 0}
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
              onClick={() => void onCreatePairingChallenge(pairingTargetAccountId)}
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
