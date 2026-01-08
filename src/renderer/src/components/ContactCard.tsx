import React, { memo, useState, useRef, useEffect } from 'react';
import { getColorForString } from '../utils/colors';
import { formatPhoneNumber } from '../../../shared/phoneUtils';
import { Tooltip } from './Tooltip';

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
  onContextMenu?: (e: React.MouseEvent, contact: any) => void;
  onRowClick?: () => void;
};

const isValidName = (name: string) => {
  if (!name) return false;
  const stripped = name.replace(/[.\s\-_]/g, '');
  return stripped.length > 0;
};

const getInitials = (name: string, email: string) => {
  if (isValidName(name)) {
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  return (email && email.length > 0) ? email[0].toUpperCase() : '?';
};

const GroupPill = ({ group }: { group: string }) => {
  const c = getColorForString(group);

  return (
    <span
      style={{
        fontSize: '11px',
        color: c.text,
        background: c.bg,
        border: `1px solid ${c.border}`,
        padding: '2px 8px',
        borderRadius: '12px',
        fontWeight: 700,
        whiteSpace: 'nowrap'
      }}
    >
      {group.toUpperCase()}
    </span>
  );
};

export const ContactCard = memo(({ name, email, title, phone, avatarColor, action, style, className, sourceLabel, groups = [], selected, onContextMenu, onRowClick }: ContactRowProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isWide, setIsWide] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsWide(entry.contentRect.width > 900);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const colorScheme = getColorForString(name || email);
  const color = avatarColor || colorScheme.text;
  const formattedPhone = formatPhoneNumber(phone || '');
  const validName = isValidName(name);
  const displayName = validName ? name : email;

  const cardPadding = isWide ? 24 : 12;

  return (
    <div
      ref={containerRef}
      onContextMenu={(e) => onContextMenu?.(e, { name, email, title, phone, groups })}
      onClick={onRowClick}
      style={{
        width: '100%',
        height: '100%',
        ...style,
        display: 'flex',
        alignItems: 'center'
      }}
    >
      <div
        style={{
          width: '100%',
          height: 'calc(100% - 8px)',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: `${cardPadding + 4}px`,
          paddingRight: `${cardPadding}px`,
          background: selected ? 'rgba(59, 130, 246, 0.08)' : 'rgba(255, 255, 255, 0.02)',
          border: selected ? '1px solid rgba(59, 130, 246, 0.2)' : '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          gap: `${cardPadding}px`,
          transition: 'all 0.2s ease',
          cursor: 'default',
          position: 'relative',
          overflow: 'hidden'
        }}
        className="contact-card-hover"
      >
        {/* Accent Strip */}
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '4px',
          background: color,
          opacity: 0.6
        }} />

        {/* Avatar */}
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '14px',
            background: colorScheme.bg,
            border: `1px solid ${colorScheme.border}`,
            color: colorScheme.text,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '20px',
            fontWeight: 800,
            flexShrink: 0,
            position: 'relative'
          }}
        >
          {getInitials(name, email)}
        </div>

        {/* Main Info Stack */}
        <div style={{
          display: 'flex',
          flexDirection: isWide ? 'row' : 'column',
          alignItems: isWide ? 'center' : 'stretch',
          flex: 1,
          minWidth: 0,
          gap: isWide ? '32px' : '4px',
          justifyContent: isWide ? 'space-between' : 'center'
        }}>
          {/* Left Side: Name and Title/Email */}
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: '4px', flex: isWide ? 1 : 'unset' }}>
            {/* Top Row: Name */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
              <Tooltip content={displayName}>
                <span style={{
                  fontSize: isWide ? '22px' : '20px',
                  fontWeight: 800,
                  color: 'var(--color-text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  letterSpacing: '-0.02em',
                  display: 'block'
                }}>
                  {displayName}
                </span>
              </Tooltip>
              {sourceLabel && (
                <span style={{
                  fontSize: '10px',
                  background: 'rgba(255, 255, 255, 0.12)',
                  color: 'var(--color-text-primary)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontWeight: 900,
                  textTransform: 'uppercase',
                  flexShrink: 0,
                  letterSpacing: '0.05em'
                }}>
                  {sourceLabel}
                </span>
              )}
            </div>

            {/* Middle Row: Title | Email */}
            <div style={{
              fontSize: '14px',
              color: 'var(--color-text-secondary)',
              fontWeight: 550,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              whiteSpace: 'nowrap',
              overflow: 'hidden'
            }}>
              {title && (
                <Tooltip content={title}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
                </Tooltip>
              )}
              {title && <span style={{ opacity: 0.3, fontSize: '16px' }}>|</span>}
              <Tooltip content={email}>
                <span style={{ opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</span>
              </Tooltip>
            </div>
          </div>

          {/* Right Side: Phone & Groups */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            minWidth: 0,
            gap: isWide ? '24px' : '12px',
            justifyContent: isWide ? 'flex-end' : 'flex-start'
          }}>
            {formattedPhone ? (
              <Tooltip content={formattedPhone}>
                <span style={{
                  fontSize: isWide ? '20px' : '18px',
                  color: '#60A5FA',
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                  whiteSpace: 'nowrap',
                  minWidth: isWide ? 'auto' : '160px',
                  flexShrink: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: 'block'
                }}>
                  {formattedPhone}
                </span>
              </Tooltip>
            ) : (
              !isWide && <div style={{ minWidth: '160px', height: '18px', flexShrink: 0 }} />
            )}

            {groups.length > 0 && (
              <Tooltip content={groups.join(', ')}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'help', flexWrap: 'nowrap', overflow: 'hidden' }}>
                  {groups.slice(0, isWide ? 3 : 1).map(g => (
                    <GroupPill key={g} group={g} />
                  ))}
                  {groups.length > (isWide ? 3 : 1) && (
                    <span style={{
                      fontSize: '12px',
                      color: 'var(--color-text-tertiary)',
                      fontWeight: 700,
                      background: 'rgba(255,255,255,0.05)',
                      padding: '2px 6px',
                      borderRadius: '6px',
                      flexShrink: 0
                    }}>
                      +{groups.length - (isWide ? 3 : 1)}
                    </span>
                  )}
                </div>
              </Tooltip>
            )}
          </div>
        </div>
      </div>

      {
        action && (
          <div className="row-actions" style={{
            position: 'absolute',
            right: '32px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'var(--color-bg-surface)',
            padding: '4px 8px',
            borderRadius: '8px',
            display: 'flex',
            gap: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            border: '1px solid rgba(255,255,255,0.1)',
            zIndex: 10
          }}>
            {action}
          </div>
        )
      }
    </div>
  );
});
