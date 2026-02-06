import { useState, useCallback } from 'react';
import { Contact } from "@shared/ipc";

export type Tab =
  | "Compose"
  | "Personnel"
  | "People"
  | "Servers"
  | "Radar"
  | "Weather"
  | "AI";

export function useAppAssembler() {
  const [activeTab, setActiveTab] = useState<Tab>("Compose");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [manualAdds, setManualAdds] = useState<string[]>([]);
  const [manualRemoves, setManualRemoves] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleAddToAssembler = useCallback((contact: Contact) => {
    setManualRemoves((prev) => prev.filter((e) => e !== contact.email));
    setManualAdds((prev) =>
      prev.includes(contact.email) ? prev : [...prev, contact.email]
    );
  }, []);

  const handleUndoRemove = useCallback(() => {
    setManualRemoves((prev) => {
      const newRemoves = [...prev];
      newRemoves.pop();
      return newRemoves;
    });
  }, []);

  const handleReset = useCallback(() => {
    setSelectedGroupIds([]);
    setManualAdds([]);
    setManualRemoves([]);
  }, []);

  const handleAddManual = useCallback((email: string) => {
    setManualAdds((p) => {
      if (p.includes(email)) return p;
      return [...p, email];
    });
  }, []);

  const handleRemoveManual = useCallback((email: string) => {
    setManualRemoves((p) => [...p, email]);
  }, []);

  const handleToggleGroup = useCallback((groupId: string) => {
    setSelectedGroupIds((prev) => {
      if (prev.includes(groupId)) {
        return prev.filter((id) => id !== groupId);
      }
      return [...prev, groupId];
    });
  }, []);

  const handleTabChange = useCallback((tab: Tab) => {
    setActiveTab(tab);
  }, []);

  return {
    activeTab,
    setActiveTab: handleTabChange,
    selectedGroupIds,
    setSelectedGroupIds,
    manualAdds,
    setManualAdds,
    manualRemoves,
    setManualRemoves,
    settingsOpen,
    setSettingsOpen,
    handleAddToAssembler,
    handleUndoRemove,
    handleReset,
    handleAddManual,
    handleRemoveManual,
    handleToggleGroup,
  };
}
