import { ReactNode } from 'react';
import type { PbAuthSession } from '@shared/ipc';
import { usePocketBase } from '../hooks/usePocketBase';
import { ConnectionStatus } from './ConnectionStatus';
import { TactileButton } from './TactileButton';

interface ConnectionManagerProps {
  readonly pbUrl: string;
  readonly pbAuth: PbAuthSession;
  readonly onReconfigure: () => void;
  readonly children: ReactNode;
}

export function ConnectionManager({
  pbUrl,
  pbAuth,
  onReconfigure,
  children,
}: ConnectionManagerProps) {
  const { connectionState } = usePocketBase(pbUrl, pbAuth);

  if (connectionState === 'connecting') {
    return (
      <div className="app-state">
        <button
          className="app-state__close-btn"
          onClick={() => globalThis.window.api?.windowClose()}
          aria-label="Close"
        >
          &#10005;
        </button>
        <div className="app-state__spinner" />
        <p className="app-state__text">Connecting to server...</p>
        <TactileButton variant="secondary" onClick={onReconfigure}>
          Reconfigure
        </TactileButton>
      </div>
    );
  }

  return (
    <>
      {children}
      <ConnectionStatus />
    </>
  );
}
