import { memo, useState, useSyncExternalStore } from 'react';
import {
  getOfflineReadiness,
  subscribeOfflineReadiness,
  retryOfflineCopies,
} from '../stores/collectionStoreRegistry';
import type { ReactNode } from 'react';
import {
  getConnectionState,
  onConnectionStateChange,
  type ConnectionState,
} from '../services/pocketbase';
import './statusbar.css';
import { usePendingSyncStatus } from '../hooks/usePendingSyncStatus';
import { PendingChangesModal } from './PendingChangesModal';
import { getRelayRuntime } from '../runtime/relayRuntime';
import { Tooltip } from './Tooltip';

interface StatusBarProps {
  readonly left?: ReactNode;
  readonly center?: ReactNode;
  readonly right?: ReactNode;
}

export const StatusBar = memo(function StatusBar({ left, center, right }: StatusBarProps) {
  return (
    <div className="status-bar">
      {left && <div className="status-bar-left">{left}</div>}
      {center && (
        <>
          <div className="status-bar-sep" aria-hidden="true" />
          <div className="status-bar-center">{center}</div>
        </>
      )}
      <div className="status-bar-right">{right}</div>
    </div>
  );
});

// Every label names its object: the footer sits on every tab, so a bare "Connected" would not
// say what is connected.
const connectionLabels: Record<ConnectionState, string> = {
  connecting: 'Connecting to Relay server…',
  online: 'Relay server connected',
  offline: 'Relay server offline — using cached data',
  reconnecting: 'Reconnecting to Relay server…',
  'auth-failed': 'Relay server sign-in failed — check the passphrase in Settings',
};

function connectionLabel(state: ConnectionState): string {
  if (state === 'offline' && getRelayRuntime().kind === 'web') {
    return 'Relay server offline — reconnect to continue';
  }
  return connectionLabels[state];
}

export function StatusBarLive({ label }: { readonly label?: string }) {
  // Read through the store hook: a state change between render and a subscribing effect would
  // otherwise leave the footer showing a stale connection label until the next change.
  const state = useSyncExternalStore(onConnectionStateChange, getConnectionState);
  const pendingStatus = usePendingSyncStatus();
  const [pendingOpen, setPendingOpen] = useState(false);
  const offlineCopy = useSyncExternalStore(subscribeOfflineReadiness, getOfflineReadiness);
  const { pendingCount, issueCount = 0 } = pendingStatus;
  const resolvedLabel = label ?? connectionLabel(state);

  return (
    <>
      <span className={`status-bar-live status-bar-live--${state}`} data-connection-state={state}>
        <span className="status-bar-live-dot" aria-hidden="true" />
        {/* The state text is its own live region so a change of connection is announced; the
            buttons below stay siblings so the announcement is text only. */}
        <output className="status-bar-live-text">{resolvedLabel}</output>
        {/* Live regions stay mounted (empty when idle): a region inserted already holding text is
            often not announced, so only its text changes. */}
        {getRelayRuntime().kind !== 'web' && (
          <span
            className={`status-bar-offline-copy${offlineCopy ? '' : ' status-bar-offline-copy--idle'}`}
          >
            <output className="status-bar-offline-copy-text">
              {offlineCopy?.state === 'saving' && 'Saving for offline use'}
              {offlineCopy?.state === 'ready' && 'Offline copy ready'}
              {offlineCopy?.state === 'incomplete' &&
                `Offline copy incomplete — ${offlineCopy.reason ?? 'saving failed'}`}
            </output>
            {/* A sibling of the live region, not inside it, so the status announcement stays text
                only. The tooltip carries the full reason when the readout above is truncated. */}
            {offlineCopy?.state === 'incomplete' && (
              <Tooltip
                content={`Offline copy incomplete — ${offlineCopy.reason ?? 'saving failed'}`}
                position="top"
              >
                <button
                  type="button"
                  className="status-bar-pending"
                  onClick={() => void retryOfflineCopies()}
                >
                  Retry Offline Save
                </button>
              </Tooltip>
            )}
          </span>
        )}
        {pendingCount > 0 && getRelayRuntime().kind !== 'web' && (
          <button type="button" className="status-bar-pending" onClick={() => setPendingOpen(true)}>
            {pendingCount} {pendingCount === 1 ? 'change' : 'changes'} pending
          </button>
        )}
        <output className="status-bar-live-text">
          {issueCount > 0 ? ` · ${issueCount} need attention` : ''}
        </output>
      </span>
      {pendingOpen && (
        <PendingChangesModal online={state === 'online'} onClose={() => setPendingOpen(false)} />
      )}
    </>
  );
}
