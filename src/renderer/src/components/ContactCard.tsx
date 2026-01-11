import React, { memo, useState, useRef, useEffect } from 'react';
import { getColorForString } from '../utils/colors';
import { formatPhoneNumber } from '@shared/phoneUtils';
import { Tooltip } from './Tooltip';
import { GroupPill, getInitials, Avatar } from './shared/AvatarUtils';

type ContactRowProps = { name: string; email: string; title?: string; phone?: string; avatarColor?: string; action?: React.ReactNode; style?: React.CSSProperties; className?: string; sourceLabel?: string; groups?: string[]; selected?: boolean; onContextMenu?: (e: React.MouseEvent, contact: { name: string; email: string; title?: string; phone?: string; groups?: string[] }) => void; onRowClick?: () => void };

const isValidName = (name: string) => name && name.replace(/[.\s\-_]/g, '').length > 0;

export const ContactCard = memo(({ name, email, title, phone, avatarColor, action, style, sourceLabel, groups = [], selected, onContextMenu, onRowClick }: ContactRowProps) => {
  const colorScheme = getColorForString(name || email);
  const color = avatarColor || colorScheme.text;
  const formattedPhone = formatPhoneNumber(phone || '');
  const displayName = isValidName(name) ? name : email;

  return (
    <div onContextMenu={(e) => onContextMenu?.(e, { name, email, title, phone, groups })} onClick={onRowClick} style={{ width: '100%', height: '100%', ...style, display: 'flex', alignItems: 'center' }}>
      <div style={{ width: '100%', height: 'calc(100% - 8px)', display: 'flex', alignItems: 'center', paddingLeft: '20px', paddingRight: '20px', background: selected ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255, 255, 255, 0.02)', border: selected ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', gap: '16px', transition: 'all 0.2s ease', cursor: 'default', position: 'relative', overflow: 'hidden' }} className="contact-card-hover">
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', background: color, opacity: 0.6 }} />
        <Avatar name={name} email={email} />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: '4px', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden', minWidth: 0 }}>
            <Tooltip content={displayName}><span className="text-balance break-word" style={{ fontSize: '22px', fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: '-0.02em', display: 'block', lineHeight: 1.2 }}>{displayName}</span></Tooltip>
            {sourceLabel && <span style={{ fontSize: '10px', background: 'rgba(255, 255, 255, 0.12)', color: 'var(--color-text-primary)', padding: '2px 6px', borderRadius: '4px', fontWeight: 900, textTransform: 'uppercase', flexShrink: 0, letterSpacing: '0.05em' }}>{sourceLabel}</span>}
          </div>
          <div style={{ fontSize: '15px', color: 'var(--color-text-secondary)', fontWeight: 550, display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
            {title && <Tooltip content={title}><span className="break-word" style={{ display: 'block', maxWidth: '100%' }}>{title}</span></Tooltip>}
            {title && <span style={{ opacity: 0.3, fontSize: '16px', flexShrink: 0 }}>|</span>}
            <Tooltip content={email}><span className="break-word" style={{ display: 'block', maxWidth: '100%', opacity: 0.8 }}>{email}</span></Tooltip>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, gap: '12px', justifyContent: 'flex-end' }}>
          {formattedPhone && <Tooltip content={formattedPhone}><span className="text-truncate" style={{ fontSize: '20px', color: '#60A5FA', fontWeight: 700, letterSpacing: '0.05em', minWidth: '160px', flexShrink: 0, display: 'block', textAlign: 'right' }}>{formattedPhone}</span></Tooltip>}
          {groups.length > 0 && (
            <Tooltip content={groups.join(', ')}><div style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'help', flexWrap: 'wrap', overflow: 'hidden' }}>
              {groups.slice(0, 2).map(g => <GroupPill key={g} group={g} />)}
              {groups.length > 2 && <span style={{ fontSize: '12px', color: 'var(--color-text-tertiary)', fontWeight: 700, background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '6px', flexShrink: 0 }}>+{groups.length - 2}</span>}
            </div></Tooltip>
          )}
        </div>
      </div>
      {action && <div className="row-actions" style={{ position: 'absolute', right: '32px', top: '50%', transform: 'translateY(-50%)', background: 'var(--color-bg-surface)', padding: '4px 8px', borderRadius: '8px', display: 'flex', gap: '4px', boxShadow: '0 4px 12px rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', zIndex: 10 }}>{action}</div>}
    </div>
  );
});
