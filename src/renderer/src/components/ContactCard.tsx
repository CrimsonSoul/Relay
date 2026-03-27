import { memo } from 'react';
import { Avatar, GroupPill } from './shared/AvatarUtils';
import { formatPhoneNumber } from '@shared/phoneUtils';

type ContactRowProps = {
  name: string;
  email: string;
  title?: string;
  phone?: string;
  avatarColor?: string;
  action?: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
  sourceLabel?: string;
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
  }: ContactRowProps) => {
    return (
      <div
        className={`contact-entry ${selected ? 'contact-entry--selected' : ''} ${className || ''}`}
        style={style}
        onContextMenu={(e) => onContextMenu?.(e, { name, email, title, groups })}
        onClick={onRowClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onRowClick?.();
        }}
      >
        <Avatar name={name} email={email} className="contact-entry-avatar" />
        <div className="contact-entry-body">
          <div className="contact-entry-line1">
            <span className="contact-entry-name">{name || email}</span>
            {tags && tags.length > 0 && <GroupPill group={tags[0]} />}
          </div>
          <div className="contact-entry-line2">
            {email && <span>{email}</span>}
            {title && (
              <>
                <span className="contact-entry-dot">·</span>
                <span>{title}</span>
              </>
            )}
            {phone && (
              <>
                <span className="contact-entry-dot">·</span>
                <span className="contact-entry-phone">{formatPhoneNumber(phone)}</span>
              </>
            )}
          </div>
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
      </div>
    );
  },
);

ContactCard.displayName = 'ContactCard';
