import React, { useState, useCallback, useEffect } from "react";
import { OnCallRow, Contact, TeamLayout } from "@shared/ipc";
import { CollapsibleHeader, useCollapsibleHeader } from "../components/CollapsibleHeader";
import { TeamCard } from "../components/personnel/TeamCard";
import { usePersonnel } from "../hooks/usePersonnel";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";
import { TactileButton } from "../components/TactileButton";
import { ContextMenu, ContextMenuItem } from "../components/ContextMenu";
import { useAutoAnimate } from '@formkit/auto-animate/react';

// Helper for copying
function formatTeamOnCall(team: string, rows: OnCallRow[]): string {
  if (rows.length === 0) return `${team}: (empty)`;
  const members = rows.map(r => {
    const parts = [r.role];
    if (r.name) parts.push(r.name);
    if (r.contact) parts.push(`(${r.contact})`);
    if (r.timeWindow) parts.push(`[${r.timeWindow}]`);
    return parts.join(' ');
  });
  return `${team}: ${members.join(' | ')}`;
}

interface PopoutBoardProps {
  onCall: OnCallRow[];
  contacts: Contact[];
  teamLayout?: TeamLayout;
}

export const PopoutBoard: React.FC<PopoutBoardProps> = ({ onCall, contacts, teamLayout }) => {
  const { showToast } = useToast();
  const { 
    localOnCall, 
    weekRange, 
    dismissedAlerts, 
    getAlertKey, 
    currentDay, 
    teams,
    tick
  } = usePersonnel(onCall, teamLayout);

  const { isCollapsed, scrollContainerRef } = useCollapsibleHeader(30);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [isKiosk, setIsKiosk] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [isRemoteDragging, setIsRemoteDragging] = useState(false);

  useEffect(() => {
    return window.api?.onDragStateChange((isDragging) => {
      setIsRemoteDragging(isDragging);
    });
  }, []);

  useEffect(() => {
    setLastUpdated(new Date());
  }, [localOnCall]);
  
  const [animationParent, enableAnimations] = useAutoAnimate({
    duration: 500,
    easing: 'cubic-bezier(0.16, 1, 0.3, 1)'
  });

  // Disable animations during active window resize to prevent jank
  useEffect(() => {
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      enableAnimations(false);
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        enableAnimations(true);
      }, 150);
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(resizeTimeout);
    };
  }, [enableAnimations]);

  const handleCopyTeamInfo = useCallback(async (team: string, rows: OnCallRow[]) => {
    const text = formatTeamOnCall(team, rows);
    const success = await window.api?.writeClipboard(text);
    if (success) {
      showToast(`Copied ${team} on-call info`, 'success');
    } else {
      showToast('Failed to copy to clipboard', 'error');
    }
  }, [showToast]);

  const handleCopyAllOnCall = useCallback(async () => {
    const allText = teams.map(team => {
      const teamRows = localOnCall.filter(r => r.team === team);
      return formatTeamOnCall(team, teamRows);
    }).join('\n');
    const success = await window.api?.writeClipboard(allText);
    if (success) {
      showToast('Copied all on-call info', 'success');
    } else {
      showToast('Failed to copy to clipboard', 'error');
    }
  }, [teams, localOnCall, showToast]);

  const alertConfigs = [
    { day: 0, type: 'first-responder', label: 'Update First Responder', bg: 'var(--color-accent-primary)' },
    { day: 1, type: 'general', label: 'Update Weekly Schedule', bg: 'var(--color-accent-primary)' }, 
    { day: 3, type: 'sql', label: 'Update SQL DBA', bg: '#EF4444' }, 
    { day: 4, type: 'oracle', label: 'Update Oracle DBA', bg: '#EF4444' }
  ];
  
  const renderAlerts = () => alertConfigs
    .filter(c => c.day === currentDay && !dismissedAlerts.has(getAlertKey(c.type)))
    .map(c => (
      <Tooltip key={c.type} content="Alert from Main Window">
        <div 
          style={{ 
            fontSize: '12px', 
            fontWeight: 700, 
            color: '#fff', 
            background: c.bg, 
            padding: '4px 8px', 
            borderRadius: '4px', 
            marginLeft: '12px', 
            textTransform: 'uppercase', 
            letterSpacing: '0.05em', 
            userSelect: 'none',
            opacity: 0.9 
          }}
        >
          {c.label}
        </div>
      </Tooltip>
    ));

  return (
    <div ref={scrollContainerRef} style={{ height: "100%", display: "flex", flexDirection: "column", padding: isKiosk ? "0" : "20px 24px 24px 24px", background: "var(--color-bg-app)", overflowY: "auto", position: 'relative' }}>
      
      {isRemoteDragging && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: 'rgba(11, 13, 18, 0.4)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'all',
          transition: 'all 0.3s ease'
        }}>
          <div style={{
            background: 'rgba(0, 0, 0, 0.8)',
            padding: '20px 40px',
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: '#fff',
            fontSize: '18px',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
          }}>
            <span className="animate-spin" style={{ display: 'inline-block', width: '20px', height: '20px', border: '3px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--color-accent-blue)', borderRadius: '50%' }} />
            Board being updated...
          </div>
        </div>
      )}

      {!isKiosk && (
        <CollapsibleHeader 
          title="On-Call Board" 
          subtitle={
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span>{weekRange}</span>
              <span style={{ fontSize: '12px', color: 'var(--color-text-quaternary)', opacity: 0.8 }}>
                Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              {renderAlerts()}
            </div>
          } 
          isCollapsed={isCollapsed}
        >
          <TactileButton
            onClick={() => setIsKiosk(true)}
            title="Kiosk Mode (Full Screen)"
            style={{ marginRight: '8px' }}
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>}
          >KIOSK</TactileButton>
          <TactileButton
            onClick={handleCopyAllOnCall}
            title="Copy All On-Call Info"
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>}
          >COPY ALL</TactileButton>
        </CollapsibleHeader>
      )}

      {isKiosk && (
        <div style={{ position: 'fixed', bottom: '20px', right: '20px', zIndex: 1000, display: 'flex', gap: '8px', opacity: 0.4 }} onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')} onMouseLeave={(e) => (e.currentTarget.style.opacity = '0.4')}>
           <div style={{ background: 'rgba(0,0,0,0.6)', padding: '4px 12px', borderRadius: '20px', fontSize: '11px', color: '#fff', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center' }}>
             Last Update: {lastUpdated.toLocaleTimeString()}
           </div>
           <TactileButton size="sm" onClick={() => setIsKiosk(false)} variant="ghost" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', color: '#fff' }}>Exit Kiosk</TactileButton>
        </div>
      )}

      <div ref={animationParent} className="oncall-grid" role="list" aria-label="On-Call Teams" style={{ padding: isKiosk ? "40px" : "0" }}>
        {teams.map((team, idx) => (
          <div key={team} className="oncall-grid-item" role="listitem">
            <TeamCard
              team={team}
              index={idx}
              rows={localOnCall.filter((r) => r.team === team)}
              contacts={contacts}
              onUpdateRows={() => {}}
              onRenameTeam={() => {}}
              onRemoveTeam={() => {}}
              setConfirm={() => {}}
              setMenu={setMenu}
              onCopyTeamInfo={handleCopyTeamInfo}
              isReadOnly={true}
              tick={tick}
            />
          </div>
        ))}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
};
