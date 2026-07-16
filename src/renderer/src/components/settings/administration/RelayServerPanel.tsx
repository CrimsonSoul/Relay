import React, { useEffect, useMemo, useState } from 'react';
import { usePrivilegedAccess } from '../../../contexts/PrivilegedAccessContext';
import { TactileButton } from '../../TactileButton';
import type { AdministrationPanelProps } from './types';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

export function RelayServerPanel({ snapshot, execute }: Readonly<AdministrationPanelProps>) {
  const { reauthenticate, busy } = usePrivilegedAccess();
  const settings = useMemo(
    () => new Map(snapshot.settings.map((setting) => [setting.setting, setting])),
    [snapshot.settings],
  );
  const environment = settings.get('dynatrace.environment-url');
  const token = settings.get('dynatrace.platform-token');
  const profiles = settings.get('dynatrace.alerting-profiles');
  const [environmentUrl, setEnvironmentUrl] = useState('');
  const [platformToken, setPlatformToken] = useState('');
  const [profileText, setProfileText] = useState(
    Array.isArray(profiles?.valueSummary) ? profiles.valueSummary.join('\n') : '',
  );
  const [tokenConfirming, setTokenConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

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
      setFeedback('Dynatrace environment URL updated.');
    }
  };

  const replaceProfiles = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (!profiles) return;
    const selectedProfiles = profileText
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    const result = await execute({
      command: 'administration.setting.replace',
      payload: {
        setting: 'dynatrace.alerting-profiles',
        value: { profiles: selectedProfiles },
        expectedRevision: profiles.revision,
      },
      expectedRevision: null,
    });
    if (result.ok) setFeedback('Dynatrace alerting profile filter updated.');
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
      setFeedback('Dynatrace platform token replaced.');
    }
  };

  return (
    <section className="administration-panel" aria-labelledby="relay-server-title">
      <header className="administration-panel__header">
        <div>
          <div className="settings-section-heading">Server</div>
          <h3 id="relay-server-title">Relay & Dynatrace</h3>
          <p>Only typed, path-independent settings can be changed remotely.</p>
        </div>
      </header>
      <div className="administration-setting-grid">
        <form
          className="administration-setting"
          onSubmit={(event) => void replaceEnvironment(event)}
        >
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

        <form
          className="administration-setting administration-setting--wide"
          onSubmit={(event) => void replaceProfiles(event)}
        >
          <div className="administration-setting__heading">
            <strong>Alerting profiles</strong>
            <span
              className={`administration-chip administration-chip--${profiles?.configured ? 'ok' : 'pending'}`}
            >
              {profiles?.summary ?? 'Unavailable'}
            </span>
          </div>
          <label className="administration-field">
            <span>Selected profile names · one per line</span>
            <textarea
              className="tactile-input"
              value={profileText}
              onChange={(event) => setProfileText(event.target.value)}
              rows={5}
            />
          </label>
          <TactileButton type="submit" disabled={!profiles} variant="primary">
            Save profile filter
          </TactileButton>
        </form>
      </div>
      <div className="administration-callout">
        <strong>Local-only maintenance boundary</strong>
        <span>
          Connection paths, backups, restores, folder pickers, and executable selection remain
          available only on the Relay server PC.
        </span>
      </div>
      {feedback && (
        <div className="administration-feedback" role="status">
          {feedback}
        </div>
      )}

      {tokenConfirming && (
        <div className="administration-dialog-backdrop">
          <form
            className="administration-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="token-confirm-title"
            onSubmit={(event) => void replaceToken(event)}
          >
            <div className="settings-section-heading">Secret replacement</div>
            <h4 id="token-confirm-title">Confirm platform token replacement</h4>
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
            <div className="administration-actions">
              <TactileButton type="submit" variant="primary" loading={busy === 'reauthenticate'}>
                Replace token
              </TactileButton>
              <TactileButton
                type="button"
                onClick={() => {
                  setPassword('');
                  setPlatformToken('');
                  setTokenConfirming(false);
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
