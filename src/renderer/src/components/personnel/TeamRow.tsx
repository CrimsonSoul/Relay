import React from 'react';
import { OnCallRow } from "@shared/ipc";
import { formatPhoneNumber } from '@shared/phoneUtils';
import { Tooltip } from "../Tooltip";

interface TeamRowProps { row: OnCallRow; hasAnyTimeWindow: boolean; gridTemplate: string }

const getRoleAbbrev = (role: string) => {
  const r = role.toLowerCase();
  if (r.includes("primary")) return "PRI"; if (r.includes("secondary")) return "SEC"; if (r.includes("backup")) return "BKP";
  if (r.includes("shadow")) return "SHD"; if (r.includes("escalation")) return "ESC"; return role.substring(0, 3).toUpperCase();
};

export const TeamRow: React.FC<TeamRowProps> = ({ row, hasAnyTimeWindow, gridTemplate }) => (
  <div style={{ display: "grid", gridTemplateColumns: gridTemplate, gap: "16px", alignItems: "center", padding: "4px 0" }}>
    <Tooltip content={row.role}>
      <div style={{ color: "var(--color-text-tertiary)", fontSize: "14px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", alignSelf: "center", opacity: 0.8 }}>{getRoleAbbrev(row.role)}</div>
    </Tooltip>
    <Tooltip content={row.name}>
      <div style={{ color: row.name ? "var(--color-text-primary)" : "var(--color-text-quaternary)", fontSize: "24px", fontWeight: 800, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>{row.name || "—"}</div>
    </Tooltip>
    <Tooltip content={row.contact}>
      <div style={{ color: "var(--color-text-primary)", fontSize: "24px", fontFamily: "var(--font-mono)", textAlign: "right", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 800, width: "220px" }}>{formatPhoneNumber(row.contact)}</div>
    </Tooltip>
    {hasAnyTimeWindow && (
      <Tooltip content={row.timeWindow}>
        <div style={{ color: "var(--color-text-tertiary)", fontSize: "14px", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", padding: row.timeWindow ? "4px 8px" : "0", borderRadius: "4px", background: row.timeWindow ? "rgba(255,255,255,0.05)" : "transparent", opacity: row.timeWindow ? 0.9 : 0, width: "110px" }}>{row.timeWindow}</div>
      </Tooltip>
    )}
  </div>
);
