import React, { useEffect, useId, useState } from 'react';
import type { RelayAdministrationSettingSummary } from '@shared/privilegedAccess';
import { usePrivilegedAccess } from '../../../contexts/PrivilegedAccessContext';
import { Modal } from '../../Modal';
import { TactileButton } from '../../TactileButton';
import type { AdministrationExecute } from './types';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

type DynatraceConnectionSettingsProps = {
  environment: RelayAdministrationSettingSummary | undefined;
  token: RelayAdministrationSettingSummary | undefined;
  execute: AdministrationExecute;
  onFeedback: (message: string) => void;
};

export function DynatraceConnectionSettings({
  environment,
  token,
  execute,
  onFeedback,
}: Readonly<DynatraceConnectionSettingsProps>) {
  const { reauthenticate, busy } = usePrivilegedAccess();
  const [environmentUrl, setEnvironmentUrl] = useState('');
  const [platformToken, setPlatformToken] = useState('');
  const [tokenConfirming, setTokenConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const tokenFormId = useId();

  useEffect(
    () => () => {
      setPlatformToken('');
      setPassword('');
    },
    [],
  );

  const replaceEnvironment = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (!environment) return;
    const result = await execute({
      command: 'administration.setting.replace',
      payload: {
        setting: 'dynatrace.environment-url',
        value: { environmentUrl },
        expectedRevision: environment.revision,
      },
      expectedRevision: null,
    });
    if (result.ok) {
      setEnvironmentUrl('');
      onFeedback('Dynatrace environment URL updated.');
    }
  };

  const replaceToken = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (!token) return;
    const replacement = platformToken;
    const proof = await reauthenticate(password);
    setPassword('');
    setPlatformToken('');
    if (!proof) return;
    const result = await execute({
      command: 'administration.setting.replace',
      payload: {
        setting: 'dynatrace.platform-token',
        value: { apiToken: replacement },
        expectedRevision: token.revision,
        reauthRequestId: proof.proofId,
      },
      expectedRevision: null,
    });
    if (result.ok) {
      setTokenConfirming(false);
      onFeedback('Dynatrace platform token replaced.');
    }
  };

  const closeTokenConfirmation = () => {
    setPassword('');
    setPlatformToken('');
    setTokenConfirming(false);
  };

  return (
    <>
      <form className="administration-setting" onSubmit={(event) => void replaceEnvironment(event)}>
        <div className="administration-setting__heading">
          <strong>Environment URL</strong>
          <span
            className={`administration-chip administration-chip--${environment?.configured ? 'ok' : 'pending'}`}
          >
            {environment?.summary ?? 'Unavailable'}
          </span>
        </div>
        {typeof environment?.valueSummary === 'string' && <code>{environment.valueSummary}</code>}
        <label className="administration-field">
          <span>Replacement URL</span>
          <input
            className="tactile-input"
            type="url"
            value={environmentUrl}
            onChange={(event) => setEnvironmentUrl(event.target.value)}
            placeholder="https://abc123.apps.dynatrace.com"
            required
          />
        </label>
        <TactileButton type="submit" disabled={!environment} variant="primary">
          Replace URL
        </TactileButton>
      </form>

      <div className="administration-setting">
        <div className="administration-setting__heading">
          <strong>Platform token</strong>
          <span
            className={`administration-chip administration-chip--${token?.configured ? 'ok' : 'pending'}`}
          >
            {token?.summary ?? 'Unavailable'}
          </span>
        </div>
        <p>The current token can never be revealed. Enter a complete replacement.</p>
        <label className="administration-field">
          <span>Replacement platform token</span>
          <input
            className="tactile-input"
            type="password"
            value={platformToken}
            onChange={(event) => setPlatformToken(event.target.value)}
            autoComplete="off"
          />
        </label>
        <TactileButton
          variant="primary"
          disabled={!token || !platformToken}
          onClick={() => setTokenConfirming(true)}
        >
          Review token replacement
        </TactileButton>
      </div>

      <Modal
        isOpen={tokenConfirming}
        onClose={closeTokenConfirmation}
        title="Confirm platform token replacement"
        subtitle="Secret replacement"
        variant="standard"
        dismissible={busy !== 'reauthenticate'}
        footer={
          <>
            <TactileButton
              type="button"
              variant="secondary"
              onClick={closeTokenConfirmation}
              disabled={busy === 'reauthenticate'}
            >
              Cancel
            </TactileButton>
            <TactileButton
              type="submit"
              form={tokenFormId}
              variant="primary"
              loading={busy === 'reauthenticate'}
            >
              Replace token
            </TactileButton>
          </>
        }
      >
        <form
          id={tokenFormId}
          className="administration-dialog-form"
          onSubmit={(event) => void replaceToken(event)}
        >
          <p>Relay will discard the prior token after the replacement is accepted.</p>
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
        </form>
      </Modal>
    </>
  );
}
