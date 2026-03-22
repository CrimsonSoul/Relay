import React, { useState } from 'react';
import { TactileButton } from './TactileButton';
import { Input } from './Input';

interface SetupScreenProps {
  readonly onComplete: (config: {
    mode: 'server' | 'client';
    port?: number;
    serverUrl?: string;
    secret: string;
  }) => void;
}

function CloseButton() {
  return (
    <button
      className="setup-close-btn"
      onClick={() => globalThis.window.api?.windowClose()}
      aria-label="Close"
    >
      &#10005;
    </button>
  );
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

    if (secret.length < 8) {
      setError('Passphrase must be at least 8 characters');
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
      <div className="setup-fullscreen">
        <CloseButton />
        <div className="setup-branding">
          <h1 className="setup-branding__title">Relay</h1>
          <p className="setup-branding__subtitle">How will this instance be used?</p>
        </div>
        <div className="setup-mode-cards">
          <button onClick={() => setMode('server')} className="card-surface setup-mode-card">
            <div className="accent-strip" style={{ backgroundColor: 'var(--color-accent)' }} />
            <span className="setup-mode-card__icon" aria-hidden="true">
              &#128752;
            </span>
            <h2 className="setup-mode-card__title">Server Mode</h2>
            <p className="setup-mode-card__desc">
              This is the primary NOC station. Other clients will connect to this instance.
            </p>
          </button>
          <button onClick={() => setMode('client')} className="card-surface setup-mode-card">
            <div className="accent-strip" style={{ backgroundColor: 'var(--color-accent)' }} />
            <span className="setup-mode-card__icon" aria-hidden="true">
              &#128279;
            </span>
            <h2 className="setup-mode-card__title">Client Mode</h2>
            <p className="setup-mode-card__desc">
              Connect to an existing Relay server on the network.
            </p>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-fullscreen">
      <CloseButton />
      <div className="setup-config">
        <div className="setup-config__header">
          <TactileButton
            variant="secondary"
            size="sm"
            onClick={() => {
              setMode(null);
              setError(null);
            }}
          >
            &#8592; Back
          </TactileButton>
          <span className="setup-config__mode-label">
            {mode === 'server' ? 'Server' : 'Client'} Mode
          </span>
          <h1 className="setup-config__title">Configure Relay</h1>
        </div>

        <form onSubmit={handleSubmit} className="setup-config__form">
          {mode === 'server' && (
            <Input
              label="Port"
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              min={1024}
              max={65535}
              placeholder="8090"
            />
          )}
          {mode === 'client' && (
            <Input
              label="Server URL"
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              // eslint-disable-next-line sonarjs/no-clear-text-protocols
              placeholder="http://192.168.1.50:8090"
            />
          )}
          <Input
            label="Passphrase"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Shared passphrase"
          />

          {error && <p className="setup-config__error">{error}</p>}

          <div className="setup-config__actions">
            <TactileButton variant="primary" type="submit">
              Save and Continue
            </TactileButton>
          </div>
        </form>
      </div>
    </div>
  );
}
