import { useState, useEffect, useCallback, useMemo } from 'react';
import { AppData, Contact, Server, BridgeGroup, OnCallRow } from '@shared/ipc';
import { useCollection } from './useCollection';
import type { ContactRecord } from '../services/contactService';
import type { ServerRecord } from '../services/serverService';
import type { BridgeGroupRecord } from '../services/bridgeGroupService';
import type { OnCallRecord } from '../services/oncallService';
import type { OncallLayoutRecord } from '../services/oncallLayoutService';
import { loggers } from '../utils/logger';
import { getDevMockData } from '../utils/mockData';

/** Convert a PocketBase ContactRecord to the app Contact type. */
function toContact(r: ContactRecord): Contact {
  return {
    name: r.name,
    email: r.email,
    phone: r.phone,
    title: r.title,
    _searchString: `${r.name} ${r.email} ${r.phone} ${r.title}`.toLowerCase(),
    raw: {
      id: r.id,
      createdAt: new Date(r.created).getTime(),
      updatedAt: new Date(r.updated).getTime(),
    },
  };
}

/** Convert a PocketBase ServerRecord to the app Server type. */
function toServer(r: ServerRecord): Server {
  return {
    name: r.name,
    businessArea: r.businessArea,
    lob: r.lob,
    comment: r.comment,
    owner: r.owner,
    contact: r.contact,
    os: r.os,
    _searchString:
      `${r.name} ${r.businessArea} ${r.lob} ${r.comment} ${r.owner} ${r.contact} ${r.os}`.toLowerCase(),
    raw: {
      id: r.id,
      createdAt: new Date(r.created).getTime(),
      updatedAt: new Date(r.updated).getTime(),
    },
  };
}

/** Convert a PocketBase BridgeGroupRecord to the app BridgeGroup type. */
function toGroup(r: BridgeGroupRecord): BridgeGroup {
  return {
    id: r.id,
    name: r.name,
    contacts: r.contacts || [],
    createdAt: new Date(r.created).getTime(),
    updatedAt: new Date(r.updated).getTime(),
  };
}

/** Convert a PocketBase OnCallRecord to the app OnCallRow type. */
function toOnCallRow(r: OnCallRecord): OnCallRow {
  return {
    id: r.id,
    team: r.team,
    role: r.role,
    name: r.name,
    contact: r.contact,
    timeWindow: r.timeWindow,
  };
}

export function useAppData(showToast: (msg: string, type: 'success' | 'error' | 'info') => void) {
  // Dev browser preview: no PocketBase, use mock data
  const [isDevMode] = useState(() => !globalThis.api);

  const {
    data: contactRecords,
    loading: contactsLoading,
    error: contactsError,
    refetch: refetchContacts,
  } = useCollection<ContactRecord>('contacts', { sort: 'name' });

  const {
    data: serverRecords,
    loading: serversLoading,
    error: serversError,
    refetch: refetchServers,
  } = useCollection<ServerRecord>('servers', { sort: 'name' });

  const {
    data: groupRecords,
    loading: groupsLoading,
    error: groupsError,
    refetch: refetchGroups,
  } = useCollection<BridgeGroupRecord>('bridge_groups', { sort: 'name' });

  const {
    data: oncallRecords,
    loading: oncallLoading,
    error: oncallError,
    refetch: refetchOncall,
  } = useCollection<OnCallRecord>('oncall', { sort: 'sortOrder' });

  const {
    data: layoutRecords,
    loading: layoutLoading,
    error: layoutError,
    refetch: refetchLayout,
  } = useCollection<OncallLayoutRecord>('oncall_layout');

  // Transform PB records to app types
  const contacts = useMemo(() => contactRecords.map(toContact), [contactRecords]);
  const servers = useMemo(() => serverRecords.map(toServer), [serverRecords]);
  const groups = useMemo(() => groupRecords.map(toGroup), [groupRecords]);
  const onCall = useMemo(() => oncallRecords.map(toOnCallRow), [oncallRecords]);
  const teamLayout = useMemo(() => {
    const layout: Record<
      string,
      { x: number; y: number; w?: number; h?: number; isStatic?: boolean }
    > = {};
    for (const r of layoutRecords) {
      layout[r.team] = { x: r.x, y: r.y, w: r.w, h: r.h, isStatic: r.isStatic };
    }
    return layout;
  }, [layoutRecords]);

  const isLoading =
    contactsLoading || serversLoading || groupsLoading || oncallLoading || layoutLoading;
  const [isReloading, setIsReloading] = useState(false);

  // Show errors as toasts (suppress PocketBase auto-cancellation errors)
  useEffect(() => {
    if (contactsError && !contactsError.includes('autocancelled'))
      showToast(`Contacts: ${contactsError}`, 'error');
  }, [contactsError, showToast]);
  useEffect(() => {
    if (serversError && !serversError.includes('autocancelled'))
      showToast(`Servers: ${serversError}`, 'error');
  }, [serversError, showToast]);
  useEffect(() => {
    if (groupsError && !groupsError.includes('autocancelled'))
      showToast(`Groups: ${groupsError}`, 'error');
  }, [groupsError, showToast]);
  useEffect(() => {
    if (oncallError && !oncallError.includes('autocancelled'))
      showToast(`On-Call: ${oncallError}`, 'error');
  }, [oncallError, showToast]);
  useEffect(() => {
    if (layoutError && !layoutError.includes('autocancelled'))
      showToast(`Layout: ${layoutError}`, 'error');
  }, [layoutError, showToast]);

  // Build AppData object
  const data = useMemo<AppData>(() => {
    if (isDevMode && import.meta.env.DEV) return getDevMockData();
    return {
      contacts,
      servers,
      groups,
      onCall,
      teamLayout,
      lastUpdated: Date.now(),
    };
  }, [isDevMode, contacts, servers, groups, onCall, teamLayout]);

  const handleSync = useCallback(async () => {
    if (isReloading) return;
    setIsReloading(true);
    try {
      await Promise.all([
        refetchContacts(),
        refetchServers(),
        refetchGroups(),
        refetchOncall(),
        refetchLayout(),
      ]);
    } catch (err) {
      loggers.app.error('Sync failed', { error: err });
      showToast('Failed to sync data', 'error');
    } finally {
      setIsReloading(false);
    }
  }, [
    isReloading,
    refetchContacts,
    refetchServers,
    refetchGroups,
    refetchOncall,
    refetchLayout,
    showToast,
  ]);

  return {
    data,
    isReloading: isReloading || isLoading,
    handleSync,
  };
}
