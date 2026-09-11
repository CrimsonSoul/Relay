import React, { useEffect, useId, useRef, useState } from 'react';
import type { RelayAdministrationSettingSummary } from '@shared/privilegedAccess';
import {
  getDynatraceEnvironmentUrlError,
  normalizeDynatraceOAuthCredentials,
  type DynatraceOAuthCredentials,
} from '@shared/dynatraceProblems';
import { usePrivilegedAccess } from '../../../contexts/PrivilegedAccessContext';
import { Modal } from '../../Modal';
import { TactileButton } from '../../TactileButton';
import type { AdministrationExecute } from './types';
import { DynatraceOAuthFields } from './DynatraceOAuthFields';

const emptyOAuth: DynatraceOAuthCredentials = { clientId: '', clientSecret: '', accountUuid: '' };

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
  const [oauth, setOAuth] = useState<DynatraceOAuthCredentials>(emptyOAuth);
  const [tokenConfirming, setTokenConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [clearing, setClearing] = useState(false);
  const [submittingToken, setSubmittingToken] = useState(false);
  const submittingTokenRef = useRef(false);
  const tokenBusy = submittingToken || busy === 'reauthenticate';
  const tokenFormId = useId();
  const needsEnvironment = environment?.configured === false;
  const environmentError = getDynatraceEnvironmentUrlError(environmentUrl);
  const normalizedOAuth = normalizeDynatraceOAuthCredentials(oauth);
  const credentialsReady = normalizedOAuth !== null;

  useEffect(
    () => () => {
      setOAuth(emptyOAuth);
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
    if (
      submittingTokenRef.current ||
      !token ||
      (!clearing && (!credentialsReady || (needsEnvironment && environmentError)))
    )
      return;
    submittingTokenRef.current = true;
    setSubmittingToken(true);
    try {
      const replacement = { oauth: normalizedOAuth! };
      const proof = await reauthenticate(password);
      setPassword('');
      setOAuth(emptyOAuth);
      if (!proof) {
        setTokenConfirming(false);
        onFeedback(
          'Authentication was not confirmed. Sign in if needed, then enter the credentials again to retry.',
        );
        return;
      }
      const result = await execute({
        command: 'administration.setting.replace',
        payload: {
          setting: 'dynatrace.platform-token',
          value: clearing
            ? { clear: true }
            : {
                ...replacement,
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
        onFeedback(
          clearing
            ? 'Dynatrace Problems disabled and stored configuration removed.'
            : 'Dynatrace OAuth client verified and saved.',
        );
      }
    } finally {
      submittingTokenRef.current = false;
      setSubmittingToken(false);
    }
  };

  const closeTokenConfirmation = () => {
    if (submittingTokenRef.current) return;
    setPassword('');
    setOAuth(emptyOAuth);
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
            For first-time setup, enter the URL here and credentials below, then review the
            replacement to save both together.
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
          <strong>OAuth client</strong>
          <span
            className={`administration-chip administration-chip--${token?.configured ? 'ok' : 'pending'}`}
          >
            {token?.authenticationMode === 'platform-token'
              ? 'OAuth setup required'
              : (token?.summary ?? 'Unavailable')}
          </span>
        </div>
        <p>Stored credentials can never be revealed. Enter a complete replacement.</p>
        {token?.authenticationMode === 'platform-token' && (
          <p>
            This connection uses a retired platform token. Enter OAuth credentials to resume
            Dynatrace syncing. Existing problems, notes, and problem scope are retained.
          </p>
        )}
        <DynatraceOAuthFields value={oauth} onChange={setOAuth} />
        {oauth.clientId && oauth.clientSecret && oauth.accountUuid && !normalizedOAuth && (
          <p role="alert">
            Enter a valid client ID, client secret without spaces, and account UUID.
          </p>
        )}
        <TactileButton
          variant="primary"
          disabled={!token || !credentialsReady || (needsEnvironment && Boolean(environmentError))}
          onClick={() => {
            setClearing(false);
            setTokenConfirming(true);
          }}
        >
          Review OAuth replacement
        </TactileButton>
        {token?.configured && (
          <TactileButton
            onClick={() => {
              setClearing(true);
              setTokenConfirming(true);
            }}
          >
            Disable Dynatrace Problems
          </TactileButton>
        )}
      </div>

      <Modal
        isOpen={tokenConfirming}
        onClose={closeTokenConfirmation}
        title={
          clearing ? 'Confirm disabling Dynatrace Problems' : 'Confirm OAuth client replacement'
        }
        subtitle="Secret replacement"
        variant="standard"
        dismissible={!tokenBusy}
        footer={
          <>
            <TactileButton
              type="button"
              variant="secondary"
              onClick={closeTokenConfirmation}
              disabled={tokenBusy}
            >
              Cancel
            </TactileButton>
            <TactileButton
              type="submit"
              form={tokenFormId}
              variant="primary"
              loading={tokenBusy}
              aria-busy={tokenBusy}
              disabled={!clearing && !credentialsReady}
            >
              {clearing ? 'Disable Dynatrace Problems' : 'Verify and save OAuth client'}
            </TactileButton>
          </>
        }
      >
        <form
          id={tokenFormId}
          className="administration-dialog-form"
          onSubmit={(event) => void replaceToken(event)}
        >
          <p>
            {clearing
              ? 'Relay will stop syncing problems and remove the stored URL, credentials, and problem scope.'
              : 'Relay will discard the prior credentials after the replacement is accepted.'}
          </p>
          {needsEnvironment && (
            <p>
              Set up Dynatrace for <code>{environmentUrl}</code>.
            </p>
          )}
          <label className="administration-field">
            <span>Administrator password</span>
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
        </form>
      </Modal>
    </>
  );
}
