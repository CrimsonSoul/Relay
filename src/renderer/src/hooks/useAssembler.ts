import { useState, useCallback, useMemo, useEffect } from "react";
import { secureStorage } from '../utils/secureStorage';
import { GroupMap, Contact } from "@shared/ipc";
import { useGroupMaps } from "./useGroupMaps";
import { useToast } from "../components/Toast";

export interface SortConfig { key: string; direction: 'asc' | 'desc'; }

interface AssemblerState {
  groups: GroupMap;
  contacts: Contact[];
  selectedGroups: string[];
  manualAdds: string[];
  manualRemoves: string[];
  onAddManual: (email: string) => void;
  onRemoveManual: (email: string) => void;
}

export function useAssembler({ groups, contacts, selectedGroups, manualAdds, manualRemoves, onAddManual, onRemoveManual }: AssemblerState) {
  const { showToast } = useToast();
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: "name", direction: "asc" });
  const [isBridgeReminderOpen, setIsBridgeReminderOpen] = useState(false);
  const [isAddContactModalOpen, setIsAddContactModalOpen] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [compositionContextMenu, setCompositionContextMenu] = useState<{ x: number; y: number; email: string; isUnknown: boolean } | null>(null);
  const [isGroupSidebarCollapsed, setIsGroupSidebarCollapsed] = useState(() => {
    try {
      return secureStorage.getItemSync<boolean>('assembler_sidebar_collapsed', false);
    } catch {
      return false;
    }
  });
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);

  useEffect(() => { secureStorage.setItemSync('assembler_sidebar_collapsed', isGroupSidebarCollapsed); }, [isGroupSidebarCollapsed]);

  const handleToggleSidebarCollapse = useCallback(() => setIsGroupSidebarCollapsed((prev: boolean) => !prev), []);

  const contactMap = useMemo(() => {
    const map = new Map<string, Contact>();
    contacts.forEach((c) => map.set(c.email.toLowerCase(), c));
    return map;
  }, [contacts]);

  const { groupMap, groupStringMap } = useGroupMaps(groups);

  const log = useMemo(() => {
    const fromGroups = selectedGroups.flatMap((g) => groups[g] || []);
    const union = new Set([...fromGroups, ...manualAdds]);
    manualRemoves.forEach((r) => union.delete(r));
    let result = Array.from(union).map((email) => ({ email, source: manualAdds.includes(email) ? "manual" : "group" }));

    return result.sort((a, b) => {
      const contactA = contactMap.get(a.email.toLowerCase());
      const contactB = contactMap.get(b.email.toLowerCase());
      const dir = sortConfig.direction === "asc" ? 1 : -1;
      if (sortConfig.key === "groups") return (groupStringMap.get(a.email.toLowerCase()) || "").localeCompare(groupStringMap.get(b.email.toLowerCase()) || "") * dir;
      let valA = "", valB = "";
      if (sortConfig.key === "name") { valA = (contactA?.name || a.email.split("@")[0]).toLowerCase(); valB = (contactB?.name || b.email.split("@")[0]).toLowerCase(); }
      else if (sortConfig.key === "title") { valA = (contactA?.title || "").toLowerCase(); valB = (contactB?.title || "").toLowerCase(); }
      else if (sortConfig.key === "email") { valA = a.email.toLowerCase(); valB = b.email.toLowerCase(); }
      else if (sortConfig.key === "phone") { valA = (contactA?.phone || "").toLowerCase(); valB = (contactB?.phone || "").toLowerCase(); }
      return valA.localeCompare(valB) * dir;
    });
  }, [groups, selectedGroups, manualAdds, manualRemoves, contactMap, sortConfig, groupStringMap]);

  const handleCopy = () => { navigator.clipboard.writeText(log.map((m) => m.email).join("; ")); showToast("Copied to clipboard", "success"); };
  const executeDraftBridge = () => {
    const date = new Date();
    const params = new URLSearchParams({ subject: `${date.getMonth() + 1}/${date.getDate()} -`, attendees: log.map((m) => m.email).join(",") });
    window.api?.openExternal(`https://teams.microsoft.com/l/meeting/new?${params.toString()}`);
    showToast("Bridge drafted", "success");
  };
  const handleQuickAdd = useCallback((email: string) => { onAddManual(email); showToast(`Added ${email}`, "success"); }, [onAddManual, showToast]);
  const handleAddToContacts = useCallback((email: string) => { setPendingEmail(email); setIsAddContactModalOpen(true); }, []);
  const handleCompositionContextMenu = useCallback((e: React.MouseEvent, email: string, isUnknown: boolean) => { e.preventDefault(); setCompositionContextMenu({ x: e.clientX, y: e.clientY, email, isUnknown }); }, []);

  useEffect(() => {
    if (compositionContextMenu) { const handler = () => setCompositionContextMenu(null); window.addEventListener("click", handler); return () => window.removeEventListener("click", handler); }
  }, [compositionContextMenu]);

  const itemData = useMemo(() => ({ log, contactMap, groupMap, onRemoveManual, onAddToContacts: handleAddToContacts, onContextMenu: handleCompositionContextMenu }), [log, contactMap, groupMap, onRemoveManual, handleAddToContacts, handleCompositionContextMenu]);

  const handleContactSaved = async (contact: Partial<Contact>) => {
    const success = await window.api?.addContact(contact);
    if (success) { if (contact.email) onAddManual(contact.email); showToast("Contact created successfully", "success"); } else { showToast("Failed to create contact", "error"); }
  };

  return {
    sortConfig, setSortConfig, isBridgeReminderOpen, setIsBridgeReminderOpen, isAddContactModalOpen, setIsAddContactModalOpen, pendingEmail,
    compositionContextMenu, setCompositionContextMenu, isGroupSidebarCollapsed, handleToggleSidebarCollapse, isHeaderCollapsed, setIsHeaderCollapsed,
    contactMap, groupMap, log, itemData, handleCopy, executeDraftBridge, handleQuickAdd, handleAddToContacts, handleContactSaved
  };
}
