import React, { useState } from "react";
import { OnCallRow, Contact } from "@shared/ipc";
import { Input } from "../Input";
import { Combobox } from "../Combobox";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { formatPhoneNumber } from "@shared/phoneUtils";

interface SortableEditRowProps {
  row: OnCallRow;
  contacts: Contact[];
  onUpdate: (row: OnCallRow) => void;
  onRemove: () => void;
}

export const SortableEditRow: React.FC<SortableEditRowProps> = ({ row, contacts, onUpdate, onRemove }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const [isActive, setIsActive] = useState(false);

  const style = {
    transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1, position: "relative" as const,
    zIndex: isDragging ? 1000 : isActive ? 100 : "auto", scale: isDragging ? "1.02" : "1", boxShadow: isDragging ? "var(--shadow-xl)" : "none", marginBottom: "8px",
  };

  const handleNameChange = (val: string) => {
    const nextRow = { ...row, name: val };
    const match = contacts.find((c) => c.name.toLowerCase() === val.toLowerCase());
    if (match && match.phone) nextRow.contact = formatPhoneNumber(match.phone);
    onUpdate(nextRow);
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div style={{ display: "grid", gridTemplateColumns: "28px minmax(110px, 150px) 1fr minmax(120px, 160px) minmax(100px, 130px) 28px", gap: "10px", alignItems: "center", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)", padding: "10px 12px", borderRadius: "12px", transition: "background 0.2s" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.04)")} onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}>
        <div {...attributes} {...listeners} style={{ cursor: isDragging ? "grabbing" : "grab", opacity: 0.4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>⋮⋮</div>
        <div style={{ position: "relative", minWidth: 0 }}>
          <Combobox value={row.role} onChange={(val) => onUpdate({ ...row, role: val })} options={[
            { label: "Primary", value: "Primary" }, 
            { label: "Backup", value: "Backup" }, 
            { label: "Backup/Weekend", value: "Backup/Weekend" }, 
            { label: "Weekend", value: "Weekend" },
            { label: "Network", value: "Network" },
            { label: "Telecom", value: "Telecom" },
            { label: "Member", value: "Member" }
          ]}
            placeholder="Role" style={{ fontWeight: 600, fontSize: "12px", fontFamily: "var(--font-mono)" }} onOpenChange={setIsActive} />
        </div>
        <div style={{ position: "relative", minWidth: 0 }}>
          <Combobox value={row.name} onChange={handleNameChange} options={contacts.map((c) => ({ label: c.name, value: c.name, subLabel: c.title }))} placeholder="Select Contact..." style={{ fontSize: "14px" }} onOpenChange={setIsActive} />
        </div>
        <Input value={row.contact} onChange={(e) => onUpdate({ ...row, contact: e.target.value })} onBlur={() => onUpdate({ ...row, contact: formatPhoneNumber(row.contact) })} placeholder="Phone" style={{ fontSize: "13px", fontFamily: "var(--font-mono)" }} />
        <Input value={row.timeWindow || ""} onChange={(e) => onUpdate({ ...row, timeWindow: e.target.value })} placeholder="Time Window" style={{ fontSize: "12px", color: "var(--color-text-secondary)", textAlign: "center" }} />
        <div style={{ cursor: "pointer", color: "var(--color-danger)", opacity: 0.6, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", width: "24px", height: "24px", borderRadius: "50%", transition: "all 0.2s", flexShrink: 0 }}
          onClick={onRemove} onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(255, 92, 92, 0.1)"; }} onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.6"; e.currentTarget.style.background = "transparent"; }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </div>
      </div>
    </div>
  );
};
