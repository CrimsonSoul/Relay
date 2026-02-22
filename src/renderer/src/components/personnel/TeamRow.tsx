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
  ({ row, hasAnyTimeWindow, gridTemplate, tick: _tick }) => {
    const { showToast } = useToast();
    // _tick is destructured to trigger re-render on interval ticks;
    // isTimeWindowActive checks the current time so it needs to run each render.
    const isActive = isTimeWindowActive(row.timeWindow || '');

    const isPrimary = useMemo(() => {
      const r = (row.role || '').toLowerCase();
      return r.includes('primary') || r === 'pri' || r.includes('network') || r.includes('telecom');
    }, [row.role]);

    const handleCopyContact = async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!row.contact) return;
      const success = await globalThis.api?.writeClipboard(row.contact);
      if (success) {
        showToast(`Copied ${row.contact}`, 'success');
      }
    };

    const roleText = getRoleLabel(row.role);

    const rowClassName = `team-row${isActive ? ' team-row--active' : ''}${isPrimary ? ' team-row--primary' : ''}`;

    return (
      <div
        className={rowClassName}
        style={{ gridTemplateColumns: gridTemplate }}
        aria-label={`${roleText}: ${row.name || 'Empty'} ${isActive ? '(Active now)' : ''} ${isPrimary ? '(Primary)' : ''}`}
      >
        {/* Role pill */}
        <Tooltip content={roleText}>
          <div aria-hidden="true" className="team-row-role">
            {roleText}
          </div>
        </Tooltip>

        {/* Name + active indicator */}
        <Tooltip content={row.name} block>
          <div className="team-row-name-wrapper">
            {isActive && <div className="animate-active-indicator team-row-active-indicator" />}
            <div className={`team-row-name${row.name ? '' : ' team-row-name--empty'}`}>
              {row.name || '—'}
            </div>
          </div>
        </Tooltip>

        {/* Phone number */}
        <Tooltip content="Click to copy">
          <button
            type="button"
            onClick={handleCopyContact}
            className={`team-row-phone${row.contact ? '' : ' team-row-phone--empty'}`}
          >
            {formatPhoneNumber(row.contact)}
          </button>
        </Tooltip>

        {/* Time window */}
        {hasAnyTimeWindow && (
          <Tooltip content={row.timeWindow || ''}>
            <div
              className={`team-row-time-window${isActive ? ' team-row-time-window--active' : ''}${row.timeWindow ? '' : ' team-row-time-window--hidden'}`}
            >
              {row.timeWindow || '\u00A0'}
            </div>
          </Tooltip>
        )}
      </div>
    );
  },
);
