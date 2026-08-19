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

type ProblemScopeMethod = 'all' | 'profiles' | 'custom-dql';

type ProblemScopeDescription = {
  label: string;
  description: string;
};

function initialProblemScopeMethod(
  profileCount: number,
  customMatcher: string,
): ProblemScopeMethod {
  if (customMatcher) return 'custom-dql';
  return profileCount > 0 ? 'profiles' : 'all';
}

function describeProblemScope(
  method: ProblemScopeMethod,
  profileCount: number,
  customMatcher: string,
): ProblemScopeDescription {
  if (method === 'profiles') {
    let description = 'Select at least one alerting profile before testing or saving this scope.';
    if (profileCount > 0) {
      const profileNoun = profileCount === 1 ? 'profile' : 'profiles';
      description = `${profileCount.toLocaleString()} selected ${profileNoun} are the only scope filter.`;
    }
    return {
      label: 'Alerting profiles',
      description,
    };
  }
  if (method === 'custom-dql') {
    return {
      label: 'Custom DQL',
      description: customMatcher
        ? 'The complete DQL expression is the only filter applied to the problem feed.'
        : 'Paste the complete DQL filter expression before testing or saving this scope.',
    };
  }
  return {
    label: 'All problems',
    description: 'Relay applies no profile or custom DQL filter to the problem feed.',
  };
}

function isProblemScopeReady(
  method: ProblemScopeMethod,
  profileCount: number,
  customMatcher: string,
): boolean {
  if (method === 'profiles') return profileCount > 0;
  if (method === 'custom-dql') return Boolean(customMatcher);
  return true;
}

function describeMatcherChange(nextMatcher: string, storedMatcher: string): string {
  if (nextMatcher === storedMatcher) return 'Unchanged';
  if (!nextMatcher) return 'Removed';
  return storedMatcher ? 'Updated' : 'Added';
}

