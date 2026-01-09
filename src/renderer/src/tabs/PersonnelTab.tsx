import React, { useState } from "react";
import { OnCallRow, Contact } from "@shared/ipc";
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

const gridStackStyles = `.grid-stack { background: transparent; } .grid-stack-item { cursor: grab; } .grid-stack-item:active { cursor: grabbing; } .grid-stack-placeholder { background: transparent !important; border: none !important; } .grid-stack-item.ui-draggable-dragging { opacity: 0.95; z-index: 100; } .grid-stack-item.ui-draggable-dragging > .grid-stack-item-content { box-shadow: 0 8px 32px rgba(0,0,0,0.35); } .grid-stack-item > .ui-resizable-handle { display: none !important; } .ui-resizable-se { display: none !important; } .grid-stack > .grid-stack-item { transition: left 0.2s ease-out, top 0.2s ease-out; } .grid-stack > .grid-stack-item.ui-draggable-dragging { transition: none; }`;

export const PersonnelTab: React.FC<{ onCall: OnCallRow[]; contacts: Contact[] }> = ({ onCall, contacts }) => {
  const { localOnCall, weekRange, dismissedAlerts, dismissAlert, getAlertKey, currentDay, teams, handleUpdateRows, handleRemoveTeam, handleRenameTeam, handleAddTeam, getItemHeight, setLocalOnCall } = usePersonnel(onCall);
  const [isAddingTeam, setIsAddingTeam] = useState(false); const [newTeamName, setNewTeamName] = useState("");
  const [renamingTeam, setRenamingTeam] = useState<{ old: string; new: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ team: string; onConfirm: () => void } | null>(null);
  const { isCollapsed, scrollContainerRef } = useCollapsibleHeader(30);
  const { gridRef } = useGridStack(localOnCall, setLocalOnCall);

  const alertConfigs = [{ day: 1, type: 'general', label: 'Update Weekly Schedule', bg: 'var(--color-accent-primary)' }, { day: 3, type: 'sql', label: 'Update SQL DBA', bg: '#EF4444' }, { day: 4, type: 'oracle', label: 'Update Oracle DBA', bg: '#EF4444' }, { day: 5, type: 'network', label: 'Update Network/Voice/FTS', bg: '#3B82F6' }];
  const renderAlerts = () => alertConfigs.filter(c => c.day === currentDay && !dismissedAlerts.has(getAlertKey(c.type))).map(c => <Tooltip key={c.type} content="Click to dismiss"><div onClick={() => dismissAlert(c.type)} style={{ fontSize: '12px', fontWeight: 700, color: '#fff', background: c.bg, padding: '4px 8px', borderRadius: '4px', marginLeft: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none' }}>{c.label}</div></Tooltip>);

  return (
    <div ref={scrollContainerRef} style={{ height: "100%", display: "flex", flexDirection: "column", padding: "20px 24px 24px 24px", background: "var(--color-bg-app)", overflowY: "auto" }}>
      <style>{gridStackStyles}</style>
      <CollapsibleHeader title="On-Call Board" subtitle={<>{weekRange}{renderAlerts()}</>} isCollapsed={isCollapsed}><TactileButton variant="primary" style={{ padding: isCollapsed ? '8px 16px' : '15px 32px', transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }} onClick={() => setIsAddingTeam(true)}>+ ADD TEAM</TactileButton></CollapsibleHeader>

      <div ref={gridRef} className="grid-stack" style={{ paddingBottom: "40px" }}>
        {teams.map((team, i) => <div key={team} className="grid-stack-item" gs-id={team} gs-w="1" gs-h={getItemHeight(team)} gs-x={i % 2} gs-y={Math.floor(i / 2)}><TeamCard team={team} rows={localOnCall.filter(r => r.team === team)} contacts={contacts} onUpdateRows={handleUpdateRows} onRenameTeam={(o, n) => setRenamingTeam({ old: o, new: n })} onRemoveTeam={handleRemoveTeam} setConfirm={setConfirmDelete} setMenu={setMenu} /></div>)}
      </div>

      <Modal isOpen={!!renamingTeam} onClose={() => setRenamingTeam(null)} title="Rename Team" width="400px"><div style={{ display: "flex", flexDirection: "column", gap: "16px" }}><Input value={renamingTeam?.new || ""} onChange={(e) => setRenamingTeam(p => p ? { ...p, new: e.target.value } : null)} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && renamingTeam) handleRenameTeam(renamingTeam.old, renamingTeam.new).then(() => setRenamingTeam(null)); }} /><div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}><TactileButton variant="secondary" onClick={() => setRenamingTeam(null)}>Cancel</TactileButton><TactileButton variant="primary" onClick={() => renamingTeam && handleRenameTeam(renamingTeam.old, renamingTeam.new).then(() => setRenamingTeam(null))}>Rename</TactileButton></div></div></Modal>

      <Modal isOpen={isAddingTeam} onClose={() => setIsAddingTeam(false)} title="Add New Team" width="400px"><div style={{ display: "flex", flexDirection: "column", gap: "16px" }}><Input placeholder="Team Name (e.g. SRE, Support)" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && newTeamName.trim()) { handleAddTeam(newTeamName.trim()); setNewTeamName(""); setIsAddingTeam(false); } }} /><div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}><TactileButton variant="secondary" onClick={() => setIsAddingTeam(false)}>Cancel</TactileButton><TactileButton variant="primary" onClick={() => { if (newTeamName.trim()) { handleAddTeam(newTeamName.trim()); setNewTeamName(""); setIsAddingTeam(false); } }}>Add Team</TactileButton></div></div></Modal>

      {confirmDelete && <ConfirmModal isOpen={!!confirmDelete} onClose={() => setConfirmDelete(null)} onConfirm={confirmDelete.onConfirm} title="Remove Team" message={`Are you sure you want to remove the team "${confirmDelete.team}"? This will delete all members in this team.`} confirmLabel="Remove" isDanger />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
    </div>
  );
};
