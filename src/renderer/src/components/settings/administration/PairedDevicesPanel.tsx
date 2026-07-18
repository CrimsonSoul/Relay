import React, { useEffect, useState } from 'react';
import { usePrivilegedAccess } from '../../../contexts/PrivilegedAccessContext';
import { TactileButton } from '../../TactileButton';
import type { AdministrationPanelProps } from './types';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

export function PairedDevicesPanel({ snapshot, execute }: Readonly<AdministrationPanelProps>) {
  const { reauthenticate, busy } = usePrivilegedAccess();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [revokeId, setRevokeId] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  useEffect(() => () => setPassword(''), []);
  const revokeTarget = snapshot.devices.find((device) => device.deviceId === revokeId) ?? null;

  const rename = async (deviceId: string, expectedRevision: number) => {
    const result = await execute({
      command: 'privileged.device.rename',
      payload: { deviceId, label, expectedRevision },
      expectedRevision: null,
    });
    if (result.ok) setEditingId(null);
  };

  const revoke = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (!revokeTarget) return;
    const proof = await reauthenticate(password);
    setPassword('');
    if (!proof) return;
    const result = await execute({
      command: 'privileged.device.revoke',
      payload: {
        deviceId: revokeTarget.deviceId,
        expectedRevision: revokeTarget.revision,
        reauthRequestId: proof.proofId,
      },
      expectedRevision: null,
    });
    if (result.ok) setRevokeId(null);
  };

  return (
    <section className="administration-panel" aria-labelledby="devices-title">
      <header className="administration-panel__header">
        <div>
          <div className="settings-section-heading">Trust</div>
          <h3 id="devices-title">Paired workstations</h3>
          <p>Revoked devices must be paired again from the Relay server.</p>
        </div>
        <span className="administration-panel__metric">
          {snapshot.devices.filter((device) => device.state === 'active').length} active
        </span>
      </header>
      <div className="administration-list">
        {snapshot.devices.length === 0 && (
          <div className="administration-empty">No paired workstations.</div>
        )}
        {snapshot.devices.map((device) => (
          <div className="administration-row" key={device.id}>
            <div className="administration-row__identity">
              {editingId === device.deviceId ? (
                <input
                  autoFocus
                  className="tactile-input"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  maxLength={80}
                />
              ) : (
                <strong>{device.label}</strong>
              )}
              <span>
                {device.displayName} · {device.hostname} · …{device.fingerprintSuffix}
              </span>
            </div>
            <div className="administration-row__badges">
              <span
                className={`administration-chip administration-chip--${device.state === 'active' ? 'ok' : 'pending'}`}
              >
                {device.state.toUpperCase()}
              </span>
            </div>
            <div className="administration-row__actions">
              {editingId === device.deviceId ? (
                <TactileButton
                  size="sm"
                  variant="primary"
                  onClick={() => void rename(device.deviceId, device.revision)}
                >
                  Save
                </TactileButton>
              ) : (
                <TactileButton
                  size="sm"
                  onClick={() => {
                    setEditingId(device.deviceId);
                    setLabel(device.label);
                  }}
                  disabled={device.state !== 'active'}
                >
                  Rename
                </TactileButton>
              )}
              <TactileButton
                size="sm"
                onClick={() => setRevokeId(device.deviceId)}
                disabled={device.state !== 'active'}
              >
                Revoke
              </TactileButton>
            </div>
          </div>
        ))}
      </div>

      {revokeTarget && (
        <div className="administration-dialog-backdrop">
          <form
            className="administration-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="device-revoke-title"
            onSubmit={(event) => void revoke(event)}
          >
            <div className="settings-section-heading">Device trust</div>
            <h4 id="device-revoke-title">Revoke {revokeTarget.label}?</h4>
            <p>Protected commands from this workstation will stop immediately.</p>
            <label className="administration-field">
              <span>Administrator password</span>
              <input
                autoFocus
                type="password"
                className="tactile-input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <div className="administration-actions">
              <TactileButton type="submit" variant="danger" loading={busy === 'reauthenticate'}>
                Revoke device
              </TactileButton>
              <TactileButton
                type="button"
                onClick={() => {
                  setPassword('');
                  setRevokeId(null);
                }}
              >
                Cancel
              </TactileButton>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
