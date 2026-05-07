import { memo } from 'react';
import { Avatar, GroupPill } from './shared/AvatarUtils';
import { formatPhoneNumber } from '@shared/phoneUtils';
import { Tooltip } from './Tooltip';

type ContactRowProps = {
  name: string;
  email: string;
  title?: string;
  phone?: string;
  action?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  groups?: string[];
  selected?: boolean;
  onContextMenu?: (
    e: React.MouseEvent,
    contact: { name: string; email: string; title?: string; phone?: string; groups?: string[] },
  ) => void;
  onRowClick?: () => void;
  hasNotes?: boolean;
  tags?: string[];
  onNotesClick?: () => void;
  relationshipCounts?: {
    owned: number;
    supported: number;
  };
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
    groups = [],
    selected,
    onContextMenu,
    onRowClick,
    hasNotes,
    tags,
    onNotesClick,
    relationshipCounts,
  }: ContactRowProps) => {
    const displayPhone = phone ? formatPhoneNumber(phone) : '';
    const tooltipContent = [name || email, email, title, displayPhone].filter(Boolean).join('\n');

    return (
      <button
        type="button"
        className={`contact-entry ${selected ? 'contact-entry--selected' : ''} ${className || ''}`}
        style={style}
        onContextMenu={(e) => onContextMenu?.(e, { name, email, title, groups })}
        onClick={onRowClick}
      >
        <Avatar name={name} email={email} className="contact-entry-avatar" />
        <div className="contact-entry-body">
          <Tooltip content={tooltipContent} position="right">
            <div className="contact-entry-tooltip-anchor">
              <div className="contact-entry-line1">
                <span className="contact-entry-name">{name || email}</span>
                {tags && tags.length > 0 && <GroupPill group={tags[0]} />}
                {relationshipCounts && relationshipCounts.owned > 0 && (
                  <span className="contact-entry-chip">Owner {relationshipCounts.owned}</span>
                )}
                {relationshipCounts && relationshipCounts.supported > 0 && (
                  <span className="contact-entry-chip">Support {relationshipCounts.supported}</span>
                )}
              </div>
              <div className="contact-entry-line2">
                {email && <span>{email}</span>}
                {title && (
                  <>
                    <span className="contact-entry-dot">·</span>
                    <span>{title}</span>
                  </>
                )}
                {displayPhone && (
                  <>
                    <span className="contact-entry-dot">·</span>
                    <span className="contact-entry-phone">{displayPhone}</span>
                  </>
                )}
              </div>
            </div>
          </Tooltip>
        </div>
        <div className="contact-entry-actions">
          {action}
          {hasNotes && onNotesClick && (
            <button
              className="contact-entry-notes-btn"
              onClick={(e) => {
                e.stopPropagation();
                onNotesClick();
              }}
            >
              📝
            </button>
          )}
        </div>
      </button>
    );
  },
);

ContactCard.displayName = 'ContactCard';
