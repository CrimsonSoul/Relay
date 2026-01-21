import React, { useState, useCallback, useMemo } from "react";
import { OnCallRow, Contact, TeamLayout } from "@shared/ipc";
import { CollapsibleHeader, useCollapsibleHeader } from "../components/CollapsibleHeader";
import { TeamCard } from "../components/personnel/TeamCard";
import { usePersonnel } from "../hooks/usePersonnel";
import { useToast } from "../components/Toast";
import { Tooltip } from "../components/Tooltip";
import { TactileButton } from "../components/TactileButton";
import { ContextMenu, ContextMenuItem } from "../components/ContextMenu";

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
  // We reuse usePersonnel hook to get derived team lists and alerts
  const { 
    localOnCall, 
    weekRange, 
    dismissedAlerts, 
    getAlertKey, 
    currentDay, 
    teams,
  } = usePersonnel(onCall, teamLayout);

  const { isCollapsed, scrollContainerRef } = useCollapsibleHeader(30);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  
  // Calculate columns based on teamLayout
  // This replaces GridStack with a simple CSS Masonry-style layout
  // ensuring perfect content sizing without height formula issues.
  const columns = useMemo(() => {
    const cols: string[][] = [[], []];
    
    // First, sort all teams by their Y coordinate to maintain vertical sequence
    const sortedTeams = [...teams].sort((a, b) => {
      const yA = teamLayout?.[a]?.y ?? 0;
      const yB = teamLayout?.[b]?.y ?? 0;
      if (yA !== yB) return yA - yB;
      const xA = teamLayout?.[a]?.x ?? 0;
      const xB = teamLayout?.[b]?.x ?? 0;
      return xA - xB;
    });

    sortedTeams.forEach((team, i) => {
      let x = teamLayout?.[team]?.x;
      // Default to the same logic as PersonnelTab if layout is missing: (i % 2)
      // Note: This assumes sortedTeams is in the same order as 'teams' used in PersonnelTab's mapping
      // which it should be roughly if no layout exists (both iterate array).
      if (x === undefined) x = (i % 2);
      
      // Map to column 0 or 1.
      const colIndex = x > 0 ? 1 : 0;
      cols[colIndex].push(team);
    });
    return cols;
  }, [teams, teamLayout]);

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
    { day: 1, type: 'general', label: 'Update Weekly Schedule', bg: 'var(--color-accent-primary)' }, 
    { day: 3, type: 'sql', label: 'Update SQL DBA', bg: '#EF4444' }, 
    { day: 4, type: 'oracle', label: 'Update Oracle DBA', bg: '#EF4444' }, 
    { day: 5, type: 'network', label: 'Update Network/Voice/FTS', bg: '#3B82F6' }
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
    <div ref={scrollContainerRef} style={{ height: "100%", display: "flex", flexDirection: "column", padding: "20px 24px 24px 24px", background: "var(--color-bg-app)", overflowY: "auto" }}>
      
      {/* Read-only Header */}
      <CollapsibleHeader 
        title="On-Call Board" 
        subtitle={<>{weekRange}{renderAlerts()}</>} 
        isCollapsed={isCollapsed}
      >
        <TactileButton
          onClick={handleCopyAllOnCall}
          title="Copy All On-Call Info"
          style={{ marginRight: '8px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>}
        >COPY ALL</TactileButton>
      </CollapsibleHeader>

      <div style={{ display: 'flex', gap: '12px', padding: '12px', paddingBottom: "40px", alignItems: 'flex-start' }}>
        {/* Column 0 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
          {columns[0].map(team => (
            <div key={team} style={{ width: '100%' }}>
               <TeamCard
                team={team}
                rows={localOnCall.filter((r) => r.team === team)}
                contacts={contacts}
                onUpdateRows={() => {}}
                onRenameTeam={() => {}}
                onRemoveTeam={() => {}}
                setConfirm={() => {}}
                setMenu={setMenu}
                onCopyTeamInfo={handleCopyTeamInfo}
                isReadOnly={true}
              />
            </div>
          ))}
        </div>

        {/* Column 1 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 0 }}>
           {columns[1].map(team => (
            <div key={team} style={{ width: '100%' }}>
               <TeamCard
                team={team}
                rows={localOnCall.filter((r) => r.team === team)}
                contacts={contacts}
                onUpdateRows={() => {}}
                onRenameTeam={() => {}}
                onRemoveTeam={() => {}}
                setConfirm={() => {}}
                setMenu={setMenu}
                onCopyTeamInfo={handleCopyTeamInfo}
                isReadOnly={true}
              />
            </div>
          ))}
        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
};
