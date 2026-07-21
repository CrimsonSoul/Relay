import { useEffect, useState, type ComponentProps } from 'react';
import type { RelayWebServerPublicState } from '@shared/ipc';
import { TactileButton } from '../TactileButton';

type Props = {
  pocketBasePort: number;
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

export function RelayWebAccessSettings({ pocketBasePort }: Readonly<Props>) {
  const [state, setState] = useState<RelayWebServerPublicState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [port, setPort] = useState('8091');
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    globalThis.api
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
      setError(`Choose a port different from PocketBase (${pocketBasePort}).`);
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
      const result = await globalThis.api.saveWebServerConfig({ enabled, port: nextPort });
      if (!result.success || !result.data) {
        setError(result.error ?? 'Relay Web settings could not be saved.');
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
      const result = await globalThis.api.retryWebServer();
      if (!result.success || !result.data) {
        setError(result.error ?? 'Relay Web could not be restarted.');
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

  return (
    <div className="settings-section relay-web-settings">
      <div className="settings-section-heading">Relay Web</div>
      <div className="settings-description">
        Keep a browser backup available on the same trusted network as this Relay server.
      </div>
      <div className="relay-web-warning" role="note">
        Trusted LAN/VPN only - browser traffic is not encrypted
      </div>

      <form className="relay-web-form" onSubmit={handleSubmit}>
        <label className="relay-web-toggle">
          <input
            type="checkbox"
            name="relay-web-enabled"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
          <span>Enable browser backup</span>
        </label>

        <div className="relay-web-port-field">
          <label htmlFor="relay-web-port">Browser port</label>
          <input
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

        <div className="relay-web-state" aria-live="polite">
          <span className="relay-web-state__label">Status</span>
          <strong>{state ? STATUS_LABELS[state.status] : 'Loading…'}</strong>
          {statusDetail && <span>{statusDetail}</span>}
        </div>

        {state?.url && (
          <div className="settings-data-path settings-copy-row">
            <span>{state.url}</span>
            <button
              type="button"
              className="settings-inline-action"
              aria-label="Copy browser URL"
              onClick={() => void globalThis.api.writeClipboard(state.url!)}
            >
              Copy
            </button>
          </div>
        )}

        {error && (
          <div className="relay-web-error" role="alert">
            {error}
          </div>
        )}

        <div className="settings-button-row">
          <TactileButton type="submit" variant="primary" disabled={isWorking}>
            Save web access
          </TactileButton>
          {(state?.status === 'conflict' || state?.status === 'failed') && (
            <TactileButton type="button" disabled={isWorking} onClick={() => void handleRetry()}>
              Retry web access
            </TactileButton>
          )}
        </div>
      </form>
    </div>
  );
}