function ProblemScopeTestStatus({
  testing,
  result,
}: Readonly<{ testing: boolean; result: DynatraceProblemScopeTestResult | null }>) {
  if (testing) {
    return (
      <output className="administration-scope-status">
        <strong>Testing current scope</strong>
        <span>Dynatrace is validating this scope and counting current problems.</span>
      </output>
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
    <output className={`administration-scope-status ${statusClass}`}>
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
    </output>
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
  const storedProfileNames = useMemo(
    () => (Array.isArray(profiles?.valueSummary) ? profiles.valueSummary : []),
    [profiles?.valueSummary],
  );
  const storedCustomDqlMatcher = profiles?.customDqlMatcher ?? '';
  const [scopeMethod, setScopeMethod] = useState<ProblemScopeMethod>(() =>
    initialProblemScopeMethod(storedProfileNames.length, storedCustomDqlMatcher),
  );
  const [selectedProfileNames, setSelectedProfileNames] = useState<string[]>(storedProfileNames);
  const [profileSearch, setProfileSearch] = useState('');
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
  const scopeMethodName = useId();
  const profileHintId = useId();
  const matcherFieldId = useId();
  const matcherHintId = useId();
  const availableProfileNames = useMemo(
    () =>
      [
        ...new Set([
          ...(Array.isArray(profiles?.availableValues) ? profiles.availableValues : []),
          ...storedProfileNames,
        ]),
      ].sort((a, b) => a.localeCompare(b)),
    [profiles?.availableValues, storedProfileNames],
  );
  const filteredProfileNames = useMemo(() => {
    const search = profileSearch.trim().toLocaleLowerCase();
    return search
      ? availableProfileNames.filter((profile) => profile.toLocaleLowerCase().includes(search))
      : availableProfileNames;
  }, [availableProfileNames, profileSearch]);
  const activeProfileNames = scopeMethod === 'profiles' ? selectedProfileNames : [];
  const normalizedCustomDqlMatcher = useMemo(
    () => normalizeDynatraceCustomDqlMatcher(customDqlMatcher),
    [customDqlMatcher],
  );
  const activeCustomDqlMatcher = scopeMethod === 'custom-dql' ? normalizedCustomDqlMatcher : '';
  const addedProfileNames = activeProfileNames.filter(
    (profile) => !storedProfileNames.includes(profile),
  );
  const removedProfileNames = storedProfileNames.filter(
    (profile) => !activeProfileNames.includes(profile),
  );
  const scopeDescription = describeProblemScope(
    scopeMethod,
    activeProfileNames.length,
    activeCustomDqlMatcher,
  );
  const matcherChange = describeMatcherChange(activeCustomDqlMatcher, storedCustomDqlMatcher);
  const scopeReady = isProblemScopeReady(
    scopeMethod,
    activeProfileNames.length,
    activeCustomDqlMatcher,
  );

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
      const result = await execute({
        command: 'administration.setting.replace',
        payload: {
          setting: 'dynatrace.alerting-profiles',
          value: {
            profiles: activeProfileNames,
            customDqlMatcher: activeCustomDqlMatcher,
          },
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
    if (!scopeReady) {
      setScopeTestResult({
        valid: false,
        error:
          scopeMethod === 'profiles'
            ? 'Select at least one alerting profile.'
            : 'Enter the complete DQL filter expression.',
      });
      return;
    }
    const matcherError = getDynatraceCustomDqlMatcherError(activeCustomDqlMatcher);
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
          profiles: activeProfileNames,
          customDqlMatcher: activeCustomDqlMatcher,
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

  const changeScopeMethod = (method: ProblemScopeMethod) => {
    setScopeMethod(method);
    setScopeTestResult(null);
  };

  const toggleProfile = (profile: string) => {
    setSelectedProfileNames((current) =>
      current.includes(profile)
        ? current.filter((candidate) => candidate !== profile)
        : [...current, profile],
    );
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
            Choose one server-owned scope method. Alerting profiles and custom DQL are never
            combined. Problems outside scope are hidden while their notes and local dispositions
            remain stored until normal one-year history expiry.
          </p>
          <fieldset className="administration-scope-method-fieldset">
            <legend>Problem scope method</legend>
            <div className="administration-scope-methods">
              <label
                htmlFor={`${scopeMethodName}-all`}
                className={`administration-scope-method${scopeMethod === 'all' ? ' is-selected' : ''}`}
              >
                <input
                  id={`${scopeMethodName}-all`}
                  type="radio"
                  name={scopeMethodName}
                  value="all"
                  checked={scopeMethod === 'all'}
                  onChange={() => changeScopeMethod('all')}
                />
                <strong>All problems</strong>
                <small>No scope filter</small>
              </label>
              <label
                htmlFor={`${scopeMethodName}-profiles`}
                className={`administration-scope-method${scopeMethod === 'profiles' ? ' is-selected' : ''}`}
              >
                <input
                  id={`${scopeMethodName}-profiles`}
                  type="radio"
                  name={scopeMethodName}
                  value="profiles"
                  checked={scopeMethod === 'profiles'}
                  onChange={() => changeScopeMethod('profiles')}
                />
                <strong>Alerting profiles</strong>
                <small>Select from the discovered list</small>
              </label>
              <label
                htmlFor={`${scopeMethodName}-custom-dql`}
                className={`administration-scope-method${scopeMethod === 'custom-dql' ? ' is-selected' : ''}`}
              >
                <input
                  id={`${scopeMethodName}-custom-dql`}
                  type="radio"
                  name={scopeMethodName}
                  value="custom-dql"
                  checked={scopeMethod === 'custom-dql'}
                  onChange={() => changeScopeMethod('custom-dql')}
                />
                <strong>Custom DQL</strong>
                <small>Use one complete filter expression</small>
              </label>
            </div>
          </fieldset>
          <div className="administration-scope-summary">
            <strong>{scopeDescription.label}</strong>
            <span>{scopeDescription.description}</span>
          </div>
          {scopeMethod === 'profiles' && (
            <div className="administration-profile-picker" aria-describedby={profileHintId}>
              <div className="administration-profile-picker__header">
                <strong>Available alerting profiles</strong>
                <span>{selectedProfileNames.length.toLocaleString()} selected</span>
              </div>
              <label className="administration-field">
                <span>Find an alerting profile</span>
                <input
                  className="tactile-input"
                  type="search"
                  value={profileSearch}
                  onChange={(event) => setProfileSearch(event.target.value)}
                  placeholder="Search discovered profiles"
                  autoComplete="off"
                />
              </label>
              {filteredProfileNames.length > 0 ? (
                <div
                  className="administration-profile-list"
                  role="group"
                  aria-label="Available alerting profiles"
                >
                  {filteredProfileNames.map((profile) => (
                    <label className="administration-profile-option" key={profile}>
                      <input
                        type="checkbox"
                        checked={selectedProfileNames.includes(profile)}
                        onChange={() => toggleProfile(profile)}
                      />
                      <span>{profile}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="administration-empty" role="status">
                  <strong>
                    {availableProfileNames.length > 0
                      ? 'No profiles match this search'
                      : 'No alerting profiles discovered yet'}
                  </strong>
                  <span>
                    {availableProfileNames.length > 0
                      ? 'Clear the search to see the full profile list.'
                      : 'Sync Dynatrace Problems, then refresh administration.'}
                  </span>
                </div>
              )}
              <small id={profileHintId}>
                Relay matches any selected profile exactly. Selecting this mode clears custom DQL.
              </small>
            </div>
          )}
          {scopeMethod === 'custom-dql' && (
            <div className="administration-field">
              <label htmlFor={matcherFieldId}>Complete DQL filter expression</label>
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
                  '(\n  matchesValue(entity_tags, "teams:network")\n  or matchesPhrase(event.name, "Packet loss on")\n)\nand dt.davis.mute.status == "NOT_MUTED"'
                }
              />
              <small id={matcherHintId}>
                Paste everything that belongs inside one filter. Do not include fetch, a leading
                filter pipe, fields, sorting, or limits. Selecting this mode clears alerting
                profiles.
              </small>
            </div>
          )}
          <ProblemScopeTestStatus testing={testingScope} result={scopeTestResult} />
          <div className="administration-actions administration-scope-actions">
            <TactileButton
              type="button"
              disabled={!profiles || !scopeReady}
              loading={testingScope}
              onClick={() => void testProblemScope(false)}
            >
              Test scope
            </TactileButton>
            <TactileButton
              type="submit"
              disabled={!profiles || testingScope || !scopeReady}
              variant="primary"
            >
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
            : scopeDescription.label
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
          {activeCustomDqlMatcher && (
            <pre className="administration-scope-preview">{activeCustomDqlMatcher}</pre>
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
