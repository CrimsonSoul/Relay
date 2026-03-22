import React, { useState } from 'react';

interface SetupScreenProps {
  readonly onComplete: (config: {
    mode: 'server' | 'client';
    port?: number;
    serverUrl?: string;
    secret: string;
  }) => void;
}

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [mode, setMode] = useState<'server' | 'client' | null>(null);
  const [port, setPort] = useState('8090');
  const [serverUrl, setServerUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError(null);

    if (!secret.trim()) {
      setError('Passphrase is required');
      return;
    }

    if (mode === 'server') {
      const portNum = parseInt(port, 10);
      if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
        setError('Port must be between 1024 and 65535');
        return;
      }
      onComplete({ mode: 'server', port: portNum, secret });
    } else if (mode === 'client') {
      if (!serverUrl.trim()) {
        setError('Server URL is required');
        return;
      }
      onComplete({ mode: 'client', serverUrl: serverUrl.trim(), secret });
    }
  };

  if (!mode) {
    return (
      <div className="setup-screen">
        <h1>Relay Setup</h1>
        <p>How will this instance be used?</p>
        <div className="setup-options">
          <button onClick={() => setMode('server')} className="setup-option">
            <h2>Server Mode</h2>
            <p>This is the primary NOC station. Other clients will connect to this instance.</p>
          </button>
          <button onClick={() => setMode('client')} className="setup-option">
            <h2>Client Mode</h2>
            <p>Connect to an existing Relay server on the network.</p>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-screen">
      <h1>Relay Setup — {mode === 'server' ? 'Server' : 'Client'} Mode</h1>
      <button onClick={() => setMode(null)} className="setup-back">
        Back
      </button>
      <form onSubmit={handleSubmit}>
        {mode === 'server' && (
          <label>
            Port:
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              min={1024}
              max={65535}
            />
          </label>
        )}
        {mode === 'client' && (
          <label>
            Server URL:
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              // eslint-disable-next-line sonarjs/no-clear-text-protocols
              placeholder="http://192.168.1.50:8090"
            />
          </label>
        )}
        <label>
          Passphrase:
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Shared passphrase"
          />
        </label>
        {error && <p className="setup-error">{error}</p>}
        <button type="submit">Save and Continue</button>
      </form>
    </div>
  );
}
