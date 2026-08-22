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

  if (connectionState === 'connecting') {
    return (
      <div className="app-state">
        {!isWeb && (
          <button
            type="button"
            className="app-state__close-btn"
            onClick={() => globalThis.window.api?.windowClose()}
            aria-label="Close"
          >
            &#10005;
          </button>
        )}
        <div className="app-state__spinner" />
        <p className="app-state__text">Connecting to server...</p>
        {!isWeb && (
          <TactileButton variant="secondary" onClick={onReconfigure}>
            Reconfigure
          </TactileButton>
        )}
      </div>
    );
  }

  return (
    <>
      {children}
      {isWeb && (connectionState === 'offline' || connectionState === 'reconnecting') && (
        <div className="web-connection-status" data-testid="connection-status" role="status">
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
  );
}
