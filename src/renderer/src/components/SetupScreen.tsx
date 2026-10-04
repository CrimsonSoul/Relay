import React, { useRef, useState } from 'react';
import type { DiscoveredRelayServer } from '@shared/ipc';
import { isAllowedRelayServerUrl, normalizeRelayServerUrl } from '@shared/urlSecurity';
import { Input } from './Input';
import { TactileButton } from './TactileButton';

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
      type="button"
      className="setup-close-btn"
      onClick={() => globalThis.window.api?.windowClose()}
      aria-label="Close Relay"
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
    <circle cx="12" cy="10" r="1.2" fill="var(--accent)" stroke="none" />
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

interface FieldErrors {
  port?: string;
  serverUrl?: string;
  passphrase?: string;
}

type TestStatus = 'idle' | 'testing' | 'ok' | 'invalid-url' | 'unreachable' | 'auth-failed';

const TEST_RESULT_MESSAGES: Record<Exclude<TestStatus, 'idle' | 'testing'>, string> = {
  ok: 'Connected — server and passphrase look good.',
  'auth-failed': 'Wrong passphrase for this server.',
  unreachable: 'No Relay server responded at that address.',
  'invalid-url': 'That address is not a valid LAN server URL.',
};

const MODE_DESCRIPTIONS = {
  server: 'Host shared Relay data on this workstation as the Relay server.',
  client: 'Connect this workstation to the Relay server on your LAN.',
} as const;

