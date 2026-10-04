import { useEffect, useState } from 'react';
import { TactileButton } from './TactileButton';
import { hasRelayCapability } from '../runtime/relayRuntime';

const AUTO_RETRY_SECONDS = 10;

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
  const canConfigureConnection = hasRelayCapability('connectionConfiguration');
  const [secondsLeft, setSecondsLeft] = useState(AUTO_RETRY_SECONDS);
  useEffect(() => {
    if (!retryable) return;
    // One-second ticks drive the visible countdown; the retry fires when it reaches zero.
    let remaining = AUTO_RETRY_SECONDS;
    setSecondsLeft(remaining);
    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        remaining = AUTO_RETRY_SECONDS;
        onRetry();
      }
      setSecondsLeft(remaining);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryable, onRetry]);

  return (
    <div className="app-state">
      {canConfigureConnection && (
        <button
          type="button"
          className="app-state__close-btn"
          onClick={() => globalThis.window.api?.windowClose()}
          aria-label="Close Relay"
        >
          &#10005;
        </button>
      )}
      <div className="app-state__error-icon" aria-hidden="true">
        !
      </div>
      <p className="app-state__error-text" role="alert">
        {message}
      </p>
      {retryable && <p className="app-state__text">Retrying in {secondsLeft}s…</p>}
      <div className="app-state__actions">
        {retryable && (
          <TactileButton variant="primary" onClick={onRetry}>
            Retry
          </TactileButton>
        )}
        {canConfigureConnection && (
          <TactileButton variant={retryable ? 'secondary' : 'primary'} onClick={onReconfigure}>
            Reconfigure
          </TactileButton>
        )}
      </div>
    </div>
  );
}
