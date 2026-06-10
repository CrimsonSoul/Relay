import React, { useState } from 'react';
import type { DiscoveredRelayServer } from '@shared/ipc';
import { isAllowedRelayServerUrl, normalizeRelayServerUrl } from '@shared/urlSecurity';
import { Input } from './Input';

interface SetupScreenProps {
  readonly onComplete: (config: {
    mode: 'server' | 'client';
    port?: number;
    bindHost?: '127.0.0.1' | '0.0.0.0';
    serverUrl?: string;
    allowInsecureHttp?: boolean;
    secret: string;
  }) => Promise<void> | void;
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

/* SVG icons for mode cards */
const ServerIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
    <circle cx="12" cy="10" r="1.2" fill="var(--color-accent)" stroke="none" />
  </svg>
);

const ClientIcon = () => (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

const BackArrow = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M19 12H5" />
    <path d="M12 19l-7-7 7-7" />
  </svg>
);

const SubmitArrow = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14" />
    <path d="M12 5l7 7-7 7" />
  </svg>
);

const ErrorIcon = () => (
  <svg
    className="setup-config__error-icon"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const EyeOpen = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeClosed = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

type TestStatus = 'idle' | 'testing' | 'ok' | 'invalid-url' | 'unreachable' | 'auth-failed';

const TEST_RESULT_MESSAGES: Record<Exclude<TestStatus, 'idle' | 'testing'>, string> = {
  ok: 'Connected — server and passphrase look good.',
  'auth-failed': 'Wrong passphrase for this server.',
  unreachable: 'No Relay server responded at that address.',
  'invalid-url': 'That address is not a valid LAN server URL.',
};

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [mode, setMode] = useState<'server' | 'client' | null>(null);
  const [port, setPort] = useState('8090');
  const [allowLanAccess, setAllowLanAccess] = useState(true);
  const [serverUrl, setServerUrl] = useState('');
  const [allowInsecureHttp, setAllowInsecureHttp] = useState(false);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredRelayServer[] | null>(null);

  const handleDiscoverServers = async () => {
    setDiscovering(true);
    try {
      const results = await globalThis.window.api?.discoverServers();
      setDiscovered(results ?? []);
    } catch {
      setDiscovered([]);
    } finally {
      setDiscovering(false);
    }
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    try {
      const result = await globalThis.window.api?.testConnection({
        serverUrl,
        secret,
        ...(allowInsecureHttp ? { allowInsecureHttp: true } : {}),
      });
      if (result === undefined) {
        setTestStatus('unreachable');
      } else {
        setTestStatus(result.ok ? 'ok' : result.error);
      }
    } catch {
      setTestStatus('unreachable');
    }
  };

  const validatePassphrase = (): boolean => {
    if (!secret.trim()) {
      setError('Passphrase is required');
      return false;
    }

    if (secret.length < 8) {
      setError('Passphrase must be at least 8 characters');
      return false;
    }

    return true;
  };

  const submitServerConfig = async () => {
    const portNum = Number.parseInt(port, 10);
    if (Number.isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      setError('Port must be between 1024 and 65535');
      return;
    }
    setLoading(true);
    try {
      await onComplete({
        mode: 'server',
        port: portNum,
        bindHost: allowLanAccess ? '0.0.0.0' : '127.0.0.1',
        secret,
      });
    } catch {
      setLoading(false);
    }
  };

  const submitClientConfig = async () => {
    const normalizedServerUrl = normalizeRelayServerUrl(serverUrl);
    if (!normalizedServerUrl) {
      setError('Server URL is required');
      return;
    }
    if (!isAllowedRelayServerUrl(normalizedServerUrl, allowInsecureHttp)) {
      setError('Public HTTP is not production safe. Use HTTPS or explicitly allow insecure HTTP.');
      return;
    }
    setLoading(true);
    try {
      await onComplete({
        mode: 'client',
        serverUrl: normalizedServerUrl,
        ...(allowInsecureHttp ? { allowInsecureHttp: true } : {}),
        secret,
      });
    } catch {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    setError(null);

    if (!validatePassphrase()) return;

    if (mode === 'server') {
      void submitServerConfig();
    } else if (mode === 'client') {
      void submitClientConfig();
    }
  };

  // ── Mode Selection ──
  if (!mode) {
    return (
      <div className="setup-fullscreen">
        <CloseButton />
        <div className="setup-branding">
          <h1 className="setup-branding__title">Relay</h1>
          <p className="setup-branding__subtitle">How will this instance be used?</p>
        </div>
        <div className="setup-mode-cards">
          <button onClick={() => setMode('server')} className="setup-mode-card">
            <div className="setup-mode-card__icon setup-mode-card__icon--server">
              <ServerIcon />
            </div>
            <div className="setup-mode-card__body">
              <h2 className="setup-mode-card__title">Server</h2>
              <p className="setup-mode-card__desc">
                Host the primary database. Other stations connect here.
              </p>
              <span className="setup-mode-card__tag setup-mode-card__tag--server">
                Primary Station
              </span>
            </div>
          </button>
          <button onClick={() => setMode('client')} className="setup-mode-card">
            <div className="setup-mode-card__icon setup-mode-card__icon--client">
              <ClientIcon />
            </div>
            <div className="setup-mode-card__body">
              <h2 className="setup-mode-card__title">Client</h2>
              <p className="setup-mode-card__desc">
                Connect to a Relay server already running on your network.
              </p>
              <span className="setup-mode-card__tag setup-mode-card__tag--client">
                Remote Station
              </span>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ── Configuration ──
  return (
    <div className="setup-fullscreen">
      <CloseButton />
      <div className="setup-config">
        <div className="setup-config__header">
          <div className="setup-config__topbar">
            <button
              type="button"
              className="setup-config__back"
              onClick={() => {
                setMode(null);
                setError(null);
                setShowPassword(false);
                setTestStatus('idle');
                setDiscovered(null);
              }}
            >
              <BackArrow />
              Back
            </button>
            <span className={`setup-config__mode-tag setup-config__mode-tag--${mode}`}>
              {mode === 'server' ? 'Server' : 'Client'} Mode
            </span>
          </div>
          <h1 className="setup-config__title">Configure Relay</h1>
        </div>

        <form onSubmit={handleSubmit} className="setup-config__form">
          <span className="setup-config__section-label">
            {mode === 'server' ? 'Network' : 'Connection'}
          </span>

          {mode === 'server' && (
            <div className="setup-config__field">
              <Input
                label="Port"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={port}
                onChange={(e) => {
                  const v = e.target.value.replaceAll(/\D/g, '');
                  setPort(v);
                }}
                placeholder="8090"
              />
              <p className="setup-config__hint">
                Direct LAN access is enabled by default for trusted Relay stations.
              </p>
              <label className="setup-config__checkbox">
                <input
                  type="checkbox"
                  checked={allowLanAccess}
                  onChange={(e) => setAllowLanAccess(e.target.checked)}
                  aria-label="Allow direct LAN access"
                />
                <span>Allow direct LAN access</span>
              </label>
            </div>
          )}
          {mode === 'client' && (
            <div className="setup-config__field">
              <div className="setup-config__discover">
                <button
                  type="button"
                  className="setup-config__test-btn"
                  onClick={() => void handleDiscoverServers()}
                  disabled={discovering}
                >
                  {discovering ? 'Searching…' : 'Find servers on this network'}
                </button>
                {discovered && discovered.length === 0 && (
                  <p className="setup-config__hint">
                    No servers found — enter the address shown on the server&apos;s status bar.
                  </p>
                )}
                {discovered?.map((s) => (
                  <button
                    key={s.url}
                    type="button"
                    className="setup-config__test-btn setup-config__discover-result"
                    onClick={() => {
                      setServerUrl(s.url);
                      setTestStatus('idle');
                    }}
                  >
                    {s.name} — {s.host}:{s.port}
                  </button>
                ))}
              </div>
              <Input
                label="Server URL"
                type="text"
                value={serverUrl}
                onChange={(e) => {
                  setServerUrl(e.target.value);
                  setTestStatus('idle');
                }}
                placeholder="https://relay.example.com:8090"
              />
              <p className="setup-config__hint">
                HTTPS is preferred. HTTP is supported for trusted LAN Relay servers.
              </p>
              <label className="setup-config__checkbox">
                <input
                  type="checkbox"
                  checked={allowInsecureHttp}
                  onChange={(e) => {
                    setAllowInsecureHttp(e.target.checked);
                    setTestStatus('idle');
                  }}
                  aria-label="Allow public HTTP"
                />
                <span>Allow public HTTP</span>
              </label>
            </div>
          )}

          <div className="setup-config__divider" />
          <span className="setup-config__section-label">Security</span>

          <div className="setup-config__field">
            <div className="setup-config__password-wrap">
              <Input
                label="Passphrase"
                type={showPassword ? 'text' : 'password'}
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value);
                  setTestStatus('idle');
                }}
                placeholder="Shared passphrase (min 8 chars)"
              />
              <button
                type="button"
                className="setup-config__eye-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide passphrase' : 'Show passphrase'}
              >
                {showPassword ? <EyeClosed /> : <EyeOpen />}
              </button>
            </div>
            <p className="setup-config__hint">
              {mode === 'server'
                ? 'All stations use this passphrase to authenticate'
                : 'Must match the passphrase on the server'}
            </p>
          </div>

          {error && (
            <div className="setup-config__error">
              <ErrorIcon />
              {error}
            </div>
          )}

          {mode === 'client' && (
            <div className="setup-config__test">
              <button
                type="button"
                className="setup-config__test-btn"
                onClick={() => void handleTestConnection()}
                disabled={testStatus === 'testing' || !serverUrl || secret.length < 8}
              >
                Test connection
              </button>
              {testStatus === 'testing' && <p className="setup-config__hint">Testing…</p>}
              {testStatus !== 'idle' &&
                testStatus !== 'testing' &&
                (testStatus === 'ok' ? (
                  <p className="setup-config__hint setup-config__test-ok">
                    {TEST_RESULT_MESSAGES.ok}
                  </p>
                ) : (
                  <div className="setup-config__error">
                    <ErrorIcon />
                    {TEST_RESULT_MESSAGES[testStatus]}
                  </div>
                ))}
            </div>
          )}

          <button type="submit" className="setup-config__submit" disabled={loading}>
            {loading ? (
              <>
                <div className="setup-config__submit-spinner" />
                {mode === 'server' ? 'Starting Server...' : 'Connecting...'}
              </>
            ) : (
              <>
                {mode === 'server' ? 'Save & Start Server' : 'Save & Connect'}
                <SubmitArrow />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
