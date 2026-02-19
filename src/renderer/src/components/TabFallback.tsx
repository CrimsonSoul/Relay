import React from 'react';
import { TactileButton } from './TactileButton';

export const TabFallback = ({ error }: { error?: boolean }) => (
  <div className="tab-fallback">
    {error ? (
      <>
        <div className="tab-fallback-error-icon">⚠️</div>
        <div className="tab-fallback-message">This tab failed to load</div>
        <div className="tab-fallback-hint">
          Try reloading. If it keeps failing, check data/config in Settings.
        </div>
        <TactileButton variant="secondary" size="sm" onClick={() => window.location.reload()}>
          Reload Tab
        </TactileButton>
      </>
    ) : (
      <div className="animate-spin tab-fallback-spinner" />
    )}
  </div>
);
