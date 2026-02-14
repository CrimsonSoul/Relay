import { memo } from 'react';
import { getColorForString } from '../utils/colors';
import { formatPhoneNumber } from '@shared/phoneUtils';
import { Tooltip } from './Tooltip';
import { GroupPill, Avatar } from './shared/AvatarUtils';

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

const isValidName = (name: string) => name && name.replace(/[.\s\-_]/g, '').length > 0;

export const ContactCard = memo(
  ({
    name,
    email,
    title,
    phone,
    avatarColor,
    action,
    style,
    sourceLabel,
    groups = [],
    selected,
    onContextMenu,
    onRowClick,
    hasNotes,
    tags = [],
    onNotesClick,
  }: ContactRowProps) => {
    const colorScheme = getColorForString(name || email);
    const color = avatarColor || colorScheme.text;
    const formattedPhone = formatPhoneNumber(phone || '');
    const displayName = isValidName(name) ? name : email;

    return (
      <div
        role="button"
        tabIndex={0}
        onContextMenu={(e) => onContextMenu?.(e, { name, email, title, phone, groups })}
        onClick={onRowClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onRowClick?.();
          }
        }}
        className="contact-card"
        style={style}
      >
        <div
          className={`card-surface contact-card-body${selected ? ' contact-card-body--selected' : ''}`}
        >
          <div className="accent-strip" style={{ background: color }} />
          <Avatar name={name} email={email} />
          <div className="contact-card-info">
            <div className="contact-card-name-row">
              <Tooltip content={displayName}>
                <span className="text-balance break-word contact-card-name">{displayName}</span>
              </Tooltip>
              {sourceLabel && <span className="contact-card-source-label">{sourceLabel}</span>}
            </div>
            <div className="contact-card-meta">
              {title && (
                <Tooltip content={title}>
                  <span className="break-word contact-card-tooltip-span">{title}</span>
                </Tooltip>
              )}
              {title && <span className="contact-card-meta-separator">|</span>}
              <Tooltip content={email}>
                <span className="break-word contact-card-tooltip-span--faded">{email}</span>
              </Tooltip>
            </div>
          </div>
          <div className="contact-card-right">
            {tags.length > 0 && (
              <div className="server-card-tags">
                {tags.slice(0, 3).map((tag) => (
                  <span key={tag} className="server-card-tag">
                    #{tag}
                  </span>
                ))}
                {tags.length > 3 && (
                  <span className="server-card-tag-overflow">+{tags.length - 3}</span>
                )}
              </div>
            )}
            {hasNotes && (
              <Tooltip content="Click to view notes">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNotesClick?.();
                  }}
                  className="server-card-notes-btn"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                  </svg>
                </button>
              </Tooltip>
            )}
            {formattedPhone && (
              <Tooltip content={formattedPhone}>
                <span className="text-truncate contact-card-phone">{formattedPhone}</span>
              </Tooltip>
            )}
            {groups.length > 0 && (
              <Tooltip content={groups.join(', ')}>
                <div className="contact-card-groups">
                  {groups.slice(0, 2).map((g) => (
                    <GroupPill key={g} group={g} />
                  ))}
                  {groups.length > 2 && (
                    <span className="contact-card-group-overflow">+{groups.length - 2}</span>
                  )}
                </div>
              </Tooltip>
            )}
          </div>
        </div>
        {action && <div className="row-actions contact-card-actions">{action}</div>}
      </div>
    );
  },
);
