import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import type {
  RelayRecoveryBuildStatus,
  RelayRecoveryBuildView,
  RelayRecoveryState,
} from '@shared/recovery';
import { usePrivilegedAccess } from '../../contexts/PrivilegedAccessContext';
import { TactileButton } from '../TactileButton';

const STATUS_LABELS: Record<RelayRecoveryBuildStatus, string> = {
  ready: 'Ready',
  'runtime-missing': 'Runtime needs repair',
  'snapshot-missing': 'Server snapshot unavailable',
  'data-incompatible': 'Data format incompatible',
};

type RecoveryAction = 'repair' | 'rollback';
type RecoveryFeedback = { tone: 'error' | 'success'; message: string };

function isActionAvailable(action: RecoveryAction, build: RelayRecoveryBuildView): boolean {
  if (action === 'repair') return build.repairAvailable;
  return build.rollbackAvailable;
}

function recoveryFailureMessage(action: RecoveryAction, error?: string): string {
  if (error === 'rate-limited') return 'Too many password attempts. Wait a minute and try again.';
  if (error === 'unauthorized') return 'The Owner password was not accepted.';
  if (action === 'repair') {
    return 'Relay could not repair that runtime from its published release.';
  }
  return 'Relay could not prepare that rollback safely.';
}

function recoveryHeadingLabel(state: RelayRecoveryState): string | null {
  if (state.fallbackActive && state.runningVersion) {
    return `Recovery runtime · v${state.runningVersion}`;
  }
  return state.currentVersion ? `Current · v${state.currentVersion}` : null;
}

function confirmationTitle(action: RecoveryAction, version: string): string {
  if (action === 'repair') return `Repair retained v${version}?`;
  return `Roll back this workstation to v${version}?`;
}

function confirmationDescription(
  action: RecoveryAction,
  mode: RelayRecoveryState['mode'],
  version: string,
): string {
  if (action === 'repair') {
    return `Relay will verify and restore the runtime from the exact immutable v${version} release. The active version and data stay unchanged.`;
  }
  if (mode === 'server') {
    return 'Relay will restart and restore the server data snapshot saved with that version.';
  }
  return 'Relay will restart with that runtime. Local cache and queued changes are preserved.';
}

function submitLabel(action: RecoveryAction, busy: boolean): string {
  if (busy) return action === 'repair' ? 'Repairing from GitHub…' : 'Preparing rollback…';
  return action === 'repair' ? 'Confirm repair' : 'Confirm rollback';
}

function invokeRecoveryAction(action: RecoveryAction, targetBuildId: string, password: string) {
  const input = { targetBuildId, password };
  if (action === 'repair') return globalThis.api?.repairRecoveryBuild?.(input);
  return globalThis.api?.rollbackToRecoveryBuild?.(input);
}

function emptyRecoveryState(): RelayRecoveryState {
  return {
    supported: false,
    status: 'unavailable',
    mode: 'unconfigured',
    currentBuildId: null,
    currentVersion: null,
    runningBuildId: null,
    runningVersion: null,
    fallbackActive: false,
    retainedBuilds: [],
  };
}

