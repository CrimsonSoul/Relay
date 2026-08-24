import React, { useState } from 'react';
import type { PrivilegedAccessContextValue } from '../../../contexts/PrivilegedAccessContext';
import { TactileButton } from '../../TactileButton';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

export function PrivilegedPairingForm({
  busy,
  onComplete,
  onLogout,
}: Readonly<{
  busy: PrivilegedAccessContextValue['busy'];
  onComplete: PrivilegedAccessContextValue['completePairing'];
  onLogout: PrivilegedAccessContextValue['logout'];
}>) {
  const [challengeId, setChallengeId] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');

  const submit = async (event: FormSubmitEvent) => {
    event.preventDefault();
    const paired = await onComplete({
      challengeId: challengeId.trim(),
      code: pairingCode.trim().toUpperCase(),
      deviceLabel: deviceLabel.trim(),
    });
    if (paired) setPairingCode('');
  };

  return (
    <form className="privileged-access__form" onSubmit={(event) => void submit(event)}>
      <div className="privileged-access__state">
        <strong>Pair this workstation</strong>
        <span>Create a one-time challenge on the Relay server, then enter it here.</span>
      </div>
      <div className="privileged-access__field-grid">
        <label className="privileged-access__field">
          <span>Pairing challenge ID</span>
          <input
            className="tactile-input"
            value={challengeId}
            onChange={(event) => setChallengeId(event.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <label className="privileged-access__field">
          <span>One-time pairing code</span>
          <input
            className="tactile-input privileged-access__code"
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
            className="tactile-input"
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
        <TactileButton type="button" onClick={() => void onLogout()} disabled={busy !== null}>
          Sign out
        </TactileButton>
      </div>
    </form>
  );
}
