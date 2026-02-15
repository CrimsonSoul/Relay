import { memo } from 'react';
import { AMBER } from '../utils/colors';
import { Tooltip } from './Tooltip';
import { Avatar } from './shared/AvatarUtils';
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
  }: ContactRowProps) => {
    const color = avatarColor || AMBER.fill;
    const displayName = isValidName(name) ? name : email;

    return (
      <div
        role="button"
        tabIndex={0}
        onContextMenu={(e) => onContextMenu?.(e, { name, email, title, groups })}
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
          {phone && (
            <div className="contact-card-right">
              <span className="contact-card-phone">{formatPhoneNumber(phone)}</span>
            </div>
          )}
        </div>
        {action && <div className="row-actions contact-card-actions">{action}</div>}
      </div>
    );
  },
);
