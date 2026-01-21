import React, { useState, useCallback, useRef, useLayoutEffect } from "react";
import { OnCallRow, Contact, TeamLayout } from "@shared/ipc";
import "gridstack/dist/gridstack.min.css";
import { TactileButton } from "../components/TactileButton";
import { Modal } from "../components/Modal";
import { Input } from "../components/Input";
import { ContextMenu, ContextMenuItem } from "../components/ContextMenu";
import { ConfirmModal } from "../components/ConfirmModal";
import { Tooltip } from "../components/Tooltip";
import { CollapsibleHeader, useCollapsibleHeader } from "../components/CollapsibleHeader";
import { TeamCard } from "../components/personnel/TeamCard";
import { usePersonnel } from "../hooks/usePersonnel";
import { useGridStack } from "../hooks/useGridStack";
import { useToast } from "../components/Toast";

const gridStackStyles = `.grid-stack { background: transparent; } .grid-stack-item { cursor: grab; } .grid-stack-item:active { cursor: grabbing; } .grid-stack-placeholder { background: transparent !important; border: none !important; } .grid-stack-item.ui-draggable-dragging { opacity: 0.95; z-index: 100; } .grid-stack-item.ui-draggable-dragging > .grid-stack-item-content { box-shadow: 0 8px 32px rgba(0,0,0,0.35); } .grid-stack-item > .ui-resizable-handle { display: none !important; } .ui-resizable-se { display: none !important; } .grid-stack > .grid-stack-item { transition: left 0.2s ease-out, top 0.2s ease-out; } .grid-stack > .grid-stack-item.ui-draggable-dragging { transition: none; }`;

// Format on-call rows as text for copying
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

/**
 * Robust wrapper for GridStack items.
 * Forcefully syncs gs-x and gs-y attributes to the DOM when props change.
 * This ensures that when GridStack re-initializes, it sees the correct positions
 * even if React's reconciliation just moved the DOM node.
 */
const GridStackItem: React.FC<{
  team: string;
  x: number;
  y: number;
  h: number;
  children: React.ReactNode;
}> = ({ team, x, y, h, children }) => {
  const ref = useRef<HTMLDivElement>(null);

  // Imperatively sync attributes whenever x or y changes
  // Use useLayoutEffect to ensure attributes are set before GridStack reads them
  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.setAttribute("gs-x", String(x));
      ref.current.setAttribute("gs-y", String(y));
      ref.current.setAttribute("gs-h", String(h));
    }
  }, [x, y, h]);

  return (
    <div
      ref={ref}
      className="grid-stack-item"
      gs-id={team}
      gs-w="1"
      gs-h={h}
      gs-x={x}
      gs-y={y}
    >
      {children}
    </div>
  );
};

