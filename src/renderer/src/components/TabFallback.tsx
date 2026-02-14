import React from 'react';
import { TactileButton } from './TactileButton';

export const TabFallback = ({ error }: { error?: boolean }) => (
  <div className="tab-fallback">
    {error ? (
      <>
        <div className="tab-fallback-error-icon">⚠️</div>
        <div>Failed to load tab</div>
        <TactileButton variant="secondary" size="small" onClick={() => window.location.reload()}>
          Reload
        </TactileButton>
      </>
    ) : (
      <div className="animate-spin tab-fallback-spinner" />
    )}
  </div>
);
