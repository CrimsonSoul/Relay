import { BridgeGroup, Contact, OnCallEntry } from '@shared/ipc';

export type SortConfig = {
  key: 'name' | 'title' | 'email' | 'phone' | 'groups';
  direction: 'asc' | 'desc';
};

export type AssemblerTabProps = {
  groups: BridgeGroup[];
  contacts: Contact[];
  onCall: OnCallEntry[];
  selectedGroupIds: string[];
  manualAdds: string[];
  manualRemoves: string[];
  onToggleGroup: (groupId: string) => void;
  onAddManual: (email: string) => void;
  onRemoveManual: (email: string) => void;
  onUndoRemove: () => void;
  onResetManual: () => void;
  // Optional setters for history loading
  setSelectedGroupIds?: (ids: string[]) => void;
  setManualAdds?: (emails: string[]) => void;
};

export type VirtualRowData = {
  log: { email: string; source: string }[];
  contactMap: Map<string, Contact>;
  groupMap: Map<string, string[]>;
  onRemoveManual: (email: string) => void;
  onAddToContacts: (email: string) => void;
  onContextMenu: (e: React.MouseEvent, email: string, isUnknown: boolean) => void;
};
