import { memo } from 'react';
import { Avatar, GroupPill } from './shared/AvatarUtils';
import { formatPhoneNumber } from '@shared/phoneUtils';
import { Tooltip } from './Tooltip';
import { TactileButton } from './TactileButton';
import { RowActionsButton, type RowMenuAnchor } from './directory/RowActionsButton';

type ContactRowProps = {
  name: string;
  email: string;
  title?: string;
  phone?: string;
  action?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  /** Provenance badge (e.g. Manual) distinguishing hand-typed from group-derived rows. */
  sourceLabel?: string;
  groups?: string[];
  selected?: boolean;
  /** The row an open context menu, notes editor or delete confirmation is acting on. */
  menuTarget?: boolean;
  onContextMenu?: (
    e: React.MouseEvent,
    contact: { name: string; email: string; title?: string; phone?: string; groups?: string[] },
  ) => void;
  onRowClick?: () => void;
  /** Opens the row's actions menu from its narrow-window `⋯` button; omit for no button. */
  onOpenActions?: (anchor: RowMenuAnchor) => void;
  hasNotes?: boolean;
  tags?: string[];
  onNotesClick?: () => void;
  relationshipCounts?: {
    owned: number;
    supported: number;
  };
  recordKey?: string;
};

export const ContactCard = memo(
  ({
    name,
    email,
    title,
    phone,
    action,
    style,
    className,
    sourceLabel,
    groups = [],
    selected,
    menuTarget,
    onContextMenu,
    onRowClick,
    onOpenActions,
    hasNotes,
    tags,
    onNotesClick,
    relationshipCounts,
    recordKey,
  }: ContactRowProps) => {
    const displayPhone = phone ? formatPhoneNumber(phone) : '';
    const displayName = name || email;
    const tooltipContent = [displayName, email, title, displayPhone].filter(Boolean).join('\n');
    const primaryTag = tags?.[0];
    const showNotesButton = hasNotes && onNotesClick;

    // The row is a plain container so the record button and the per-row actions are
    // siblings: nesting interactive controls inside a <button> is invalid HTML and
    // makes the inner controls unreachable for assistive technology.
    return (
      <div
        className={`contact-entry ${selected ? 'contact-entry--selected' : ''} ${menuTarget ? 'contact-entry--menu-target' : ''} ${className || ''}`}
        style={style}
        onContextMenu={(e) => onContextMenu?.(e, { name, email, title, groups })}
      >
        <button
          type="button"
          data-record-key={recordKey}
          className="contact-entry-main"
          onClick={onRowClick}
        >
          <Avatar name={name} email={email} className="contact-entry-avatar" />
          <div className="contact-entry-body">
            <Tooltip content={tooltipContent} position="right">
              <div className="contact-entry-tooltip-anchor">
                <div className="contact-entry-line1">
                  <span className="contact-entry-name">{displayName}</span>
                  {primaryTag && <GroupPill group={primaryTag} />}
                  {sourceLabel && <span className="contact-entry-chip">{sourceLabel}</span>}
                  {relationshipCounts && relationshipCounts.owned > 0 && (
                    <span className="contact-entry-chip">
                      Owns {pluralizeServers(relationshipCounts.owned)}
                    </span>
                  )}
                  {relationshipCounts && relationshipCounts.supported > 0 && (
                    <span className="contact-entry-chip">
                      Supports {pluralizeServers(relationshipCounts.supported)}
                    </span>
                  )}
                </div>
                <div className="contact-entry-line2">
                  {email && <span>{email}</span>}
                  {title && (
                    <>
                      <span className="contact-entry-dot" aria-hidden="true">
                        ·
                      </span>
                      <span>{title}</span>
                    </>
                  )}
                  {displayPhone && (
                    <>
                      <span className="contact-entry-dot" aria-hidden="true">
                        ·
                      </span>
                      <span className="contact-entry-phone">{displayPhone}</span>
                    </>
                  )}
                </div>
              </div>
            </Tooltip>
          </div>
        </button>
        {(action || showNotesButton) && (
          <div className="contact-entry-actions">
            {action}
            {showNotesButton && (
              <TactileButton
                variant="ghost"
                size="xs"
                aria-label={`Edit notes for ${displayName}`}
                icon={
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                }
                onClick={onNotesClick}
              />
            )}
          </div>
        )}
        {onOpenActions && <RowActionsButton name={displayName} onOpen={onOpenActions} />}
      </div>
    );
  },
);

function pluralizeServers(count: number): string {
  return `${count} ${count === 1 ? 'server' : 'servers'}`;
}

ContactCard.displayName = 'ContactCard';
