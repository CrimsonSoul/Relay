import React, { useMemo, useState } from 'react';
import { OnCallRow, Contact } from "@shared/ipc";
import { getColorForString, PALETTE } from "../../utils/colors";
import { Tooltip } from "../Tooltip";
import { MaintainTeamModal } from "../MaintainTeamModal";
import { ContextMenuItem } from "../ContextMenu";
import { TeamRow } from "./TeamRow";

interface TeamCardProps { team: string; index?: number; rows: OnCallRow[]; contacts: Contact[]; onUpdateRows: (team: string, rows: OnCallRow[]) => void; onRenameTeam: (oldName: string, newName: string) => void; onRemoveTeam: (team: string) => void; setConfirm: (confirm: { team: string; onConfirm: () => void } | null) => void; setMenu: (menu: { x: number; y: number; items: ContextMenuItem[] } | null) => void; onCopyTeamInfo?: (team: string, rows: OnCallRow[]) => void; isReadOnly?: boolean; }

export const TeamCard = React.memo(({ team, index, rows, contacts, onUpdateRows, onRenameTeam, onRemoveTeam, setConfirm, setMenu, onCopyTeamInfo, isReadOnly = false }: TeamCardProps) => {
  const colorScheme = useMemo(() => {
    if (typeof index === 'number') {
      return PALETTE[index % PALETTE.length];
    }
    return getColorForString(team);
  }, [team, index]);
  const [isEditing, setIsEditing] = useState(false);
  const teamRows = useMemo(() => rows || [], [rows]);
  const hasAnyTimeWindow = useMemo(() => teamRows.some((r) => r.timeWindow?.trim()), [teamRows]);
  const rowGridTemplate = hasAnyTimeWindow ? "45px auto 1fr auto" : "45px auto 1fr";

  const isEmpty = teamRows.length === 0 || (teamRows.length === 1 && !teamRows[0].name && !teamRows[0].contact);

  return (
    <>
      <div 
        role="button"
        tabIndex={0}
        aria-label={`Team: ${team}, ${teamRows.length} members`}
        className={isReadOnly ? "" : "lift-on-hover"}
        style={{ 
          padding: "16px", 
          background: "var(--color-bg-card)", 
          borderRadius: "16px", 
          border: "var(--border-subtle)", 
          display: "flex", 
          flexDirection: "column", 
          gap: "12px", 
          position: "relative", 
          overflow: "hidden", 
          boxShadow: "var(--shadow-sm)", 
          height: "100%",
          boxSizing: "border-box",
          cursor: isReadOnly ? "default" : "grab",
          transition: "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.5s cubic-bezier(0.16, 1, 0.3, 1), background 0.5s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.5s cubic-bezier(0.16, 1, 0.3, 1)"
        }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation();
          if (isReadOnly) {
             setMenu({ x: e.clientX, y: e.clientY, items: [
                ...(onCopyTeamInfo ? [{ label: "Copy On-Call Info", onClick: () => onCopyTeamInfo(team, teamRows), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> }] : [])
             ]});
             return;
          }
          setMenu({ x: e.clientX, y: e.clientY, items: [
            ...(onCopyTeamInfo ? [{ label: "Copy On-Call Info", onClick: () => onCopyTeamInfo(team, teamRows), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg> }] : []),
            { label: "Edit Team", onClick: () => setIsEditing(true) },
            { label: "Rename Team", onClick: () => onRenameTeam(team, team) },
            { label: "Remove Team", danger: true, onClick: () => setConfirm({ team, onConfirm: () => onRemoveTeam(team) }) }
          ]});
        }}
        onKeyDown={(e) => { if (!isReadOnly && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setIsEditing(true); } }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "5px", background: colorScheme.text, opacity: 0.9, borderRadius: "16px 0 0 16px" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingLeft: "8px" }}>
          <div style={{ fontSize: "20px", fontWeight: 800, color: colorScheme.text, letterSpacing: "0.05em", textTransform: "uppercase", overflowWrap: "break-word", wordBreak: "keep-all", whiteSpace: "normal" }}><Tooltip content={team}><span>{team}</span></Tooltip></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", paddingLeft: "4px", flexGrow: 1, justifyContent: "center" }}>
          {isEmpty ? (
            <div 
              onClick={() => !isReadOnly && setIsEditing(true)}
              style={{ 
                padding: "20px", 
                textAlign: "center", 
                color: "var(--color-text-quaternary)", 
                fontSize: "14px", 
                fontStyle: "italic",
                border: "1px dashed rgba(255,255,255,0.06)",
                borderRadius: "12px",
                margin: "4px 0",
                cursor: isReadOnly ? "default" : "pointer"
              }}
            >
              {isReadOnly ? "No personnel assigned" : "Click to assign personnel"}
            </div>
          ) : (
            teamRows.map((row) => <TeamRow key={row.id} row={row} hasAnyTimeWindow={hasAnyTimeWindow} gridTemplate={rowGridTemplate} />)
          )}
        </div>
      </div>
      <MaintainTeamModal isOpen={isEditing} onClose={() => setIsEditing(false)} teamName={team} initialRows={teamRows} contacts={contacts} onSave={onUpdateRows} />
    </>
  );
}, (prev, next) => {
  // Custom comparison to avoid re-render if rows content is same, even if array ref changed
  if (prev.team !== next.team) return false;
  if (prev.contacts !== next.contacts) return false; // fast reference check sufficient for contacts list?
  if (prev.rows.length !== next.rows.length) return false;
  // Deep check rows - expensive? Max ~10 rows per team usually.
  for (let i = 0; i < prev.rows.length; i++) {
    const r1 = prev.rows[i], r2 = next.rows[i];
    if (r1.id !== r2.id || r1.name !== r2.name || r1.role !== r2.role || r1.contact !== r2.contact || r1.timeWindow !== r2.timeWindow) return false;
  }
  return true;
});
