import { useEffect } from 'react';
import { TactileButton } from './TactileButton';

const AUTO_RETRY_INTERVAL_MS = 10_000;

interface StartupErrorScreenProps {
  readonly message: string;
  /** Retryable errors (server unreachable / timeout) auto-retry; auth/config errors do not. */
  readonly retryable: boolean;
  readonly onRetry: () => void;
  readonly onReconfigure: () => void;
}

export function StartupErrorScreen({
  message,
  retryable,
  onRetry,
  onReconfigure,
}: StartupErrorScreenProps) {
  useEffect(() => {
    if (!retryable) return;
    const timer = setInterval(onRetry, AUTO_RETRY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [retryable, onRetry]);

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
      <p className="app-state__error-text">{message}</p>
      {retryable && <p className="app-state__text">Retrying automatically…</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        {retryable && (
          <TactileButton variant="primary" onClick={onRetry}>
            Retry
          </TactileButton>
        )}
        <TactileButton variant={retryable ? 'secondary' : 'primary'} onClick={onReconfigure}>
          Reconfigure
        </TactileButton>
      </div>
    </div>
  );
}
