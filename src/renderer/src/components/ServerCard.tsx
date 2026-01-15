import React, { memo } from 'react';
import { Server, Contact } from '@shared/ipc';
import { Tooltip } from './Tooltip';
import { getPlatformColor, PersonInfo } from './shared/PersonInfo';

interface ServerCardProps {
  server: Server;
  contactLookup: Map<string, Contact>;
  onContextMenu: (e: React.MouseEvent, server: Server) => void;
  style?: React.CSSProperties;
  isWide?: boolean;
}

export const ServerCard = memo(({ server, contactLookup, onContextMenu, style, isWide = false }: ServerCardProps) => {
  const osInfo = getPlatformColor(server.os);
  const cardPadding = isWide ? 24 : 12;

  return (
    <div onContextMenu={(e) => onContextMenu(e, server)} style={{ width: '100%', height: '100%', ...style, display: 'flex', alignItems: 'center' }}>
      <div style={{ width: '100%', height: 'calc(100% - 8px)', display: 'flex', alignItems: 'center', paddingLeft: `${cardPadding + 4}px`, paddingRight: `${cardPadding}px`, background: 'rgba(255, 255, 255, 0.02)', border: '1px solid rgba(255, 255, 255, 0.05)', borderRadius: '12px', gap: `${cardPadding}px`, transition: 'all 0.2s ease', cursor: 'default', position: 'relative', overflow: 'hidden' }} className="server-card-hover">
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', background: osInfo.text, opacity: 0.8 }} />
        <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: osInfo.bg, border: `1px solid ${osInfo.border}`, color: osInfo.text, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>
        </div>
        <div style={{ display: 'flex', flexDirection: isWide ? 'row' : 'column', alignItems: isWide ? 'center' : 'stretch', flex: 1, minWidth: 0, gap: isWide ? '40px' : '4px', justifyContent: isWide ? 'space-between' : 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: '4px', flex: isWide ? 1 : 'unset' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Tooltip content={server.name}><span style={{ fontSize: isWide ? '24px' : '22px', fontWeight: 800, color: 'var(--color-text-primary)', letterSpacing: '-0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{server.name}</span></Tooltip>
              <span style={{ fontSize: '10px', fontWeight: 900, padding: '2px 8px', borderRadius: '6px', background: osInfo.bg, border: `1px solid ${osInfo.border}`, color: osInfo.text, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{osInfo.label}</span>
            </div>
            <div style={{ fontSize: '14px', color: 'var(--color-text-secondary)', fontWeight: 550, display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <span style={{ color: '#E5E7EB', opacity: 0.9, flexShrink: 0 }}>{server.businessArea}</span><span style={{ opacity: 0.3, fontSize: '16px', flexShrink: 0 }}>|</span><span style={{ flexShrink: 0 }}>{server.lob}</span>
              {server.comment && server.comment !== '-' && <><span style={{ opacity: 0.3, fontSize: '16px', flexShrink: 0 }}>|</span><Tooltip content={server.comment}><span style={{ fontStyle: 'italic', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'help', display: 'block' }}>{server.comment}</span></Tooltip></>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: isWide ? '40px' : '24px', marginTop: isWide ? 0 : '6px', justifyContent: isWide ? 'flex-end' : 'flex-start' }}>
            <PersonInfo label="OWNER" value={server.owner || ''} contactLookup={contactLookup} />
            {!isWide && <PersonInfo label="SUPPORT" value={server.contact || ''} contactLookup={contactLookup} />}
            {isWide && <><div style={{ width: '2px', height: '32px', background: 'rgba(255,255,255,0.05)', borderRadius: '1px' }} /><PersonInfo label="SUPPORT" value={server.contact || ''} contactLookup={contactLookup} /></>}
          </div>
        </div>
      </div>
    </div>
  );
});
