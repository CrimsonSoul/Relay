import { useState, useCallback, useMemo, useEffect } from 'react';
import { BridgeGroup, Contact } from '@shared/ipc';
import { getErrorMessage } from '@shared/types';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import type { SortConfig } from '../tabs/assembler/types';
import { addContact as pbAddContact } from '../services/contactService';

interface AssemblerState {
  groups: BridgeGroup[];
  contacts: Contact[];
  selectedGroupIds: string[];
  manualAdds: string[];
  manualRemoves: string[];
  onAddManual: (email: string) => void;
  onRemoveManual: (email: string) => void;
}

export function useAssembler({
  groups,
  contacts,
  selectedGroupIds,
  manualAdds,
  manualRemoves,
  onAddManual,
  onRemoveManual,
}: AssemblerState) {
  const { showToast } = useToast();
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'name', direction: 'asc' });
  const [isBridgeReminderOpen, setIsBridgeReminderOpen] = useState(false);
  const [isAddContactModalOpen, setIsAddContactModalOpen] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const [compositionContextMenu, setCompositionContextMenu] = useState<{
    x: number;
    y: number;
    email: string;
    isUnknown: boolean;
  } | null>(null);
  const [isHeaderCollapsed, setIsHeaderCollapsed] = useState(false);

  // Build all lookup maps in a single pass to reduce dependency chains
  const { contactMap, emailToGroupsMap, groupStringMap } = useMemo(() => {
    const contactMap = new Map<string, Contact>();
    contacts.forEach((c) => contactMap.set(c.email.toLowerCase(), c));

    const emailToGroupsMap = new Map<string, string[]>();
    groups.forEach((group) => {
      group.contacts.forEach((email) => {
        const lowerEmail = email.toLowerCase();
        if (!emailToGroupsMap.has(lowerEmail)) {
          emailToGroupsMap.set(lowerEmail, []);
        }
        emailToGroupsMap.get(lowerEmail)!.push(group.name);
      });
    });

    const groupStringMap = new Map<string, string>();
    emailToGroupsMap.forEach((groupNames, email) => {
      groupStringMap.set(email, groupNames.join(', '));
    });

    return { contactMap, emailToGroupsMap, groupStringMap };
  }, [contacts, groups]);

  const allRecipients = useMemo(() => {
    // Get all emails from selected groups
    const fromGroups = selectedGroupIds.flatMap((id) => {
      const group = groups.find((g) => g.id === id);
      return group ? group.contacts : [];
    });
    // Convert to Sets for O(1) lookups inside the filter/map loop
    const removeSet = new Set(manualRemoves);
    const addSet = new Set(manualAdds);
    // Create union without mutating in useMemo
    const unionSet = new Set([...fromGroups, ...manualAdds]);
    const filtered = Array.from(unionSet).filter((email) => !removeSet.has(email));
    const result = filtered.map((email) => ({
      email,
      source: addSet.has(email) ? 'manual' : 'group',
    }));

    return result.sort((a, b) => {
      const contactA = contactMap.get(a.email.toLowerCase());
      const contactB = contactMap.get(b.email.toLowerCase());
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      if (sortConfig.key === 'groups')
        return (
          (groupStringMap.get(a.email.toLowerCase()) || '').localeCompare(
            groupStringMap.get(b.email.toLowerCase()) || '',
          ) * dir
        );
      let valA = '',
        valB = '';
      if (sortConfig.key === 'name') {
        valA = (contactA?.name || a.email.split('@')[0]).toLowerCase();
        valB = (contactB?.name || b.email.split('@')[0]).toLowerCase();
      } else if (sortConfig.key === 'title') {
        valA = (contactA?.title || '').toLowerCase();
        valB = (contactB?.title || '').toLowerCase();
      } else if (sortConfig.key === 'email') {
        valA = a.email.toLowerCase();
        valB = b.email.toLowerCase();
      } else if (sortConfig.key === 'phone') {
        valA = (contactA?.phone || '').toLowerCase();
        valB = (contactB?.phone || '').toLowerCase();
      }
      return valA.localeCompare(valB) * dir;
    });
  }, [groups, selectedGroupIds, manualAdds, manualRemoves, contactMap, sortConfig, groupStringMap]);

  const log = allRecipients;

  const handleCopy = useCallback(async () => {
    const success = await globalThis.api?.writeClipboard(log.map((m) => m.email).join('; '));
    if (success) {
      showToast('Copied to clipboard', 'success');
    } else {
      showToast('Failed to copy to clipboard', 'error');
    }
  }, [log, showToast]);

  const executeDraftBridge = useCallback(() => {
    const date = new Date();
    const params = new URLSearchParams({
      subject: `${date.getMonth() + 1}/${date.getDate()} -`,
      attendees: log.map((m) => m.email).join(','),
    });
    globalThis.api
      ?.openExternal(`https://teams.microsoft.com/l/meeting/new?${params.toString()}`)
      ?.then(() => {
        showToast('Bridge drafted', 'success');
      })
      ?.catch((error_) => {
        showToast(`Failed to open Teams draft: ${getErrorMessage(error_)}`, 'error');
      });
  }, [log, showToast]);
  const handleQuickAdd = useCallback(
    (email: string) => {
      onAddManual(email);
      showToast(`Added ${email}`, 'success');
    },
    [onAddManual, showToast],
  );
  const handleAddToContacts = useCallback((email: string) => {
    setPendingEmail(email);
    setIsAddContactModalOpen(true);
  }, []);
  const handleCompositionContextMenu = useCallback(
    (e: React.MouseEvent, email: string, isUnknown: boolean) => {
      e.preventDefault();
      setCompositionContextMenu({ x: e.clientX, y: e.clientY, email, isUnknown });
    },
    [],
  );

  useEffect(() => {
    if (compositionContextMenu) {
      const handler = () => setCompositionContextMenu(null);
      globalThis.addEventListener('click', handler);
      return () => globalThis.removeEventListener('click', handler);
    }
  }, [compositionContextMenu]);

  const itemData = useMemo(
    () => ({
      log,
      contactMap,
      groupMap: emailToGroupsMap,
      onRemoveManual,
      onAddToContacts: handleAddToContacts,
      onContextMenu: handleCompositionContextMenu,
    }),
    [
      log,
      contactMap,
      emailToGroupsMap,
      onRemoveManual,
      handleAddToContacts,
      handleCompositionContextMenu,
    ],
  );

  const handleContactSaved = useCallback(
    async (contact: Partial<Contact>) => {
      try {
        await pbAddContact({
          name: contact.name || '',
          email: contact.email || '',
          phone: contact.phone || '',
          title: contact.title || '',
        });
        if (contact.email) onAddManual(contact.email);
        showToast('Contact created successfully', 'success');
      } catch (e) {
        loggers.app.error('[useAssembler] Failed to save contact', { error: e });
        showToast('Failed to create contact', 'error');
      }
    },
    [onAddManual, showToast],
  );

  return {
    sortConfig,
    setSortConfig,
    isBridgeReminderOpen,
    setIsBridgeReminderOpen,
    isAddContactModalOpen,
    setIsAddContactModalOpen,
    pendingEmail,
    compositionContextMenu,
    setCompositionContextMenu,
    isHeaderCollapsed,
    setIsHeaderCollapsed,
    contactMap,
    groupMap: emailToGroupsMap,
    allRecipients,
    log,
    itemData,
    handleCopy,
    executeDraftBridge,
    handleQuickAdd,
    handleAddToContacts,
    handleContactSaved,
  };
}
