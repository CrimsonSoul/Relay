import React, { useMemo, useState } from 'react';
import { OnCallRow, Contact } from "@shared/ipc";
import { getColorForString } from "../../utils/colors";
import { Tooltip } from "../Tooltip";
import { MaintainTeamModal } from "../MaintainTeamModal";
import { ContextMenuItem } from "../ContextMenu";
import { TeamRow } from "./TeamRow";

interface TeamCardProps { team: string; rows: OnCallRow[]; contacts: Contact[]; onUpdateRows: (team: string, rows: OnCallRow[]) => void; onRenameTeam: (oldName: string, newName: string) => void; onRemoveTeam: (team: string) => void; setConfirm: (confirm: { team: string; onConfirm: () => void } | null) => void; setMenu: (menu: { x: number; y: number; items: ContextMenuItem[] } | null) => void }

export const TeamCard = React.memo(({ team, rows, contacts, onUpdateRows, onRenameTeam, onRemoveTeam, setConfirm, setMenu }: TeamCardProps) => {
  const colorScheme = getColorForString(team);
  const [isEditing, setIsEditing] = useState(false);
  const teamRows = useMemo(() => rows || [], [rows]);
  const hasAnyTimeWindow = useMemo(() => teamRows.some((r) => r.timeWindow?.trim()), [teamRows]);
  const rowGridTemplate = hasAnyTimeWindow ? "60px 1fr auto auto" : "60px 1fr auto";

  return (
    <>
        <div className="grid-stack-item-content" style={{ padding: "0 16px 20px 0", height: "100%", boxSizing: "border-box" }}>
        <div
          role="button"
          tabIndex={0}
          style={{ padding: "12px", background: "rgba(255, 255, 255, 0.03)", borderRadius: "16px", border: "1px solid rgba(255, 255, 255, 0.06)", display: "flex", flexDirection: "column", gap: "8px", position: "relative", overflow: "hidden", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", height: "100%", boxSizing: "border-box", cursor: "grab" }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation();
            setMenu({ x: e.clientX, y: e.clientY, items: [
              { label: "Edit Team", onClick: () => setIsEditing(true) },
              { label: "Rename Team", onClick: () => onRenameTeam(team, team) },
              { label: "Remove Team", danger: true, onClick: () => setConfirm({ team, onConfirm: () => onRemoveTeam(team) }) }
            ]});
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setIsEditing(true); } }}
        >
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "5px", background: colorScheme.text, opacity: 0.9, borderRadius: "16px 0 0 16px" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingLeft: "10px" }}>
            <div style={{ fontSize: "20px", fontWeight: 800, color: colorScheme.text, letterSpacing: "0.05em", textTransform: "uppercase", overflowWrap: "break-word", wordBreak: "keep-all", whiteSpace: "normal" }}><Tooltip content={team}><span>{team}</span></Tooltip></div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", paddingLeft: "14px" }}>
            {teamRows.map((row) => <TeamRow key={row.id} row={row} hasAnyTimeWindow={hasAnyTimeWindow} gridTemplate={rowGridTemplate} />)}
          </div>
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
