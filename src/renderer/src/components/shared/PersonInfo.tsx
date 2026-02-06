import React from 'react';
import { Contact } from '@shared/ipc';
import { getColorForString } from '../../utils/colors';
import { Tooltip } from '../Tooltip';

export const getPlatformColor = (os: string = '') => {
  const lower = os.toLowerCase();
  if (lower.includes('win'))
    return {
      bg: 'rgba(59, 130, 246, 0.1)',
      border: 'rgba(59, 130, 246, 0.2)',
      text: '#60A5FA',
      label: 'WINDOWS',
    };
  if (
    lower.includes('lin') ||
    lower.includes('rhel') ||
    lower.includes('ubuntu') ||
    lower.includes('centos')
  )
    return {
      bg: 'rgba(249, 115, 22, 0.1)',
      border: 'rgba(249, 115, 22, 0.2)',
      text: '#FB923C',
      label: 'LINUX',
    };
  if (lower.includes('vmware') || lower.includes('esx'))
    return {
      bg: 'rgba(139, 92, 246, 0.1)',
      border: 'rgba(139, 92, 246, 0.2)',
      text: '#A78BFA',
      label: 'VMWARE',
    };
  return {
    bg: 'rgba(156, 163, 175, 0.1)',
    border: 'rgba(156, 163, 175, 0.2)',
    text: '#9CA3AF',
    label: os.toUpperCase() || 'UNKNOWN',
  };
};

interface PersonInfoProps {
  label: string;
  value: string;
  contactLookup: Map<string, Contact>;
}

export const PersonInfo: React.FC<PersonInfoProps> = ({ label, value, contactLookup }) => {
  if (!value || value === '-' || value === '0')
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.3 }}>
        <span
          style={{
            color: 'var(--color-text-tertiary)',
            fontWeight: 600,
            fontSize: '12px',
            width: '80px',
            letterSpacing: '0.05em',
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: '15px' }}>-</span>
      </div>
    );

  const parts = value
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p);
  const primaryStr = parts[0];
  const found = contactLookup.get(primaryStr.toLowerCase());
  const displayName = found ? found.name : primaryStr;
  const colorScheme = getColorForString(displayName);
  const allNames = parts
    .map((p) => {
      const c = contactLookup.get(p.toLowerCase());
      return c ? c.name : p;
    })
    .join('; ');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '15px' }}>
      <span
        style={{
          color: 'var(--color-text-tertiary)',
          fontWeight: 800,
          fontSize: '12px',
          width: '80px',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </span>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '10px',
            background: colorScheme.bg,
            color: colorScheme.text,
            border: `1px solid ${colorScheme.border}`,
            fontSize: '14px',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {displayName.charAt(0).toUpperCase()}
        </div>
        <Tooltip content={allNames}>
          <span
            className="text-truncate"
            style={{
              color: 'var(--color-text-primary)',
              fontWeight: 600,
              display: 'block',
              maxWidth: '100%',
            }}
          >
            {displayName}
            {parts.length > 1 && (
              <span style={{ opacity: 0.5, marginLeft: '6px', fontSize: '12px' }}>
                +{parts.length - 1}
              </span>
            )}
          </span>
        </Tooltip>
      </div>
    </div>
  );
};
