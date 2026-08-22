import { memo, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  getConnectionState,
  onConnectionStateChange,
  type ConnectionState,
} from '../services/pocketbase';
import './statusbar.css';
import { usePendingSyncStatus } from '../hooks/usePendingSyncStatus';

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
          <div className="status-bar-sep" />
          <div className="status-bar-center">{center}</div>
        </>
      )}
      <div className="status-bar-right">{right}</div>
    </div>
  );
});

const connectionLabels: Record<ConnectionState, string> = {
  connecting: 'Connecting...',
  online: 'Connected',
  offline: 'Offline — using cached data',
  reconnecting: 'Reconnecting...',
  'auth-failed': 'Sign-in failed — check the passphrase in Settings',
};

export function StatusBarLive({ label }: { readonly label?: string }) {
  const [state, setState] = useState<ConnectionState>(getConnectionState());
  const pendingStatus = usePendingSyncStatus();
  const { pendingCount, issueCount = 0 } = pendingStatus;
  const resolvedLabel = label ?? connectionLabels[state];

  useEffect(() => {
    return onConnectionStateChange(setState);
  }, []);

  return (
    <span className={`status-bar-live status-bar-live--${state}`} data-connection-state={state}>
      <span className="status-bar-live-dot" />
      {resolvedLabel}
      {pendingCount > 0 &&
        ` · ${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} pending`}
      {issueCount > 0 && ` · ${issueCount} need attention`}
    </span>
  );
}
