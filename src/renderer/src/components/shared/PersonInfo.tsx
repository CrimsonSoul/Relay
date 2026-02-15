import React from 'react';
import { Contact } from '@shared/ipc';
import { Tooltip } from '../Tooltip';

export const getPlatformColor = (os: string = '') => {
  const lower = os.toLowerCase();
  if (lower.includes('win'))
    return {
      bg: 'rgba(245, 158, 11, 0.1)',
      border: 'rgba(245, 158, 11, 0.2)',
      text: '#FBBF24',
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
      <div className="person-info person-info--empty">
        <span className="person-info-label">{label}</span>
        <span className="person-info-empty-value">-</span>
      </div>
    );

  const parts = value
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p);
  const primaryStr = parts[0];
  const found = contactLookup.get(primaryStr.toLowerCase());
  const displayName = found ? found.name : primaryStr;
  const allNames = parts
    .map((p) => {
      const c = contactLookup.get(p.toLowerCase());
      return c ? c.name : p;
    })
    .join('; ');

  return (
    <div className="person-info">
      <span className="person-info-label person-info-label--strong">{label}</span>
      <div className="person-info-name-row">
        <div className="person-info-avatar">{displayName.charAt(0).toUpperCase()}</div>
        <Tooltip content={allNames}>
          <span className="text-truncate person-info-name">
            {displayName}
            {parts.length > 1 && (
              <span className="person-info-overflow-count">+{parts.length - 1}</span>
            )}
          </span>
        </Tooltip>
      </div>
    </div>
  );
};