export function RecoverySettings() {
  const { session } = usePrivilegedAccess();
  const [state, setState] = useState<RelayRecoveryState | null>(null);
  const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<RecoveryAction | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<RecoveryFeedback | null>(null);

  useEffect(() => {
    let cancelled = false;
    const getRecoveryState = globalThis.api?.getRecoveryState;
    if (!getRecoveryState) {
      setState(emptyRecoveryState());
      return () => {
        cancelled = true;
      };
    }
    void getRecoveryState().then(
      (next) => {
        if (!cancelled) setState(next);
      },
      () => {
        if (!cancelled) setState(emptyRecoveryState());
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBuild = useMemo(
    () => state?.retainedBuilds.find((build) => build.buildId === selectedBuildId) ?? null,
    [selectedBuildId, state],
  );
  if (!state?.supported) return null;

  const isOwner = session.state === 'active' && session.role === 'owner';
  const clearSelection = () => {
    setSelectedBuildId(null);
    setSelectedAction(null);
    setPassword('');
    setFeedback(null);
  };
  const selectAction = (buildId: string, action: RecoveryAction) => {
    setSelectedBuildId(buildId);
    setSelectedAction(action);
    setPassword('');
    setFeedback(null);
  };
  const handleRecoveryAction = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !selectedBuild ||
      !selectedAction ||
      !isActionAvailable(selectedAction, selectedBuild) ||
      !password ||
      busy
    ) {
      return;
    }
    const action = selectedAction;
    setBusy(true);
    setFeedback(null);
    try {
      const result = await invokeRecoveryAction(action, selectedBuild.buildId, password);
      setPassword('');
      if (!result?.success) {
        setFeedback({ tone: 'error', message: recoveryFailureMessage(action, result?.error) });
        return;
      }
      if (action === 'repair') {
        setSelectedBuildId(null);
        setSelectedAction(null);
        setFeedback({
          tone: 'success',
          message: `v${selectedBuild.version} is repaired and ready to roll back.`,
        });
        const refreshed = await globalThis.api?.getRecoveryState?.();
        if (refreshed) setState(refreshed);
      } else {
        setFeedback({
          tone: 'success',
          message: `Restarting Relay with v${selectedBuild.version}…`,
        });
      }
    } catch {
      setPassword('');
      setFeedback({
        tone: 'error',
        message: recoveryFailureMessage(action),
      });
    } finally {
      setBusy(false);
    }
  };
  const headingLabel = recoveryHeadingLabel(state);

  return (
    <section className="settings-recovery" aria-labelledby="settings-recovery-title">
      <div className="settings-recovery__heading">
        <div>
          <h3 id="settings-recovery-title">Recovery</h3>
          <p>
            Relay keeps the current Windows runtime plus the three most recent versions on this
            workstation.
          </p>
        </div>
        {headingLabel && <span className="settings-recovery__current">{headingLabel}</span>}
      </div>

      {state.fallbackActive && state.runningVersion && (
        <p className="settings-recovery__notice" role="status">
          Relay is running retained v{state.runningVersion} for recovery. The catalog still points
          to v{state.currentVersion}; roll back below to make this version current.
        </p>
      )}
      {state.status === 'busy' && (
        <p className="settings-recovery__notice" role="status">
          An update or recovery operation is already in progress.
        </p>
      )}
      {state.retainedBuilds.length === 0 && (
        <p className="settings-recovery__notice">No previous Windows versions are retained yet.</p>
      )}
      {state.retainedBuilds.length > 0 && (
        <div className="settings-recovery__builds">
          {state.retainedBuilds.map((build) => (
            <article className="settings-recovery__build" key={build.buildId}>
              <div className="settings-recovery__build-copy">
                <strong>v{build.version}</strong>
                <span
                  className={`settings-recovery__health settings-recovery__health--${build.status}`}
                >
                  {STATUS_LABELS[build.status]}
                </span>
              </div>
              <div className="settings-recovery__actions">
                {build.rollbackAvailable && isOwner && (
                  <TactileButton
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => selectAction(build.buildId, 'rollback')}
                  >
                    Roll back to v{build.version}
                  </TactileButton>
                )}
                {build.repairAvailable && isOwner && (
                  <TactileButton
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => selectAction(build.buildId, 'repair')}
                  >
                    Repair v{build.version} from GitHub
                  </TactileButton>
                )}
                {!build.rollbackAvailable && build.githubFallbackAvailable && (
                  <TactileButton
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => void globalThis.api?.openReleasesPage?.(build.version)}
                  >
                    View v{build.version} on GitHub
                  </TactileButton>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {!isOwner &&
        state.retainedBuilds.some((build) => build.rollbackAvailable || build.repairAvailable) && (
          <p className="settings-recovery__notice">
            Sign in as the Relay Owner under Access to repair or roll back this workstation.
          </p>
        )}

      {selectedBuild && selectedAction && isOwner && (
        <form
          className="settings-recovery__confirm"
          onSubmit={(event) => void handleRecoveryAction(event)}
        >
          <div>
            <strong>{confirmationTitle(selectedAction, selectedBuild.version)}</strong>
            <p>{confirmationDescription(selectedAction, state.mode, selectedBuild.version)}</p>
          </div>
          <label className="settings-recovery__password">
            <span>Owner password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              minLength={12}
              maxLength={128}
              required
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <div className="settings-recovery__confirm-actions">
            <TactileButton type="submit" size="sm" variant="primary" disabled={busy || !password}>
              {submitLabel(selectedAction, busy)}
            </TactileButton>
            <TactileButton type="button" size="sm" disabled={busy} onClick={clearSelection}>
              Cancel
            </TactileButton>
          </div>
        </form>
      )}

      {feedback && (
        <p
          className={`settings-recovery__feedback settings-recovery__feedback--${feedback.tone}`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.message}
        </p>
      )}
    </section>
  );
}
