import React, { memo, useState, useRef, useEffect } from 'react';
import { Server, Contact } from '@shared/ipc';
import { Tooltip } from './Tooltip';
import { getPlatformColor, PersonInfo } from './shared/PersonInfo';

interface ServerCardProps { server: Server; contactLookup: Map<string, Contact>; onContextMenu: (e: React.MouseEvent, server: Server) => void; style?: React.CSSProperties; hasNotes?: boolean; tags?: string[]; onNotesClick?: () => void }

export const ServerCard = memo(({ server, contactLookup, onContextMenu, style, hasNotes, tags = [], onNotesClick }: ServerCardProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isWide, setIsWide] = useState(false);
  useEffect(() => { if (!containerRef.current) return; const observer = new ResizeObserver((entries) => { for (const entry of entries) setIsWide(entry.contentRect.width > 900); }); observer.observe(containerRef.current); return () => observer.disconnect(); }, []);

  const osInfo = getPlatformColor(server.os);
  const cardPadding = isWide ? 24 : 12;

  return (
    <div ref={containerRef} onContextMenu={(e) => onContextMenu(e, server)} style={{ width: '100%', height: '100%', ...style, display: 'flex', alignItems: 'center' }}>
      <div style={{ width: '100%', height: 'calc(100% - 8px)', display: 'flex', alignItems: 'center', paddingLeft: `${cardPadding + 4}px`, paddingRight: `${cardPadding}px`, gap: `${cardPadding}px`, cursor: 'default' }} className="card-surface server-card-hover">
        <div className="accent-strip" style={{ background: osInfo.text }} />
        <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: osInfo.bg, border: `1px solid ${osInfo.border}`, color: osInfo.text, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2" /><rect x="2" y="14" width="20" height="8" rx="2" ry="2" /><line x1="6" y1="6" x2="6.01" y2="6" /><line x1="6" y1="18" x2="6.01" y2="18" /></svg>
        </div>
        <div style={{ display: 'flex', flexDirection: isWide ? 'row' : 'column', alignItems: isWide ? 'center' : 'stretch', flex: 1, minWidth: 0, gap: isWide ? '40px' : '4px', justifyContent: isWide ? 'space-between' : 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, gap: '4px', flex: isWide ? 1 : 'unset' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Tooltip content={server.name}><span className="text-balance break-word" style={{ fontSize: isWide ? '24px' : '22px', fontWeight: 700, color: 'var(--color-text-primary)', letterSpacing: '-0.02em', display: 'block' }}>{server.name}</span></Tooltip>
              <span style={{ fontSize: '10px', fontWeight: 900, padding: '2px 8px', borderRadius: '6px', background: osInfo.bg, border: `1px solid ${osInfo.border}`, color: osInfo.text, letterSpacing: '0.05em', textTransform: 'uppercase' }}>{osInfo.label}</span>
            </div>
            <div style={{ fontSize: '15px', color: 'var(--color-text-secondary)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'normal', overflow: 'hidden' }}>
              <span style={{ color: '#E5E7EB', opacity: 0.9, flexShrink: 0 }}>{server.businessArea}</span><span style={{ opacity: 0.3, fontSize: '16px', flexShrink: 0 }}>|</span><span style={{ flexShrink: 0 }}>{server.lob}</span>
              {server.comment && server.comment !== '-' && <><span style={{ opacity: 0.3, fontSize: '16px', flexShrink: 0 }}>|</span><Tooltip content={server.comment}><span className="text-clamp-1" style={{ fontStyle: 'italic', opacity: 0.6, cursor: 'help', display: 'block' }}>{server.comment}</span></Tooltip></>}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: isWide ? '40px' : '24px', marginTop: isWide ? 0 : '6px', justifyContent: isWide ? 'flex-end' : 'flex-start' }}>
            {/* Tags display */}
            {tags.length > 0 && (
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                {tags.slice(0, 2).map(tag => (
                  <span key={tag} className="card-surface" style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-accent-blue)', padding: '4px 8px', borderRadius: '6px', letterSpacing: '0.02em', background: 'rgba(59, 130, 246, 0.1)' }}>#{tag}</span>
                ))}
                {tags.length > 2 && <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>+{tags.length - 2}</span>}
              </div>
            )}
            {/* Notes indicator - clickable */}
            {hasNotes && (
              <Tooltip content="Click to view notes">
                <button onClick={(e) => { e.stopPropagation(); onNotesClick?.(); }} className="card-surface" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#FBBF24', border: 'none', cursor: 'pointer', padding: '6px', borderRadius: '6px', background: 'rgba(251, 191, 36, 0.1)', width: '28px', height: '28px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                </button>
              </Tooltip>
            )}
            <PersonInfo label="OWNER" value={server.owner || ''} contactLookup={contactLookup} />
            {!isWide && <PersonInfo label="SUPPORT" value={server.contact || ''} contactLookup={contactLookup} />}
            {isWide && <><div style={{ width: '2px', height: '32px', background: 'rgba(255,255,255,0.05)', borderRadius: '1px' }} /><PersonInfo label="SUPPORT" value={server.contact || ''} contactLookup={contactLookup} /></>}
          </div>
        </div>
      </div>
    </div>
  );
});
