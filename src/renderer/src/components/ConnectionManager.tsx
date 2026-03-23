import { ReactNode } from 'react';
import { usePocketBase } from '../hooks/usePocketBase';
import { ConnectionStatus } from './ConnectionStatus';
import { TactileButton } from './TactileButton';

interface ConnectionManagerProps {
  readonly pbUrl: string;
  readonly pbSecret: string;
  readonly onReconfigure: () => void;
  readonly children: ReactNode;
}

export function ConnectionManager({
  pbUrl,
  pbSecret,
  onReconfigure,
  children,
}: ConnectionManagerProps) {
  const { connectionState, error } = usePocketBase(pbUrl, pbSecret);

  if (error) {
    return (
      <div className="app-state">
        <button
          className="app-state__close-btn"
          onClick={() => globalThis.window.api?.windowClose()}
          aria-label="Close"
        >
          &#10005;
        </button>
        <div className="app-state__error-icon" aria-hidden="true">
          !
        </div>
        <p className="app-state__error-text">{error}</p>
        <TactileButton variant="primary" onClick={onReconfigure}>
          Reconfigure
        </TactileButton>
      </div>
    );
  }

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
