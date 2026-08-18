import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  MAX_DYNATRACE_CUSTOM_DQL_MATCHER_LENGTH,
  getDynatraceCustomDqlMatcherError,
  normalizeDynatraceCustomDqlMatcher,
  normalizeDynatraceProblemScopeTestResult,
  type DynatraceProblemScopeTestResult,
} from '@shared/dynatraceProblems';
import { usePrivilegedAccess } from '../../../contexts/PrivilegedAccessContext';
import { Modal } from '../../Modal';
import { TactileButton } from '../../TactileButton';
import type { AdministrationPanelProps } from './types';

type FormSubmitEvent = Parameters<NonNullable<React.ComponentProps<'form'>['onSubmit']>>[0];

type ProblemScopeMode = {
  label: string;
  description: string;
};

function describeProblemScope(profileCount: number, customMatcher: string): ProblemScopeMode {
  if (profileCount > 0 && customMatcher) {
    return {
      label: 'Profiles + custom DQL',
      description: 'Profiles and custom DQL are combined with AND.',
    };
  }
  if (profileCount > 0) {
    return {
      label: 'Alerting profiles only',
      description: 'Only problems in the selected alerting profiles appear in Relay.',
    };
  }
  if (customMatcher) {
    return {
      label: 'Custom DQL only',
      description: 'The custom DQL matcher controls which problems appear in Relay.',
    };
  }
  return {
    label: 'Unfiltered',
    description: 'Leave both fields empty to restore the unfiltered problem feed.',
  };
}

function describeMatcherChange(nextMatcher: string, storedMatcher: string): string {
  if (nextMatcher === storedMatcher) return 'Unchanged';
  if (!nextMatcher) return 'Removed';
  return storedMatcher ? 'Updated' : 'Added';
}

function problemScopeReplacementValue(
  profiles: string[],
  nextMatcher: string,
  storedMatcher: string,
): { profiles: string[]; customDqlMatcher?: string } {
  if (nextMatcher || storedMatcher) return { profiles, customDqlMatcher: nextMatcher };
  return { profiles };
}

