import { useState, useCallback } from 'react';
import { Contact, TabName } from '@shared/ipc';

export function useAppAssembler() {
  const [activeTab, setActiveTab] = useState<TabName>('Compose');
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [manualAdds, setManualAdds] = useState<string[]>([]);
  const [manualRemoves, setManualRemoves] = useState<string[]>([]);

  const handleAddToAssembler = useCallback((contact: Contact) => {
    setManualRemoves((prev) =>
      prev.filter((e) => e.trim().toLowerCase() !== contact.email.trim().toLowerCase()),
    );
    setManualAdds((prev) => (prev.includes(contact.email) ? prev : [...prev, contact.email]));
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
    setManualRemoves((prev) =>
      prev.filter((entry) => entry.trim().toLowerCase() !== email.trim().toLowerCase()),
    );
    setManualAdds((p) => {
      if (p.includes(email)) return p;
      return [...p, email];
    });
  }, []);

  /** Adds a pasted list in one step and returns an Undo that restores the recipients before it. */
  const handleAddManualList = useCallback(
    (emails: readonly string[]) => {
      const previous = { adds: manualAdds, removes: manualRemoves };
      const added = new Set(emails.map((email) => email.trim().toLowerCase()));
      setManualRemoves((prev) => prev.filter((entry) => !added.has(entry.trim().toLowerCase())));
      setManualAdds((prev) => {
        const present = new Set(prev.map((entry) => entry.trim().toLowerCase()));
        const fresh = emails.filter((email) => !present.has(email.trim().toLowerCase()));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
      return () => {
        setManualAdds(previous.adds);
        setManualRemoves(previous.removes);
      };
    },
    [manualAdds, manualRemoves],
  );

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

  const handleTabChange = useCallback((tab: TabName) => {
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
    handleAddToAssembler,
    handleUndoRemove,
    handleReset,
    handleAddManual,
    handleAddManualList,
    handleRemoveManual,
    handleToggleGroup,
  };
}
