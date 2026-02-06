import React, { useMemo } from 'react';
import { OnCallRow } from '@shared/ipc';
import { formatPhoneNumber } from '@shared/phoneUtils';
import { Tooltip } from '../Tooltip';
import { useToast } from '../Toast';
import { isTimeWindowActive } from '../../utils/timeParsing';

interface TeamRowProps {
  row: OnCallRow;
  hasAnyTimeWindow: boolean;
  gridTemplate: string;
  tick?: number;
}

const getRoleLabel = (role: string) => {
  const r = (role || '').toLowerCase();
  if (r.includes('primary')) return 'Primary';
  if (r.includes('secondary')) return 'Secondary';
  if (r.includes('backup/weekend')) return 'Backup/Wknd';
  if (r.includes('backup')) return 'Backup';
  if (r.includes('shadow')) return 'Shadow';
  if (r.includes('escalation')) return 'Escalation';
  if (r.includes('network')) return 'Network';
  if (r.includes('telecom')) return 'Telecom';
  if (r.includes('weekend')) return 'Weekend';
  if (!role || r === 'member') return 'Member';
  return role;
};

export const TeamRow: React.FC<TeamRowProps> = React.memo(
  ({ row, hasAnyTimeWindow, gridTemplate, tick }) => {
    const { showToast } = useToast();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick is intentionally included to force re-evaluation on interval ticks
    const isActive = useMemo(
      () => isTimeWindowActive(row.timeWindow || ''),
      [row.timeWindow, tick],
    );

    const isPrimary = useMemo(() => {
      const r = (row.role || '').toLowerCase();
      return r.includes('primary') || r === 'pri';
    }, [row.role]);

    const handleCopyContact = async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!row.contact) return;
      const success = await window.api?.writeClipboard(row.contact);
      if (success) {
        showToast(`Copied ${row.contact}`, 'success');
      }
    };

    const roleText = getRoleLabel(row.role);

    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: gridTemplate,
          gap: '10px',
          alignItems: 'center',
          padding: '7px 10px',
          borderRadius: '8px',
          background: isActive
            ? 'rgba(52, 211, 153, 0.04)'
            : isPrimary
              ? 'rgba(255, 255, 255, 0.02)'
              : 'transparent',
          borderLeft: isPrimary ? '2px solid rgba(255, 255, 255, 0.25)' : '2px solid transparent',
          transition: 'all 0.3s ease',
          position: 'relative',
        }}
        role="group"
        aria-label={`${roleText}: ${row.name || 'Empty'} ${isActive ? '(Active now)' : ''} ${isPrimary ? '(Primary)' : ''}`}
      >
        {/* Role pill */}
        <Tooltip content={roleText}>
          <div
            aria-hidden="true"
            style={{
              fontSize: '11px',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              whiteSpace: 'nowrap',
              color: isPrimary ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              background: isPrimary ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)',
              padding: '4px 10px',
              borderRadius: '6px',
              textAlign: 'center',
              lineHeight: 1.4,
            }}
          >
            {roleText}
          </div>
        </Tooltip>

        {/* Name + active indicator */}
        <Tooltip content={row.name} block>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            {isActive && (
              <div
                className="animate-active-indicator"
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#34D399',
                  boxShadow: '0 0 6px rgba(52, 211, 153, 0.6)',
                  flexShrink: 0,
                }}
              />
            )}
            <div
              style={{
                color: row.name
                  ? isPrimary
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-secondary)'
                  : 'var(--color-text-quaternary)',
                fontSize: isPrimary ? '22px' : '20px',
                fontWeight: isPrimary ? 650 : 500,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {row.name || '—'}
            </div>
          </div>
        </Tooltip>

        {/* Phone number */}
        <Tooltip content="Click to copy">
          <div
            role="button"
            tabIndex={0}
            onClick={handleCopyContact}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                void handleCopyContact(e as unknown as React.MouseEvent);
              }
            }}
            style={{
              color: row.contact
                ? isPrimary
                  ? 'var(--color-text-primary)'
                  : 'var(--color-text-secondary)'
                : 'var(--color-text-quaternary)',
              fontSize: isPrimary ? '20px' : '18px',
              fontFamily: 'var(--font-mono)',
              textAlign: 'right',
              whiteSpace: 'nowrap',
              fontWeight: isPrimary ? 700 : 500,
              cursor: row.contact ? 'pointer' : 'default',
              transition: 'color 0.15s ease',
              letterSpacing: '0.03em',
            }}
            onMouseEnter={(e) => {
              if (row.contact) e.currentTarget.style.color = 'var(--color-accent-blue-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = row.contact
                ? isPrimary
                  ? 'var(--color-text-primary)'
                  : 'var(--color-text-secondary)'
                : 'var(--color-text-quaternary)';
            }}
          >
            {formatPhoneNumber(row.contact)}
          </div>
        </Tooltip>

        {/* Time window */}
        {hasAnyTimeWindow && (
          <Tooltip content={row.timeWindow || ''}>
            <div
              style={{
                color: isActive ? '#34D399' : 'var(--color-text-quaternary)',
                fontSize: '13px',
                fontWeight: 500,
                textAlign: 'right',
                whiteSpace: 'nowrap',
                visibility: row.timeWindow ? 'visible' : 'hidden',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.01em',
                minWidth: '80px',
              }}
            >
              {row.timeWindow || '\u00A0'}
            </div>
          </Tooltip>
        )}
      </div>
    );
  },
);
