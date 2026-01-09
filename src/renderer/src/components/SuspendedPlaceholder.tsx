import React from 'react';
import { TactileButton } from '../components/TactileButton';

interface SuspendedPlaceholderProps { service: string; onWakeUp: () => void }

export const SuspendedPlaceholder: React.FC<SuspendedPlaceholderProps> = ({ service, onWakeUp }) => (
  <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0B0D12', color: 'var(--color-text-secondary)' }}>
    <div style={{ fontSize: '24px', marginBottom: '16px' }}>💤</div>
    <div style={{ fontSize: '16px', marginBottom: '24px' }}>{service} is sleeping to save power</div>
    <TactileButton variant="primary" onClick={onWakeUp}>WAKE UP</TactileButton>
  </div>
);