export function SetupScreen({ onComplete }: SetupScreenProps) {
  const [mode, setMode] = useState<'server' | 'client' | null>(null);
  const [port, setPort] = useState('8090');
  const [allowLanAccess, setAllowLanAccess] = useState(true);
  const [serverUrl, setServerUrl] = useState('');
  const [allowInsecureHttp, setAllowInsecureHttp] = useState(false);
  const [secret, setSecret] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const portRef = useRef<HTMLInputElement>(null);
  const serverUrlRef = useRef<HTMLInputElement>(null);
  const passphraseRef = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  // Bumped whenever the tested inputs change, so a probe still in flight for the old
  // values cannot report its verdict against the new ones.
  const testRequestRef = useRef(0);
  const resetTestStatus = () => {
    testRequestRef.current += 1;
    setTestStatus('idle');
  };
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
    const request = ++testRequestRef.current;
    setTestStatus('testing');
    let status: TestStatus;
    try {
      const result = await globalThis.window.api?.testConnection({
        serverUrl,
        secret,
        ...(allowInsecureHttp ? { allowInsecureHttp: true } : {}),
      });
      if (result === undefined) {
        status = 'unreachable';
      } else {
        status = result.ok ? 'ok' : result.error;
      }
    } catch {
      status = 'unreachable';
    }
    if (request === testRequestRef.current) setTestStatus(status);
  };

  const validatePassphrase = (): string | undefined => {
    if (!secret.trim()) return 'Passphrase is required';
    if (secret.length < 8) return 'Passphrase must be at least 8 characters';
    return undefined;
  };

  const validatePort = (): string | undefined => {
    const portNum = Number.parseInt(port, 10);
    if (Number.isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      return 'Port must be between 1024 and 65535';
    }
    return undefined;
  };

  const validateServerUrl = (): string | undefined => {
    const normalizedServerUrl = normalizeRelayServerUrl(serverUrl);
    if (!normalizedServerUrl) return 'Server URL is required';
    if (!isAllowedRelayServerUrl(normalizedServerUrl, allowInsecureHttp)) {
      return 'Public HTTP is not production safe. Use HTTPS or explicitly allow insecure HTTP.';
    }
    return undefined;
  };

  const clearFieldError = (field: keyof FieldErrors) => {
    setFieldErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  const submitServerConfig = async () => {
    setLoading(true);
    try {
      await onComplete({
        mode: 'server',
        port: Number.parseInt(port, 10),
        bindHost: allowLanAccess ? '0.0.0.0' : '127.0.0.1',
        secret,
      });
    } catch {
      setLoading(false);
    }
  };

  const submitClientConfig = async () => {
    setLoading(true);
    try {
      await onComplete({
        mode: 'client',
        serverUrl: normalizeRelayServerUrl(serverUrl) ?? serverUrl,
        ...(allowInsecureHttp ? { allowInsecureHttp: true } : {}),
        secret,
      });
    } catch {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    // Validate every field at once so each error sits on its own field; focus moves to the
    // first invalid field in form order.
    const errors: FieldErrors = {
      port: mode === 'server' ? validatePort() : undefined,
      serverUrl: mode === 'client' ? validateServerUrl() : undefined,
      passphrase: validatePassphrase(),
    };
    setFieldErrors(errors);

    const firstInvalid = [
      errors.port && portRef,
      errors.serverUrl && serverUrlRef,
      errors.passphrase && passphraseRef,
    ].find(Boolean);
    if (firstInvalid) {
      firstInvalid.current?.focus();
      return;
    }

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
          <p className="setup-branding__subtitle">Choose this workstation&apos;s role</p>
          <p className="setup-branding__description">
            The Relay server holds shared Relay data. Relay clients connect to it across the LAN.
          </p>
        </div>
        <div className="setup-mode-cards">
          <button type="button" onClick={() => setMode('server')} className="setup-mode-card">
            <div className="setup-mode-card__icon setup-mode-card__icon--server">
              <ServerIcon />
            </div>
            <div className="setup-mode-card__body">
              <h2 className="setup-mode-card__title">Server</h2>
              <p className="setup-mode-card__desc">
                Host the shared Relay data. Relay clients and Relay Web connect here.
              </p>
              <span className="setup-mode-card__tag setup-mode-card__tag--server">
                Relay Server
              </span>
            </div>
            <span className="setup-mode-card__arrow" aria-hidden="true">
              <SubmitArrow />
            </span>
          </button>
          <button type="button" onClick={() => setMode('client')} className="setup-mode-card">
            <div className="setup-mode-card__icon setup-mode-card__icon--client">
              <ClientIcon />
            </div>
            <div className="setup-mode-card__body">
              <h2 className="setup-mode-card__title">Client</h2>
              <p className="setup-mode-card__desc">
                Connect to a Relay server already running on your network.
              </p>
              <span className="setup-mode-card__tag setup-mode-card__tag--client">
                Relay Client
              </span>
            </div>
            <span className="setup-mode-card__arrow" aria-hidden="true">
              <SubmitArrow />
            </span>
          </button>
        </div>
      </div>
    );
  }

  // ── Configuration ──
  const busySubmitLabel = mode === 'server' ? 'Starting Server...' : 'Connecting...';
  const idleSubmitLabel = mode === 'server' ? 'Save & Start Server' : 'Save & Connect';

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
                setFieldErrors({});
                setShowPassword(false);
                resetTestStatus();
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
          <p className="setup-config__subtitle">{MODE_DESCRIPTIONS[mode]}</p>
        </div>

        <form onSubmit={handleSubmit} className="setup-config__form">
          <span className="setup-config__section-label">
            {mode === 'server' ? 'Network' : 'Connection'}
          </span>

          {mode === 'server' && (
            <div className="setup-config__field">
              <Input
                ref={portRef}
                label="Port"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={port}
                onChange={(e) => {
                  const v = e.target.value.replaceAll(/\D/g, '');
                  setPort(v);
                  clearFieldError('port');
                }}
                placeholder="8090"
                error={fieldErrors.port}
              />
              <p className="setup-config__hint">
                Direct LAN access is enabled by default for trusted Relay clients.
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
                <TactileButton
                  block
                  onClick={() => void handleDiscoverServers()}
                  disabled={discovering}
                >
                  {discovering ? 'Searching…' : 'Find Servers on This Network'}
                </TactileButton>
                {discovered?.length === 0 && (
                  <p className="setup-config__hint">
                    No servers found — enter the address shown on the server&apos;s status bar.
                  </p>
                )}
                {discovered?.map((s) => (
                  <button
                    key={s.url}
                    type="button"
                    className="setup-config__discover-result"
                    onClick={() => {
                      setServerUrl(s.url);
                      resetTestStatus();
                    }}
                  >
                    <span className="setup-config__discover-name">{s.name}</span>
                    <span className="setup-config__discover-addr">
                      {s.host}:{s.port}
                    </span>
                  </button>
                ))}
              </div>
              <Input
                ref={serverUrlRef}
                label="Server URL"
                type="text"
                value={serverUrl}
                onChange={(e) => {
                  setServerUrl(e.target.value);
                  resetTestStatus();
                  clearFieldError('serverUrl');
                }}
                placeholder="https://relay.example.com:8090"
                error={fieldErrors.serverUrl}
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
                    resetTestStatus();
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
                ref={passphraseRef}
                label="Passphrase"
                type={showPassword ? 'text' : 'password'}
                value={secret}
                onChange={(e) => {
                  setSecret(e.target.value);
                  resetTestStatus();
                  clearFieldError('passphrase');
                }}
                placeholder="Shared passphrase (min 8 chars)"
                error={fieldErrors.passphrase}
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
                ? 'Every Relay client uses this passphrase to authenticate'
                : 'Must match the passphrase on the server'}
            </p>
          </div>

          {mode === 'client' && (
            <div className="setup-config__test">
              <TactileButton
                block
                onClick={() => void handleTestConnection()}
                disabled={testStatus === 'testing' || !serverUrl || secret.length < 8}
              >
                Test Connection
              </TactileButton>
              {testStatus === 'testing' && <p className="setup-config__hint">Testing…</p>}
              {testStatus !== 'idle' &&
                testStatus !== 'testing' &&
                (testStatus === 'ok' ? (
                  <p className="setup-config__hint setup-config__test-ok">
                    {TEST_RESULT_MESSAGES.ok}
                  </p>
                ) : (
                  <div className="setup-config__error field-error" role="alert">
                    {TEST_RESULT_MESSAGES[testStatus]}
                  </div>
                ))}
            </div>
          )}

          <TactileButton
            type="submit"
            variant="primary"
            block
            className="setup-config__submit"
            loading={loading}
          >
            {loading && busySubmitLabel}
            {!loading && (
              <>
                {idleSubmitLabel}
                <SubmitArrow />
              </>
            )}
          </TactileButton>
        </form>
      </div>
    </div>
  );
}
