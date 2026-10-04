import { ReactNode, useEffect, useState } from 'react';
import type { PbAuthSession } from '@shared/ipc';
import { usePocketBase } from '../hooks/usePocketBase';
import { TactileButton } from './TactileButton';
import { getRelayRuntime } from '../runtime/relayRuntime';
import { WebReauthenticationOverlay } from './WebReauthenticationOverlay';

interface ConnectionManagerProps {
  readonly pbUrl: string;
  readonly pbAuth: PbAuthSession | null;
  readonly offlineMode?: boolean;
  readonly onReconfigure: () => void;
  readonly onWebReauthenticate?: (passphrase: string) => Promise<boolean>;
  readonly onWebSessionRequired?: () => void;
  readonly children: ReactNode;
}

export function ConnectionManager({
  pbUrl,
  pbAuth,
  offlineMode = false,
  onReconfigure,
  onWebReauthenticate,
  onWebSessionRequired,
  children,
}: ConnectionManagerProps) {
  const { connectionState } = usePocketBase(pbUrl, pbAuth, offlineMode);
  const isWeb = getRelayRuntime().kind === 'web';
  const [reauthenticated, setReauthenticated] = useState(false);

  useEffect(() => {
    if (connectionState !== 'auth-failed') setReauthenticated(false);
  }, [connectionState]);

  const reauthenticate = async (passphrase: string): Promise<boolean> => {
    return onWebReauthenticate ? onWebReauthenticate(passphrase) : false;
  };

  const isConnecting = connectionState === 'connecting';
  const showWebReconnecting =
    isWeb && (connectionState === 'offline' || connectionState === 'reconnecting');
  let liveMessage = '';
  if (isConnecting) liveMessage = 'Connecting to Relay server…';
  else if (showWebReconnecting) liveMessage = 'Reconnecting to Relay server…';

  return (
    <>
      {/* Stays mounted across every connection state and changes only its text, so screen readers
          hear "Connecting…" / "Reconnecting…" (DESIGN.md › Live regions). */}
      <output className="sr-only">{liveMessage}</output>
      {isConnecting ? (
        <div className="app-state">
          {!isWeb && (
            <button
              type="button"
              className="app-state__close-btn"
              onClick={() => globalThis.window.api?.windowClose()}
              aria-label="Close Relay"
            >
              &#10005;
            </button>
          )}
          <div className="app-state__spinner" aria-hidden="true" />
          <p className="app-state__text" aria-hidden="true">
            Connecting to Relay server…
          </p>
          {!isWeb && (
            <TactileButton variant="secondary" onClick={onReconfigure}>
              Reconfigure
            </TactileButton>
          )}
        </div>
      ) : (
        <>
          {children}
          {showWebReconnecting && (
            <div
              className="web-connection-status"
              data-testid="connection-status"
              aria-hidden="true"
            >
              Reconnecting to Relay server…
            </div>
          )}
          {isWeb && connectionState === 'auth-failed' && !reauthenticated && (
            <WebReauthenticationOverlay
              onAuthenticate={reauthenticate}
              onAuthenticated={() => setReauthenticated(true)}
              onDiscard={() => onWebSessionRequired?.()}
            />
          )}
        </>
      )}
    </>
  );
}
