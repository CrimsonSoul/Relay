import React, { useMemo } from 'react';
import { OnCallRow } from '@shared/ipc';
import { formatPhoneNumber } from '@shared/phoneUtils';
import { Tooltip } from '../Tooltip';
import { useToast } from '../Toast';
import { isTimeWindowActive } from '../../utils/timeParsing';

interface TeamRowProps {
  row: OnCallRow;
  hasAnyTimeWindow: boolean;
  gridTemplate?: string;
  tick?: number;
}

type OnCallRoleKind = 'primary' | 'backup' | 'member';

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

const getRoleKind = (role: string): OnCallRoleKind => {
  const r = (role || '').toLowerCase();
  if (r.includes('primary') || r === 'pri' || r.includes('network') || r.includes('telecom')) {
    return 'primary';
  }
  if (r.includes('secondary') || r.includes('backup') || r.includes('weekend')) {
    return 'backup';
  }
  return 'member';
};

const getRoleCode = (roleKind: OnCallRoleKind) => {
  if (roleKind === 'primary') return 'PRI';
  if (roleKind === 'backup') return 'BKP';
  return 'MEM';
};

export const TeamRow: React.FC<TeamRowProps> = React.memo(
  ({ row, hasAnyTimeWindow, gridTemplate: _gridTemplate, tick: _tick }) => {
    const { showToast } = useToast();
    const isActive = isTimeWindowActive(row.timeWindow || '');

    const roleKind = useMemo(() => getRoleKind(row.role), [row.role]);

    const handleCopyContact = async () => {
      if (!row.contact) return;
      const success = await globalThis.api?.writeClipboard(row.contact);
      if (success) {
        showToast(`Copied ${row.contact}`, 'success');
      }
    };

    const roleText = getRoleLabel(row.role);
    const roleCode = getRoleCode(roleKind);
    const displayName = row.name || '—';
    const phoneDisplay = formatPhoneNumber(row.contact);
    const rowClassName = `team-row${isActive ? ' team-row--active' : ''}${roleKind === 'primary' ? ' team-row--primary' : ''}${roleKind === 'backup' ? ' team-row--backup' : ''}`;
    const timeClasses = `team-row-time-window${isActive ? ' team-row-time-window--active' : ''}${row.timeWindow ? '' : ' team-row-time-window--hidden'}`;

    return (
      <div className={rowClassName}>
        <div className="team-row-top">
          <div className="team-row-name-wrapper">
            <span
              className={`team-row-role-code team-row-role-code--${roleKind}`}
              aria-label={`${roleText} assignment`}
            >
              {roleCode}
            </span>
            {isActive && <span className="team-row-active-indicator" />}
            <Tooltip content={row.name || ''}>
              <span className={`team-row-name${row.name ? '' : ' team-row-name--empty'}`}>
                {displayName}
              </span>
            </Tooltip>
          </div>
          <Tooltip content="Click to copy">
            <button
              type="button"
              onClick={() => {
                void handleCopyContact();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void handleCopyContact();
                }
              }}
              className={`team-row-phone${row.contact ? '' : ' team-row-phone--empty'}`}
              disabled={!row.contact}
              aria-label={row.contact ? `Copy contact ${row.contact}` : 'No contact available'}
            >
              {phoneDisplay}
            </button>
          </Tooltip>
        </div>
        {hasAnyTimeWindow && (
          <div className="team-row-bottom team-row-bottom--time-only">
            <Tooltip content={row.timeWindow || ''}>
              <span className={isActive ? 'team-row-time-status' : timeClasses}>
                {isActive ? (
                  <>
                    <span className="team-row-time-window team-row-time-window--active">
                      {row.timeWindow || '\u00A0'}
                    </span>
                    <span className="team-row-active-pill">ACTIVE NOW</span>
                  </>
                ) : (
                  row.timeWindow || '\u00A0'
                )}
              </span>
            </Tooltip>
          </div>
        )}
      </div>
    );
  },
);
