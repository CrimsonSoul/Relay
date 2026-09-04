import React, { useEffect, useId, useState } from 'react';
import type { RelayAdministrationSettingSummary } from '@shared/privilegedAccess';
import { getDynatraceEnvironmentUrlError } from '@shared/dynatraceProblems';
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
  const needsEnvironment = environment?.configured === false;
  const environmentError = getDynatraceEnvironmentUrlError(environmentUrl);

  useEffect(
    () => () => {
      setPlatformToken('');
      setPassword('');
    },
    [],
  );

  const replaceEnvironment = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (!environment || !token?.configured) return;
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
    if (!token || !platformToken.trim() || (needsEnvironment && environmentError)) return;
    const replacement = platformToken;
    const proof = await reauthenticate(password);
    setPassword('');
    setPlatformToken('');
    if (!proof) {
      setTokenConfirming(false);
      onFeedback(
        'Authentication was not confirmed. Sign in if needed, then enter the token again to retry.',
      );
      return;
    }
    const result = await execute({
      command: 'administration.setting.replace',
      payload: {
        setting: 'dynatrace.platform-token',
        value: {
          apiToken: replacement,
          ...(needsEnvironment ? { environmentUrl } : {}),
        },
        expectedRevision: token.revision,
        reauthRequestId: proof.proofId,
      },
      expectedRevision: null,
    });
    setTokenConfirming(false);
    if (result.ok) {
      if (needsEnvironment) setEnvironmentUrl('');
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
        {needsEnvironment && (
          <p>
            For first-time setup, enter the URL here and a platform token below, then review the
            token replacement to save both together.
          </p>
        )}
        <label className="administration-field">
          <span>Replacement URL</span>
          <input
            className="tactile-input"
            type="url"
            value={environmentUrl}
            onChange={(event) => setEnvironmentUrl(event.target.value)}
            placeholder="https://abc123.apps.dynatrace.com"
            required
            aria-invalid={Boolean(environmentUrl && environmentError)}
          />
        </label>
        {environmentUrl && environmentError && <p role="alert">{environmentError}</p>}
        <TactileButton
          type="submit"
          disabled={!environment || !token?.configured || Boolean(environmentError)}
          variant="primary"
        >
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
          disabled={
            !token || !platformToken.trim() || (needsEnvironment && Boolean(environmentError))
          }
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
              disabled={!platformToken.trim()}
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
          {needsEnvironment && (
            <p>
              Set up Dynatrace for <code>{environmentUrl}</code>.
            </p>
          )}
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
