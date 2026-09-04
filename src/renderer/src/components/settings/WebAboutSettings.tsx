import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getWebEventState, subscribeWebEventState } from '../../runtime/WebBridge';
import { RELAY_WEB_API_PREFIX, WebServerStatusSchema, type WebServerStatus } from '@shared/webApi';
import {
  DYNATRACE_PROBLEM_SYNC_COLLECTION,
  type DynatraceProblemSyncRecord,
} from '@shared/dynatraceProblems';
import type { RadarSnapshot } from '@shared/ipc';
import { useCollection } from '../../hooks/useCollection';
import { StatusBarLive } from '../StatusBar';
import { TactileButton } from '../TactileButton';

function timestamp(value: string | number | null | undefined): string {
  return value ? new Date(value).toLocaleString() : 'No successful update yet';
}

export function WebAboutSettings() {
  const events = useSyncExternalStore(subscribeWebEventState, getWebEventState);
  const [status, setStatus] = useState<WebServerStatus | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [radar, setRadar] = useState<RadarSnapshot | null>(null);
  const sync = useCollection<DynatraceProblemSyncRecord>(DYNATRACE_PROBLEM_SYNC_COLLECTION, {
    sort: '-updated',
  });
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`${RELAY_WEB_API_PREFIX}/session/status`, {
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
      });
      if (!response.ok) throw new Error('unavailable');
      setStatus(WebServerStatusSchema.parse(await response.json()));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
    try {
      setRadar((await globalThis.api?.getRadarSnapshot?.()) ?? null);
    } catch {
      setRadar(null);
    }
  }, []);
  useEffect(() => {
    void refresh();
    return globalThis.api?.onRadarSnapshot?.(setRadar);
  }, [refresh]);

  return (
    <section className="settings-section web-about" aria-label="Relay Web status">
      <h2>Relay Web status</h2>
      <p>
        Connected to the Relay server through {globalThis.location.host}. Shared data is
        online-only.
      </p>
      <StatusBarLive />
      <p>Live server updates: {events}</p>
      {error && (
        <p role="alert">
          Could not read server status. Check the connection and refresh. Any previous details below
          may be stale.
        </p>
      )}
      {status && (
        <dl className="web-about__details">
          <dt>Server</dt>
          <dd>{status.serverName}</dd>
          <dt>Version</dt>
          <dd>{status.version}</dd>
          <dt>Server running</dt>
          <dd>{Math.floor(status.uptimeSeconds / 60)} minutes when checked</dd>
          <dt>Session ends by</dt>
          <dd>{timestamp(status.sessionExpiresAt)}</dd>
        </dl>
      )}
      <p>
        Sign-in also expires after one hour without activity. Reauthentication keeps your open work
        in this tab.
      </p>
      <dl className="web-about__details">
        <dt>Dynatrace last sync</dt>
        <dd>
          {sync.error
            ? 'Unavailable — open Problems to retry'
            : timestamp(sync.data[0]?.lastSuccessAt)}
        </dd>
        <dt>Radar last update</dt>
        <dd>
          {radar ? timestamp(radar.lastUpdated) : 'Unavailable — open Radar to retry'}
          {radar?.signInRequired ? ' · Sign in on the Relay server PC' : ''}
        </dd>
      </dl>
      <TactileButton size="sm" onClick={() => void refresh()} disabled={loading}>
        {loading ? 'Checking…' : 'Refresh status'}
      </TactileButton>
      <p>
        Updates, backups, connection setup, and recovery are managed in Relay Desktop on the server
        PC. Appearance preferences are saved only in this browser.
      </p>
    </section>
  );
}
