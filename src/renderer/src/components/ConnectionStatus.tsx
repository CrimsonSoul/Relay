import { useState, useEffect } from 'react';
import {
  getConnectionState,
  onConnectionStateChange,
  type ConnectionState,
} from '../services/pocketbase';

export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>(getConnectionState());

  useEffect(() => {
    return onConnectionStateChange(setState);
  }, []);

  if (state === 'online') return null;

  const labels: Record<ConnectionState, string> = {
    connecting: 'Connecting...',
    online: 'Connected',
    offline: 'Offline — using cached data',
    reconnecting: 'Reconnecting...',
    'auth-failed': 'Sign-in failed — check the passphrase in Settings',
  };

  const colors: Record<ConnectionState, string> = {
    connecting: 'var(--color-warning)',
    online: 'var(--ok)',
    offline: 'var(--alarm)',
    reconnecting: 'var(--color-warning)',
    'auth-failed': 'var(--alarm)',
  };

  return (
    <div
      className="connection-status"
      style={{
        position: 'fixed',
        bottom: 8,
        right: 8,
        padding: '4px 12px',
        borderRadius: 2,
        backgroundColor: colors[state],
        color: '#000',
        fontSize: 12,
        fontWeight: 500,
        zIndex: 9999,
      }}
    >
      {labels[state]}
    </div>
  );
}
