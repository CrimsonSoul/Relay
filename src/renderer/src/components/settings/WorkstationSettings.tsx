import { useEffect, useState } from 'react';
import type { WorkstationAwakeState } from '@shared/workstationAwake';

const UNSUPPORTED_STATE: WorkstationAwakeState = {
  supported: false,
  enabled: false,
  status: 'unsupported',
};

const STATUS_LABELS: Record<WorkstationAwakeState['status'], string> = {
  active: 'Active',
  degraded: 'Limited',
  disabled: 'Off',
  unsupported: 'Windows only',
};

function getStatusDetail(state: WorkstationAwakeState): string {
  if (state.error === 'input-pulse-failed') {
    return 'Windows blocked the inactivity pulse. Display sleep prevention may still be active.';
  }
  if (state.error === 'display-blocker-failed') {
    return 'Relay could not hold the display awake. Inactivity timer resets are still running.';
  }
  if (state.status === 'active') {
    return 'Display sleep and inactivity locking are being prevented.';
  }
  if (state.status === 'disabled') {
    return 'Windows power and inactivity settings are in control.';
  }
  return 'This feature is available in the Relay desktop app on Windows.';
}

export function WorkstationSettings() {
  const [state, setState] = useState<WorkstationAwakeState | null>(null);
  const [busy, setBusy] = useState<'load' | 'update' | null>('load');
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const getState = globalThis.api?.getWorkstationAwakeState;
    if (!getState) {
      setState(UNSUPPORTED_STATE);
      setBusy(null);
      return () => {
        cancelled = true;
      };
    }

    void getState()
      .then((nextState) => {
        if (!cancelled) setState(nextState);
      })
      .catch(() => {
        if (!cancelled) setError('Relay could not read this workstation setting.');
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnabledChange = async (enabled: boolean) => {
    const setEnabled = globalThis.api?.setWorkstationAwakeEnabled;
    if (!setEnabled) return;
    setBusy('update');
    setPendingEnabled(enabled);
    setError(null);
    try {
      const result = await setEnabled(enabled);
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Relay could not update this workstation setting.');
      }
      setState(result.data);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Relay could not update this workstation setting.',
      );
    } finally {
      setPendingEnabled(null);
      setBusy(null);
    }
  };

  const currentState = state ?? UNSUPPORTED_STATE;
  const toggleDisabled = busy !== null || !currentState.supported;
  const readFailed = Boolean(error && !state);
  let statusLabel = STATUS_LABELS[currentState.status];
  let statusDetail = getStatusDetail(currentState);
  let statusClass: WorkstationAwakeState['status'] | 'error' = currentState.status;
  if (busy === 'load') {
    statusLabel = 'Checking…';
    statusDetail = 'Reading the local workstation setting.';
  } else if (readFailed) {
    statusLabel = 'Unavailable';
    statusDetail = 'Relay could not confirm whether workstation protection is running.';
    statusClass = 'error';
  } else if (busy === 'update') {
    statusLabel = pendingEnabled ? 'Turning on…' : 'Turning off…';
    statusDetail = 'Saving this setting to the local workstation profile.';
  }

  return (
    <section className="settings-section workstation-awake-settings">
      <h2 className="settings-section-heading">Workstation</h2>
      <p className="workstation-awake-settings__intro">
        Keep this Windows PC ready for operations without a mouse-moving utility. No administrator
        access is required.
      </p>

      <label className="workstation-awake-toggle">
        <span className="workstation-awake-toggle__copy">
          <strong>Keep this PC awake while Relay is running</strong>
          <span>
            Keeps the display on and resets the Windows inactivity timer every 30 seconds.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-label="Keep this PC awake while Relay is running"
          checked={currentState.enabled}
          disabled={toggleDisabled}
          aria-describedby="workstation-awake-limitations"
          onChange={(event) => void handleEnabledChange(event.target.checked)}
        />
      </label>

      <div
        className={`workstation-awake-status workstation-awake-status--${statusClass}`}
        aria-live="polite"
        aria-busy={busy !== null}
      >
        <span className="workstation-awake-status__indicator" aria-hidden="true" />
        <div>
          <strong>{statusLabel}</strong>
          <p>{statusDetail}</p>
        </div>
      </div>

      {error && (
        <div className="workstation-awake-settings__error" role="alert">
          {error}
        </div>
      )}

      <p id="workstation-awake-limitations" className="workstation-awake-settings__limitations">
        Manual lock, sign-out, shutdown, lid-close sleep, and organization policies can still take
        effect.
      </p>
    </section>
  );
}