function ProblemScopeTestStatus({
  testing,
  result,
}: Readonly<{ testing: boolean; result: DynatraceProblemScopeTestResult | null }>) {
  if (testing) {
    return (
      <div className="administration-scope-status" role="status">
        <strong>Testing current scope</strong>
        <span>Dynatrace is validating the matcher and counting current problems.</span>
      </div>
    );
  }
  if (!result) return null;
  if (!result.valid) {
    return (
      <div className="administration-scope-status administration-scope-status--error" role="alert">
        <strong>Scope needs attention</strong>
        <span>{result.error}</span>
      </div>
    );
  }

  const zeroMatches = result.problemCount === 0;
  const statusClass = zeroMatches
    ? 'administration-scope-status--warning'
    : 'administration-scope-status--ok';
  return (
    <div className={`administration-scope-status ${statusClass}`} role="status">
      <strong>
        {zeroMatches
          ? 'Valid scope · no current problems match'
          : `Valid scope · ${result.problemCount.toLocaleString()} current problems match`}
      </strong>
      <span>
        {zeroMatches
          ? 'Saving will hide all currently visible problems. Stored history and notes remain intact.'
          : 'This preview uses the same server-owned scope Relay will save.'}
      </span>
    </div>
  );
}

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
  const storedCustomDqlMatcher = profiles?.customDqlMatcher ?? '';
  const [customDqlMatcher, setCustomDqlMatcher] = useState(storedCustomDqlMatcher);
  const [scopeTestResult, setScopeTestResult] = useState<DynatraceProblemScopeTestResult | null>(
    null,
  );
  const [testingScope, setTestingScope] = useState(false);
  const testingScopeRef = useRef(false);
  const [profileConfirming, setProfileConfirming] = useState(false);
  const [applyingProfiles, setApplyingProfiles] = useState(false);
  const applyingProfilesRef = useRef(false);
  const [tokenConfirming, setTokenConfirming] = useState(false);
  const [password, setPassword] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const tokenFormId = useId();
  const profileFieldId = useId();
  const profileHintId = useId();
  const matcherFieldId = useId();
  const matcherHintId = useId();
  const selectedProfileNames = useMemo(
    () =>
      profileText
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
    [profileText],
  );
  const storedProfileNames = useMemo(
    () => (Array.isArray(profiles?.valueSummary) ? profiles.valueSummary : []),
    [profiles?.valueSummary],
  );
  const addedProfileNames = selectedProfileNames.filter(
    (profile) => !storedProfileNames.includes(profile),
  );
  const removedProfileNames = storedProfileNames.filter(
    (profile) => !selectedProfileNames.includes(profile),
  );
  const normalizedCustomDqlMatcher = useMemo(
    () => normalizeDynatraceCustomDqlMatcher(customDqlMatcher),
    [customDqlMatcher],
  );
  const scopeMode = describeProblemScope(selectedProfileNames.length, normalizedCustomDqlMatcher);
  const matcherChange = describeMatcherChange(normalizedCustomDqlMatcher, storedCustomDqlMatcher);

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

  const replaceProblemScope = async () => {
    if (!profiles || applyingProfilesRef.current) return;
    applyingProfilesRef.current = true;
    setApplyingProfiles(true);
    try {
      const value = problemScopeReplacementValue(
        selectedProfileNames,
        normalizedCustomDqlMatcher,
        storedCustomDqlMatcher,
      );
      const result = await execute({
        command: 'administration.setting.replace',
        payload: {
          setting: 'dynatrace.alerting-profiles',
          value,
          expectedRevision: profiles.revision,
        },
        expectedRevision: null,
      });
      if (result.ok) {
        setProfileConfirming(false);
        setFeedback('Stored Dynatrace problem scope updated.');
      }
    } finally {
      applyingProfilesRef.current = false;
      setApplyingProfiles(false);
    }
  };

  const testProblemScope = async (openReview: boolean) => {
    if (!profiles || testingScopeRef.current) return;
    const matcherError = getDynatraceCustomDqlMatcherError(customDqlMatcher);
    if (matcherError) {
      setScopeTestResult({ valid: false, error: matcherError });
      return;
    }

    testingScopeRef.current = true;
    setTestingScope(true);
    setScopeTestResult(null);
    try {
      const result = await execute({
        command: 'administration.dynatrace-problem-scope.test',
        payload: {
          profiles: selectedProfileNames,
          customDqlMatcher: normalizedCustomDqlMatcher,
        },
        expectedRevision: null,
      });
      if (!result.ok) {
        setScopeTestResult({
          valid: false,
          error: 'Relay could not test this scope. Review the administration error and try again.',
        });
        return;
      }
      const tested = normalizeDynatraceProblemScopeTestResult(result.value);
      if (!tested) {
        setScopeTestResult({
          valid: false,
          error: 'Relay returned an invalid scope test result. Refresh and try again.',
        });
        return;
      }
      setScopeTestResult(tested);
      if (tested.valid && openReview) setProfileConfirming(true);
    } finally {
      testingScopeRef.current = false;
      setTestingScope(false);
    }
  };

  const changeProfileText = (value: string) => {
    setProfileText(value);
    setScopeTestResult(null);
  };

  const changeCustomDqlMatcher = (value: string) => {
    setCustomDqlMatcher(value);
    setScopeTestResult(null);
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

  const closeTokenConfirmation = () => {
    setPassword('');
    setPlatformToken('');
    setTokenConfirming(false);
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
          onSubmit={(event) => {
            event.preventDefault();
            void testProblemScope(true);
          }}
          aria-busy={testingScope}
        >
          <div className="administration-setting__heading">
            <strong>Stored problem scope</strong>
            <span
              className={`administration-chip administration-chip--${profiles?.configured ? 'ok' : 'pending'}`}
            >
              {profiles?.summary ?? 'Unavailable'}
            </span>
          </div>
          <p>
            Restrict the server-owned feed with alerting profiles, a custom DQL matcher, or both.
            Problems outside scope are hidden while their notes and local dispositions remain stored
            until normal one-year history expiry.
          </p>
          <div className="administration-scope-summary">
            <strong>{scopeMode.label}</strong>
            <span>{scopeMode.description}</span>
          </div>
          <div className="administration-scope-grid">
            <div className="administration-field">
              <label htmlFor={profileFieldId}>Selected alerting profiles · one per line</label>
              <textarea
                id={profileFieldId}
                className="tactile-input"
                value={profileText}
                onChange={(event) => changeProfileText(event.target.value)}
                rows={8}
                aria-describedby={profileHintId}
              />
              <small id={profileHintId}>Optional. Profile names are matched exactly.</small>
            </div>
            <div className="administration-field">
              <label htmlFor={matcherFieldId}>Custom DQL matcher</label>
              <textarea
                id={matcherFieldId}
                className="tactile-input administration-dql-input"
                value={customDqlMatcher}
                onChange={(event) => changeCustomDqlMatcher(event.target.value)}
                rows={8}
                maxLength={MAX_DYNATRACE_CUSTOM_DQL_MATCHER_LENGTH}
                aria-describedby={matcherHintId}
                aria-invalid={scopeTestResult?.valid === false}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                placeholder={
                  'matchesValue(entity_tags, "teams:network")\nand dt.davis.mute.status == "NOT_MUTED"'
                }
              />
              <small id={matcherHintId}>
                Expression only. Do not include fetch, filter pipes, fields, sorting, or limits.
              </small>
            </div>
          </div>
          <ProblemScopeTestStatus testing={testingScope} result={scopeTestResult} />
          <div className="administration-actions administration-scope-actions">
            <TactileButton
              type="button"
              disabled={!profiles}
              loading={testingScope}
              onClick={() => void testProblemScope(false)}
            >
              Test scope
            </TactileButton>
            <TactileButton type="submit" disabled={!profiles || testingScope} variant="primary">
              Review scope change
            </TactileButton>
          </div>
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

      <Modal
        isOpen={profileConfirming}
        onClose={() => {
          if (!applyingProfilesRef.current) setProfileConfirming(false);
        }}
        title="Review stored problem scope"
        subtitle={
          scopeTestResult?.valid
            ? `${scopeTestResult.problemCount.toLocaleString()} current problems match`
            : scopeMode.label
        }
        variant="standard"
        dismissible={!applyingProfiles}
        footer={
          <>
            <TactileButton
              type="button"
              variant="secondary"
              onClick={() => setProfileConfirming(false)}
              disabled={applyingProfiles}
            >
              Cancel
            </TactileButton>
            <TactileButton
              type="button"
              variant="primary"
              loading={applyingProfiles}
              onClick={() => void replaceProblemScope()}
            >
              Apply stored scope
            </TactileButton>
          </>
        }
      >
        <div className="administration-dialog-form">
          <p>
            This changes which problems appear in Relay. Existing problem records, notes and local
            dispositions are preserved; only normal one-year history expiry removes them.
          </p>
          <div className="administration-callout">
            <strong>Added ({addedProfileNames.length})</strong>
            <span>{addedProfileNames.join(', ') || 'None'}</span>
          </div>
          <div className="administration-callout">
            <strong>Removed ({removedProfileNames.length})</strong>
            <span>{removedProfileNames.join(', ') || 'None'}</span>
          </div>
          <div className="administration-callout">
            <strong>Custom DQL matcher</strong>
            <span>{matcherChange}</span>
          </div>
          {normalizedCustomDqlMatcher && (
            <pre className="administration-scope-preview">{normalizedCustomDqlMatcher}</pre>
          )}
        </div>
      </Modal>

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
    </section>
  );
}
