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
  };

  const colors: Record<ConnectionState, string> = {
    connecting: '#f59e0b',
    online: '#10b981',
    offline: '#ef4444',
    reconnecting: '#f59e0b',
  };

  return (
    <div
      className="connection-status"
      style={{
        position: 'fixed',
        bottom: 8,
        right: 8,
        padding: '4px 12px',
        borderRadius: 4,
        backgroundColor: colors[state],
        color: 'white',
        fontSize: 12,
        fontWeight: 500,
        zIndex: 9999,
      }}
    >
      {labels[state]}
    </div>
  );
}
