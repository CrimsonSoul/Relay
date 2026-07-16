import React, { useEffect, useMemo, useState } from 'react';
import { TactileButton } from '../../TactileButton';
import type { AdministrationPanelProps } from './types';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

type Props = AdministrationPanelProps & { relayMode: 'server' | 'client' | null };

export function PrivilegedAccountsPanel({ snapshot, relayMode }: Readonly<Props>) {
  const [operatorId, setOperatorId] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const operatorNames = useMemo(
    () => new Map(snapshot.operators.map((operator) => [operator.id, operator.displayName])),
    [snapshot.operators],
  );

  useEffect(
    () => () => {
      setPassword('');
      setPasswordConfirm('');
    },
    [],
  );

  const saveCredential = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (password !== passwordConfirm) return setFeedback('Passwords must match.');
    setSaving(true);
    const result = await globalThis.api?.setupPrivilegedCredential({
      operatorId,
      password,
      passwordConfirm,
    });
    setPassword('');
    setPasswordConfirm('');
    setSaving(false);
    setFeedback(
      result?.ok
        ? 'Protected credential updated. Existing paired sessions were revoked.'
        : 'Credential setup could not be completed on this workstation.',
    );
  };

  return (
    <section className="administration-panel" aria-labelledby="accounts-title">
      <header className="administration-panel__header">
        <div>
          <div className="settings-section-heading">Credentials</div>
          <h3 id="accounts-title">Privileged accounts</h3>
          <p>Passwords are stored by Relay’s local identity service and are never shown here.</p>
        </div>
      </header>
      <div className="administration-list">
        {snapshot.privilegedAccounts.map((account) => (
          <div className="administration-row" key={account.accountId}>
            <div className="administration-row__identity">
              <strong>{operatorNames.get(account.operatorId) ?? 'Unknown operator'}</strong>
              <span>
                {account.role === 'admin' ? 'Relay administrator' : 'Knowledge Publisher'}
              </span>
            </div>
            <div className="administration-row__badges">
              <span
                className={`administration-chip administration-chip--${account.credentialState === 'configured' ? 'ok' : 'pending'}`}
              >
                {account.credentialState === 'configured' ? 'CONFIGURED' : 'LOCAL SETUP NEEDED'}
              </span>
            </div>
          </div>
        ))}
      </div>

      {relayMode === 'server' ? (
        <form
          className="administration-credential"
          onSubmit={(event) => void saveCredential(event)}
        >
          <div className="administration-callout">
            <strong>Server-only recovery</strong>
            <span>
              Setting or resetting a credential revokes every paired device for that account.
            </span>
          </div>
          <div className="administration-field-grid">
            <label className="administration-field">
              <span>Privileged operator</span>
              <select
                value={operatorId}
                onChange={(event) => setOperatorId(event.target.value)}
                required
              >
                <option value="">Select account</option>
                {snapshot.privilegedAccounts.map((account) => (
                  <option key={account.accountId} value={account.operatorId}>
                    {operatorNames.get(account.operatorId)}
                  </option>
                ))}
              </select>
            </label>
            <label className="administration-field">
              <span>New password</span>
              <input
                type="password"
                className="tactile-input"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            <label className="administration-field">
              <span>Confirm password</span>
              <input
                type="password"
                className="tactile-input"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                minLength={12}
                maxLength={128}
                required
              />
            </label>
          </div>
          <TactileButton type="submit" variant="primary" loading={saving}>
            Set credential
          </TactileButton>
        </form>
      ) : (
        <div className="administration-callout">
          <strong>Credential recovery stays on the Relay server PC</strong>
          <span>
            Remote laptops can manage roles and devices, but cannot transmit replacement passwords
            to the server.
          </span>
        </div>
      )}
      {feedback && (
        <div className="administration-feedback" role="status">
          {feedback}
        </div>
      )}
    </section>
  );
}
