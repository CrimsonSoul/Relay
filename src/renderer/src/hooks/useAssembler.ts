import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { BridgeGroup, Contact } from '@shared/ipc';
import { useToast } from '../components/Toast';
import { loggers } from '../utils/logger';
import type { SortConfig } from '../tabs/assembler/types';
import { addContact as pbAddContact } from '../services/contactService';
import { buildBridgeHandoffSummary, buildBridgeSubject } from '../tabs/assembler/bridgeHandoff';

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
  const [isCopying, setIsCopying] = useState(false);
  const [isOpeningTeams, setIsOpeningTeams] = useState(false);
  const copyPendingRef = useRef(false);
  const teamsPendingRef = useRef(false);

  const handoffSummary = useMemo(
    () =>
      buildBridgeHandoffSummary({
        groups,
        selectedGroupIds,
        manualAdds,
        manualRemoves,
      }),
    [groups, selectedGroupIds, manualAdds, manualRemoves],
  );
  const bridgeSubject = useMemo(() => buildBridgeSubject(), []);

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
    const sortedRecipients = [...handoffSummary.recipients].sort((a, b) => {
      const contactA = contactMap.get(a.normalizedEmail);
      const contactB = contactMap.get(b.normalizedEmail);
      const dir = sortConfig.direction === 'asc' ? 1 : -1;
      if (sortConfig.key === 'groups')
        return (
          (groupStringMap.get(a.normalizedEmail) || '').localeCompare(
            groupStringMap.get(b.normalizedEmail) || '',
          ) * dir
        );
      let valA = '',
        valB = '';
      if (sortConfig.key === 'name') {
        // String.split always yields at least one segment, so the trailing `|| ''`
        // only satisfies noUncheckedIndexedAccess.
        valA = (contactA?.name || a.email.split('@')[0] || '').toLowerCase();
        valB = (contactB?.name || b.email.split('@')[0] || '').toLowerCase();
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

    return sortedRecipients.map(({ email, source }) => ({ email, source }));
  }, [handoffSummary.recipients, contactMap, sortConfig, groupStringMap]);

  const log = allRecipients;

  const handleCopy = useCallback(async (): Promise<boolean> => {
    if (copyPendingRef.current || !handoffSummary.isValid) return false;

    copyPendingRef.current = true;
    setIsCopying(true);
    try {
      const success = await globalThis.api?.writeClipboard(
        handoffSummary.recipients.map((recipient) => recipient.normalizedEmail).join('; '),
      );
      if (success) {
        showToast('Recipients copied', 'success');
        return true;
      }
      showToast('Could not copy recipients', 'error');
      return false;
    } catch (error) {
      loggers.app.error('[useAssembler] Failed to copy recipients', { error });
      showToast('Could not copy recipients', 'error');
      return false;
    } finally {
      copyPendingRef.current = false;
      setIsCopying(false);
    }
  }, [handoffSummary, showToast]);

  const executeDraftBridge = useCallback(async (): Promise<boolean> => {
    if (teamsPendingRef.current || !handoffSummary.isValid) return false;

    const api = globalThis.api;
    if (!api) {
      showToast('Could not open Teams draft', 'error');
      return false;
    }

    teamsPendingRef.current = true;
    setIsOpeningTeams(true);
    const params = new URLSearchParams({
      subject: bridgeSubject,
      attendees: handoffSummary.recipients.map((recipient) => recipient.normalizedEmail).join(','),
    });
    const query = params.toString();
    try {
      // Try the desktop client deep link first; fall back to the web URL if it is refused
      const openedDeepLink = await api.openExternal(
        `msteams://teams.microsoft.com/l/meeting/new?${query}`,
      );
      if (!openedDeepLink) {
        const openedWeb = await api.openExternal(
          `https://teams.microsoft.com/l/meeting/new?${query}`,
        );
        if (!openedWeb) {
          showToast('Could not open Teams draft', 'error');
          return false;
        }
      }
      showToast('Teams draft requested', 'success');
      return true;
    } catch (error) {
      loggers.app.error('[useAssembler] Failed to open Teams draft', { error });
      showToast('Could not open Teams draft', 'error');
      return false;
    } finally {
      teamsPendingRef.current = false;
      setIsOpeningTeams(false);
    }
  }, [bridgeSubject, handoffSummary, showToast]);
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
    handoffSummary,
    bridgeSubject,
    allRecipients,
    log,
    itemData,
    isCopying,
    isOpeningTeams,
    handleCopy,
    executeDraftBridge,
    handleQuickAdd,
    handleAddToContacts,
    handleContactSaved,
  };
}
