import React from 'react';
import { OnCallRow } from '@shared/ipc';
import { formatPhoneNumber } from '@shared/phoneUtils';
import { Tooltip } from '../Tooltip';
import { useToast } from '../Toast';
import { formatTimeWindow, isTimeWindowActive } from '../../utils/timeParsing';
import { useIsTruncated } from '../../hooks/useIsTruncated';
import { formatFailure } from '../../utils/failureMessage';
import { ON_CALL_ROLE_CODES, getOnCallRoleKind, getOnCallRoleLabel } from '../../utils/onCallRoles';

interface TeamRowProps {
  row: OnCallRow;
  /** Display-only fallback: the directory number for a row saved without one (unique name match). */
  directoryPhone?: string;
  hasAnyTimeWindow: boolean;
  gridTemplate?: string;
  tick?: number;
}

/** The row's window in 12-hour local time; the Tooltip keeps the saved wording when that differs. */
const TeamRowTime: React.FC<{ savedWindow: string; now: Date; isActive: boolean }> = ({
  savedWindow,
  now,
  isActive,
}) => {
  const display = formatTimeWindow(savedWindow, now) || '\u00A0';
  const tooltip = display === savedWindow ? savedWindow : `Saved as ${savedWindow}`;
  return (
    <div className="team-row-bottom team-row-bottom--time-only">
      <Tooltip content={savedWindow ? tooltip : ''}>
        {isActive ? (
          <span className="team-row-time-status">
            <span className="team-row-time-window team-row-time-window--active">{display}</span>
            <span className="team-row-active-pill">Active now</span>
          </span>
        ) : (
          <span
            className={`team-row-time-window${savedWindow ? '' : ' team-row-time-window--hidden'}`}
          >
            {display}
          </span>
        )}
      </Tooltip>
    </div>
  );
};

export const TeamRow: React.FC<TeamRowProps> = React.memo(
  ({ row, directoryPhone, hasAnyTimeWindow, gridTemplate: _gridTemplate, tick }) => {
    const { showToast } = useToast();
    const now = new Date(tick ?? Date.now());
    const savedWindow = row.timeWindow || '';
    const isActive = isTimeWindowActive(savedWindow, now);
    const [nameRef, nameTruncated] = useIsTruncated<HTMLSpanElement>(row.name || '');

    const roleKind = getOnCallRoleKind(row.role);
    const isFromDirectory = !row.contact && !!directoryPhone;
    const phone = row.contact || directoryPhone || '';

    const handleCopyContact = async () => {
      if (!phone) return;
      const success = await globalThis.api?.writeClipboard(phone);
      if (success) {
        showToast(`Copied ${phone}`, 'success');
      } else {
        // Silence here reads as success — the user pastes whatever was on the
        // clipboard before into a dialer. The Web runtime has no bridge at all.
        showToast(
          formatFailure({
            what: `Couldn't copy ${phone}`,
            error: 'Clipboard access was blocked',
            outcome: 'Nothing was copied.',
            next: 'Dial it from the board, or allow clipboard access and try again.',
          }),
          'error',
        );
      }
    };

    const roleText = getOnCallRoleLabel(row.role);
    const roleCode = ON_CALL_ROLE_CODES[roleKind];
    const displayName = row.name || '—';
    const phoneDisplay = formatPhoneNumber(phone);
    const copyLabel = isFromDirectory
      ? `Copy contact ${phone} (from Contacts)`
      : `Copy contact ${phone}`;
    const phoneTooltip = isFromDirectory
      ? 'Number from Contacts; this on-call entry has none saved. Click to copy.'
      : 'Click to copy';
    const rowClassName = `team-row${isActive ? ' team-row--active' : ''}${roleKind === 'primary' ? ' team-row--primary' : ''}${roleKind === 'backup' ? ' team-row--backup' : ''}`;

    return (
      <div className={rowClassName}>
        <div className="team-row-top">
          <div className="team-row-name-wrapper">
            {/* One role marker per width, never both: wide rows say the full role word after the
                name; narrow rows (container CSS, below 13em) swap it for this fixed-width code.
                role="img" makes screen readers announce the role name, not the code; it is not a
                tab stop, so a row costs one Tab (its phone button) plus the name only when cut off. */}
            <Tooltip content={`${roleText} (${roleCode})`}>
              <span
                className={`team-row-role-code team-row-role-code--${roleKind}`}
                role="img"
                aria-label={`${roleText} role`}
              >
                {roleCode}
              </span>
            </Tooltip>
            <Tooltip content={row.name || ''}>
              <span
                ref={nameRef}
                className={`team-row-name${row.name ? '' : ' team-row-name--empty'}`}
                // Focusable only while a name wider than the row ellipsizes: focus then reveals
                // the full name (WAI-ARIA tooltip pattern) without a dead stop on every row.
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                tabIndex={row.name && nameTruncated ? 0 : undefined}
              >
                {displayName}
              </span>
            </Tooltip>
            <span className="team-row-role-word">
              <span className="team-row-role-word-separator" aria-hidden="true">
                ·{' '}
              </span>
              {roleText}
            </span>
            {/* After the name, so the fixed-width role codes keep every name aligned. */}
            {isActive && <span className="team-row-active-indicator" />}
          </div>
          <Tooltip content={phoneTooltip}>
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
              className={`team-row-phone${phone ? '' : ' team-row-phone--empty'}`}
              disabled={!phone}
              aria-label={phone ? copyLabel : 'No contact available'}
            >
              {phoneDisplay}
              {isFromDirectory && <span className="team-row-phone-source">from Contacts</span>}
            </button>
          </Tooltip>
        </div>
        {hasAnyTimeWindow && (
          <TeamRowTime savedWindow={savedWindow} now={now} isActive={isActive} />
        )}
      </div>
    );
  },
);
