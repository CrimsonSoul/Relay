
import React from 'react';

export const TabFallback = () => (
  <div style={{
    height: '100%',
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--color-text-tertiary)',
    fontSize: '13px'
  }}>
    <div className="animate-spin" style={{
      width: '24px',
      height: '24px',
      border: '2px solid rgba(255, 255, 255, 0.1)',
      borderTopColor: 'var(--color-accent-blue)',
      borderRadius: '50%'
    }} />
  </div>
);
