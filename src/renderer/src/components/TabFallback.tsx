import { TactileButton } from './TactileButton';

type TabFallbackProps = Readonly<{ error?: boolean; onReset?: () => void }>;

export const TabFallback = ({ error, onReset }: TabFallbackProps) => (
  <div className="tab-fallback">
    {error ? (
      <div className="tab-fallback-error panel-error ink-rail ink-rail--alarm" role="alert">
        <svg
          className="tab-fallback-error-icon"
          aria-hidden="true"
          focusable="false"
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
        <div className="tab-fallback-copy">
          <p className="tab-fallback-message">This tab failed to load</p>
          <p className="tab-fallback-hint">
            Try again first. Reload Application restarts the whole window; if it keeps failing,
            check data and config in Settings.
          </p>
        </div>
        <div className="tab-fallback-actions">
          {onReset && (
            <TactileButton variant="primary" size="sm" onClick={onReset}>
              Try Again
            </TactileButton>
          )}
          <TactileButton
            variant={onReset ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => globalThis.location.reload()}
          >
            Reload Application
          </TactileButton>
        </div>
      </div>
    ) : (
      <div className="animate-spin tab-fallback-spinner" />
    )}
  </div>
);
