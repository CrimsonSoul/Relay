import React, { useMemo } from 'react';
import { OnCallRow } from "@shared/ipc";
import { formatPhoneNumber } from '@shared/phoneUtils';
import { Tooltip } from "../Tooltip";
import { useToast } from '../Toast';
import { isTimeWindowActive } from '../../utils/timeParsing';

interface TeamRowProps { row: OnCallRow; hasAnyTimeWindow: boolean; gridTemplate: string }

const getRoleAbbrev = (role: string) => {
  const r = (role || "").toLowerCase();
  if (r.includes("primary")) { return "PRI"; }
  if (r.includes("secondary")) { return "SEC"; }
  if (r.includes("backup")) { return "BKP"; }
  if (r.includes("shadow")) { return "SHD"; }
  if (r.includes("escalation")) { return "ESC"; }
  if (r.includes("network")) { return "NET"; }
  if (r.includes("telecom")) { return "TEL"; }
  if (!role || r === "member") { return "MBR"; }
  return role.substring(0, 3).toUpperCase();
};

export const TeamRow: React.FC<TeamRowProps> = ({ row, hasAnyTimeWindow, gridTemplate }) => {
  const { showToast } = useToast();
  const isActive = useMemo(() => isTimeWindowActive(row.timeWindow || ""), [row.timeWindow]);
  const isPrimary = useMemo(() => {
    const r = (row.role || "").toLowerCase();
    return r.includes("primary") || r === "pri";
  }, [row.role]);

  const handleCopyContact = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!row.contact) return;
    
    const success = await window.api?.writeClipboard(row.contact);
    if (success) {
      showToast(`Copied ${row.contact}`, 'success');
    }
  };

  const roleText = row.role || "Member";

  return (
    <div 
      style={{ 
        display: "grid", 
        gridTemplateColumns: gridTemplate, 
        gap: "12px", 
        alignItems: "center", 
        padding: "6px 10px",
        borderRadius: "8px",
        background: isActive ? "rgba(37, 99, 235, 0.04)" : "transparent",
        border: isPrimary 
          ? "1px solid rgba(245, 158, 11, 0.3)" 
          : (isActive ? "1px solid rgba(37, 99, 235, 0.1)" : "1px solid transparent"),
        boxShadow: isActive ? "0 0 10px rgba(37, 99, 235, 0.05)" : (isPrimary ? "0 0 8px rgba(245, 158, 11, 0.05)" : "none"),
        transition: "all 0.3s ease",
        position: "relative"
      }}
      role="group"
      aria-label={`${roleText}: ${row.name || 'Empty'} ${isActive ? '(Active now)' : ''} ${isPrimary ? '(Primary)' : ''}`}
    >
      <Tooltip content={roleText}>
        <div 
          aria-hidden="true"
          style={{ color: isPrimary ? "#F59E0B" : (isActive ? "var(--color-accent-blue)" : "var(--color-text-tertiary)"), fontSize: "12px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", opacity: 0.8 }}
        >
          {getRoleAbbrev(row.role)}
        </div>
      </Tooltip>
      <Tooltip content={row.name} block>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: "120px" }}>
          {isActive && (
            <div 
              className="animate-active-indicator"
              style={{ 
                width: "8px", 
                height: "8px", 
                borderRadius: "50%", 
                background: "var(--color-accent-blue)",
                boxShadow: "0 0 10px var(--color-accent-blue)",
                flexShrink: 0
              }} 
            />
          )}
          <div style={{ 
            color: isActive ? "var(--color-accent-blue)" : (isPrimary ? "#F59E0B" : (row.name ? "var(--color-text-primary)" : "var(--color-text-quaternary)")), 
            fontSize: "18px", 
            fontWeight: 700, 
            whiteSpace: "nowrap", 
            overflow: "hidden", 
            textOverflow: "ellipsis",
            paddingRight: "12px"
          }}>
            {row.name || "—"}
          </div>
        </div>
      </Tooltip>

      <Tooltip content={row.name} block>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: "120px" }}>
          {isActive && (
            <div 
              className="animate-active-indicator"
              style={{ 
                width: "8px", 
                height: "8px", 
                borderRadius: "50%", 
                background: "var(--color-accent-blue)",
                boxShadow: "0 0 10px var(--color-accent-blue)",
                flexShrink: 0
              }} 
            />
          )}
          <div style={{ 
            color: isActive ? "var(--color-accent-blue)" : (row.name ? "var(--color-text-primary)" : "var(--color-text-quaternary)"), 
            fontSize: "18px", 
            fontWeight: 700, 
            whiteSpace: "nowrap", 
            overflow: "hidden", 
            textOverflow: "ellipsis",
            paddingRight: "12px"
          }}>
            {row.name || "—"}
          </div>
        </div>
      </Tooltip>
      <Tooltip content="Click to Copy Number">
        <div 
          onClick={handleCopyContact}
          style={{ 
            color: isActive ? "var(--color-accent-blue)" : "var(--color-text-primary)", 
            fontSize: "18px", 
            fontFamily: "var(--font-mono)", 
            textAlign: "right", 
            whiteSpace: "nowrap", 
            fontWeight: 700, 
            paddingLeft: "8px",
            cursor: "pointer",
            transition: "color 0.2s ease"
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-accent-blue)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = isActive ? "var(--color-accent-blue)" : "var(--color-text-primary)")}
        >
          {formatPhoneNumber(row.contact)}
        </div>
      </Tooltip>
      {hasAnyTimeWindow && (
        <Tooltip content={row.timeWindow || ""}>
          <div style={{ 
            color: isActive ? "var(--color-accent-blue)" : "var(--color-text-tertiary)", 
            fontSize: "12px", 
            fontWeight: 600,
            textAlign: "center", 
            whiteSpace: "nowrap", 
            padding: row.timeWindow ? "3px 8px" : "0", 
            borderRadius: "4px", 
            background: isActive ? "rgba(37, 99, 235, 0.1)" : (row.timeWindow ? "rgba(255,255,255,0.05)" : "transparent"), 
            opacity: row.timeWindow ? 0.9 : 0, 
            marginLeft: "8px" 
          }}>
            {row.timeWindow}
          </div>
        </Tooltip>
      )}
    </div>
  );
};

