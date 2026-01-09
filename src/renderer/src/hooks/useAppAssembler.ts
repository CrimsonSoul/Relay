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

export function useAppAssembler(isReloading: boolean) {
  const [activeTab, setActiveTab] = useState<Tab>("Compose");
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
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
    setSelectedGroups([]);
    setManualAdds([]);
    setManualRemoves([]);
  }, []);

  const handleAddManual = useCallback((email: string) => {
    setManualAdds((p) => [...p, email]);
  }, []);

  const handleRemoveManual = useCallback((email: string) => {
    setManualRemoves((p) => [...p, email]);
  }, []);

  const handleToggleGroup = useCallback((group: string) => {
    setSelectedGroups((prev) => {
      if (prev.includes(group)) {
        return prev.filter((g) => g !== group);
      }
      return [...prev, group];
    });
  }, []);

  const handleTabChange = useCallback((tab: Tab) => {
    if (isReloading) return;
    setActiveTab(tab);
  }, [isReloading]);

  const handleImportGroups = useCallback(
    async () => await window.api?.importGroupsFile(),
    []
  );
  const handleImportContacts = useCallback(
    async () => await window.api?.importContactsFile(),
    []
  );
  const handleImportServers = useCallback(
    async () => await window.api?.importServersFile(),
    []
  );

  return {
    activeTab,
    setActiveTab: handleTabChange,
    selectedGroups,
    setSelectedGroups,
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
    handleImportGroups,
    handleImportContacts,
    handleImportServers
  };
}