export const PersonnelTab: React.FC<{ onCall: OnCallRow[]; contacts: Contact[]; teamLayout?: TeamLayout }> = ({ onCall, contacts, teamLayout }) => {
  const { localOnCall, weekRange, dismissedAlerts, dismissAlert, getAlertKey, currentDay, teams, handleUpdateRows, handleRemoveTeam, handleRenameTeam, handleAddTeam, getItemHeight, setLocalOnCall } = usePersonnel(onCall, teamLayout);
  const [isAddingTeam, setIsAddingTeam] = useState(false); const [newTeamName, setNewTeamName] = useState("");
  const [renamingTeam, setRenamingTeam] = useState<{ old: string; new: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ team: string; onConfirm: () => void } | null>(null);
  const { isCollapsed, scrollContainerRef } = useCollapsibleHeader(30);
  const { gridRef } = useGridStack(localOnCall, setLocalOnCall, getItemHeight, teamLayout);
  const { showToast } = useToast();

  const isPopout = window.location.hash.includes('popout');

  // Copy handlers - use Electron's native clipboard API
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

  const alertConfigs = [{ day: 1, type: 'general', label: 'Update Weekly Schedule', bg: 'var(--color-accent-primary)' }, { day: 3, type: 'sql', label: 'Update SQL DBA', bg: '#EF4444' }, { day: 4, type: 'oracle', label: 'Update Oracle DBA', bg: '#EF4444' }, { day: 5, type: 'network', label: 'Update Network/Voice/FTS', bg: '#3B82F6' }];
  const renderAlerts = () => alertConfigs.filter(c => c.day === currentDay && !dismissedAlerts.has(getAlertKey(c.type))).map(c => <Tooltip key={c.type} content="Click to dismiss"><div onClick={() => dismissAlert(c.type)} style={{ fontSize: '12px', fontWeight: 700, color: '#fff', background: c.bg, padding: '4px 8px', borderRadius: '4px', marginLeft: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none' }}>{c.label}</div></Tooltip>);

  return (
    <div ref={scrollContainerRef} style={{ height: "100%", display: "flex", flexDirection: "column", padding: "20px 24px 24px 24px", background: "var(--color-bg-app)", overflowY: "auto" }}>
      <style>{gridStackStyles}</style>
      <CollapsibleHeader title="On-Call Board" subtitle={<>{weekRange}{renderAlerts()}</>} isCollapsed={isCollapsed}>
        <TactileButton
          onClick={handleCopyAllOnCall}
          title="Copy All On-Call Info"
          style={{ marginRight: '8px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}
          icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>}
        >COPY ALL</TactileButton>
        {!isPopout && (
          <TactileButton
            onClick={() => {
              window.api?.openAuxWindow('popout/board');
            }}
            title="Pop Out Board"
            style={{ marginRight: '8px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}
            icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>}
          >POP OUT</TactileButton>
        )}
        <TactileButton variant="primary" style={{ padding: isCollapsed ? '8px 16px' : '15px 32px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }} onClick={() => setIsAddingTeam(true)}>+ ADD TEAM</TactileButton>
      </CollapsibleHeader>

      <div ref={gridRef} className="grid-stack" style={{ paddingBottom: "40px" }}>
        {teams.map((team, i) => (
          <GridStackItem
            key={team}
            team={team}
            x={teamLayout?.[team]?.x ?? (i % 2)}
            y={teamLayout?.[team]?.y ?? Math.floor(i / 2)}
            h={getItemHeight(team)}
          >
            <TeamCard
              team={team}
              rows={localOnCall.filter((r) => r.team === team)}
              contacts={contacts}
              onUpdateRows={handleUpdateRows}
              onRenameTeam={(o, n) => setRenamingTeam({ old: o, new: n })}
              onRemoveTeam={handleRemoveTeam}
              setConfirm={setConfirmDelete}
              setMenu={setMenu}
              onCopyTeamInfo={handleCopyTeamInfo}
            />
          </GridStackItem>
        ))}
      </div>

      <Modal isOpen={!!renamingTeam} onClose={() => setRenamingTeam(null)} title="Rename Team" width="400px"><div style={{ display: "flex", flexDirection: "column", gap: "16px" }}><Input value={renamingTeam?.new || ""} onChange={(e) => setRenamingTeam(p => p ? { ...p, new: e.target.value } : null)} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && renamingTeam) void handleRenameTeam(renamingTeam.old, renamingTeam.new).then(() => setRenamingTeam(null)); }} /><div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}><TactileButton variant="secondary" onClick={() => setRenamingTeam(null)}>Cancel</TactileButton><TactileButton variant="primary" onClick={() => renamingTeam && void handleRenameTeam(renamingTeam.old, renamingTeam.new).then(() => setRenamingTeam(null))}>Rename</TactileButton></div></div></Modal>

      <Modal isOpen={isAddingTeam} onClose={() => setIsAddingTeam(false)} title="Add New Team" width="400px"><div style={{ display: "flex", flexDirection: "column", gap: "16px" }}><Input placeholder="Team Name (e.g. SRE, Support)" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && newTeamName.trim()) { void handleAddTeam(newTeamName.trim()); setNewTeamName(""); setIsAddingTeam(false); } }} /><div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}><TactileButton variant="secondary" onClick={() => setIsAddingTeam(false)}>Cancel</TactileButton><TactileButton variant="primary" onClick={() => { if (newTeamName.trim()) { void handleAddTeam(newTeamName.trim()); setNewTeamName(""); setIsAddingTeam(false); } }}>Add Team</TactileButton></div></div></Modal>

      {confirmDelete && <ConfirmModal isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={confirmDelete.onConfirm} title="Remove Team" message={`Are you sure you want to remove the team "${confirmDelete.team}"? This will delete all members in this team.`} confirmLabel="Remove" isDanger />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
};
