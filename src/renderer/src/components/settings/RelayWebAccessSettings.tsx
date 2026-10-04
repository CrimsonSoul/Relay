import { useEffect, useState, type ComponentProps } from 'react';
import type { RelayWebServerPublicState } from '@shared/ipc';
import { TactileButton } from '../TactileButton';
import { SettingsCopyButton } from './SettingsCopyButton';
import { SettingsSwitch } from './SettingsSwitch';

type Props = {
  pocketBasePort: number;
  /** Hidden while another Settings tab is showing; stays mounted so unsaved edits survive. */
  hidden?: boolean;
};

type FormSubmitEvent = Parameters<NonNullable<ComponentProps<'form'>['onSubmit']>>[0];

const STATUS_LABELS: Record<RelayWebServerPublicState['status'], string> = {
  disabled: 'Disabled',
  starting: 'Starting…',
  available: 'Available',
  conflict: 'Port conflict',
  failed: 'Unavailable',
};

function getStatusDetail(state: RelayWebServerPublicState): string | null {
  if (state.status === 'conflict') return `Port ${state.port} is already in use.`;
  if (state.status === 'failed') return 'The browser listener could not be started.';
  return null;
}

export function RelayWebAccessSettings({ pocketBasePort, hidden = false }: Readonly<Props>) {
  const [state, setState] = useState<RelayWebServerPublicState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState('8091');
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const bridge = globalThis.api;
    if (!bridge) {
      setError('Relay Web settings could not be loaded.');
      return;
    }
    bridge
      .getWebServerState()
      .then((nextState) => {
        if (cancelled) return;
        setState(nextState);
        setEnabled(nextState.enabled);
        setPort(String(nextState.port));
      })
      .catch(() => {
        if (!cancelled) setError('Relay Web settings could not be loaded.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const validatePort = (): number | null => {
    const nextPort = Number(port);
    if (!Number.isInteger(nextPort) || nextPort < 1024 || nextPort > 65535) {
      setError('Enter a port from 1024 to 65535.');
      return null;
    }
    if (nextPort === pocketBasePort) {
      setError(`Choose a port different from the Relay data server (${pocketBasePort}).`);
      return null;
    }
    return nextPort;
  };

  const handleSubmit = async (event: FormSubmitEvent) => {
    event.preventDefault();
    setError(null);
    const nextPort = validatePort();
    if (nextPort === null) return;
    setIsWorking(true);
    try {
      const result = await globalThis.api?.saveWebServerConfig({ enabled, port: nextPort });
      if (!result?.success || !result.data) {
        setError(result?.error ?? 'Relay Web settings could not be saved.');
        return;
      }
      setState(result.data);
      setEnabled(result.data.enabled);
      setPort(String(result.data.port));
    } catch {
      setError('Relay Web settings could not be saved.');
    } finally {
      setIsWorking(false);
    }
  };

  const handleRetry = async () => {
    setError(null);
    setIsWorking(true);
    try {
      const result = await globalThis.api?.retryWebServer();
      if (!result?.success || !result.data) {
        setError(result?.error ?? 'Relay Web could not be restarted.');
        return;
      }
      setState(result.data);
    } catch {
      setError('Relay Web could not be restarted.');
    } finally {
      setIsWorking(false);
    }
  };

  const statusDetail = state ? getStatusDetail(state) : null;
  const browserUrl = state?.url;
  const dirty = state !== null && (enabled !== state.enabled || port !== String(state.port));

  return (
    <section className="settings-section relay-web-settings" hidden={hidden}>
      <h2 className="settings-section-heading">Relay Web</h2>
      <p className="settings-description">
        A browser backup for when the desktop app is unavailable.
      </p>

      <form className="relay-web-form" onSubmit={handleSubmit}>
        <SettingsSwitch
          label="Enable Relay Web"
          name="relay-web-enabled"
          checked={enabled}
          onChange={setEnabled}
        />
        <p className="relay-web-warning ink-rail" role="note">
          Trusted LAN/VPN only - browser traffic is not encrypted
        </p>

        <div className="relay-web-port-field">
          <label htmlFor="relay-web-port">Browser port</label>
          <input
            className="tactile-input"
            id="relay-web-port"
            name="relay-web-port"
            type="number"
            inputMode="numeric"
            autoComplete="off"
            min={1024}
            max={65535}
            value={port}
            onChange={(event) => setPort(event.target.value)}
          />
        </div>

        <dl className="settings-readout">
          <div className="settings-readout__row">
            <dt>Status</dt>
            <dd aria-live="polite">
              <span className="settings-readout__value">
                <strong>{state ? STATUS_LABELS[state.status] : 'Loading…'}</strong>
                {statusDetail && <span> {statusDetail}</span>}
              </span>
            </dd>
          </div>
          {browserUrl && (
            <div className="settings-readout__row">
              <dt>Browser URL</dt>
              <dd>
                <span className="settings-readout__value">{browserUrl}</span>
                <SettingsCopyButton text={browserUrl} label="Copy browser URL" />
              </dd>
            </div>
          )}
        </dl>

        {error && (
          <div className="panel-error ink-rail ink-rail--alarm" role="alert">
            {error}
          </div>
        )}

        <div className="settings-button-row">
          {/* Dirty-gated: with nothing changed it is dashed and the adjacent line says why. */}
          <TactileButton
            size="sm"
            type="submit"
            variant="primary"
            disabled={isWorking || !dirty}
            aria-describedby={dirty ? undefined : 'relay-web-save-state'}
          >
            Save Relay Web
          </TactileButton>
          {(state?.status === 'conflict' || state?.status === 'failed') && (
            <TactileButton
              type="button"
              size="sm"
              disabled={isWorking}
              onClick={() => void handleRetry()}
            >
              Retry Relay Web
            </TactileButton>
          )}
          {/* Quiet on purpose: announcing every first keystroke and revert is noise. The
              save button's description carries the clean state to assistive tech. */}
          <span
            id="relay-web-save-state"
            className={`settings-dirty-indicator${dirty ? '' : ' settings-dirty-indicator--clean'}`}
          >
            {dirty ? 'Unsaved changes' : 'No changes'}
          </span>
        </div>
      </form>
    </section>
  );
}
