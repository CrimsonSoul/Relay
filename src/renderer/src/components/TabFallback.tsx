
import React from 'react';
import { TactileButton } from './TactileButton';

export const TabFallback = ({ error }: { error?: boolean }) => (
  <div style={{
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--color-text-tertiary)',
    fontSize: '13px',
    gap: '12px'
  }}>
    {error ? (
      <>
        <div style={{ fontSize: '24px', opacity: 0.5 }}>⚠️</div>
        <div>Failed to load tab</div>
        <TactileButton 
          variant="secondary" 
          size="small" 
          onClick={() => window.location.reload()}
        >
          Reload
        </TactileButton>
      </>
    ) : (
      <div className="animate-spin" style={{
        width: '24px',
        height: '24px',
        border: '2px solid rgba(255, 255, 255, 0.1)',
        borderTopColor: 'var(--color-accent-blue)',
        borderRadius: '50%'
      }} />
    )}
  </div>
);
