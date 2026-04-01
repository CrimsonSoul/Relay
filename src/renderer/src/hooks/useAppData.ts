import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppData, Contact, Server, OnCallRow } from '@shared/ipc';
import { useCollection } from './useCollection';
import type { ContactRecord } from '../services/contactService';
import type { ServerRecord } from '../services/serverService';
import type { BridgeGroupRecord } from '../services/bridgeGroupService';
import { toGroup } from '../utils/transforms';
import type { OnCallRecord } from '../services/oncallService';
import {
  initializeBoardSettings,
  type BoardSettingsInitializationResult,
} from '../services/oncallBoardSettingsService';
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

/** Convert a PocketBase OnCallRecord to the app OnCallRow type. */
function toOnCallRow(r: OnCallRecord): OnCallRow {
  return {
    id: r.id,
    team: r.team,
    teamId: r.teamId,
    role: r.role,
    name: r.name,
    contact: r.contact,
    timeWindow: r.timeWindow,
  };
}

/** Board settings state exposed to consumers. */
export type BoardSettingsState = {
  record: BoardSettingsInitializationResult['record'];
  recordId: BoardSettingsInitializationResult['recordId'];
  effectiveTeamOrder: string[];
  effectiveLocked: boolean;
  status: BoardSettingsInitializationResult['status'] | 'loading';
  errors: string[];
};

const INITIAL_BOARD_SETTINGS: BoardSettingsState = {
  record: null,
  recordId: null,
  effectiveTeamOrder: [],
  effectiveLocked: true, // locked-for-safety until init completes
  status: 'loading',
  errors: [],
};

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

  // Transform PB records to app types
  const contacts = useMemo(() => contactRecords.map(toContact), [contactRecords]);
  const servers = useMemo(() => serverRecords.map(toServer), [serverRecords]);
  const groups = useMemo(() => groupRecords.map(toGroup), [groupRecords]);
  const onCall = useMemo(() => oncallRecords.map(toOnCallRow), [oncallRecords]);

  const isLoading = contactsLoading || serversLoading || groupsLoading || oncallLoading;
  const [isReloading, setIsReloading] = useState(false);

  // --- Board settings initialization ---
  const [boardSettings, setBoardSettings] = useState<BoardSettingsState>(INITIAL_BOARD_SETTINGS);
  const initGenRef = useRef(0);

  useEffect(() => {
    // Don't initialize until oncall records have finished loading
    if (oncallLoading) return;

    const gen = ++initGenRef.current;

    void initializeBoardSettings(oncallRecords).then(
      (result) => {
        if (gen !== initGenRef.current) return; // stale
        setBoardSettings({
          record: result.record,
          recordId: result.recordId,
          effectiveTeamOrder: result.effectiveTeamOrder,
          effectiveLocked: result.effectiveLocked,
          status: result.status,
          errors: result.errors,
        });
      },
      (err) => {
        if (gen !== initGenRef.current) return; // stale
        loggers.app.error('Board settings initialization failed', { error: err });
        setBoardSettings({
          ...INITIAL_BOARD_SETTINGS,
          status: 'invalid',
          errors: ['Board settings initialization failed'],
        });
      },
    );
  }, [oncallRecords, oncallLoading]);

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
  // Build AppData object
  const data = useMemo<AppData>(() => {
    if (isDevMode && import.meta.env.DEV) return getDevMockData();
    return {
      contacts,
      servers,
      groups,
      onCall,
      lastUpdated: Date.now(),
    };
  }, [isDevMode, contacts, servers, groups, onCall]);

  const handleSync = useCallback(async () => {
    if (isReloading) return;
    setIsReloading(true);
    try {
      await Promise.all([refetchContacts(), refetchServers(), refetchGroups(), refetchOncall()]);
    } catch (err) {
      loggers.app.error('Sync failed', { error: err });
      showToast('Failed to sync data', 'error');
    } finally {
      setIsReloading(false);
    }
  }, [isReloading, refetchContacts, refetchServers, refetchGroups, refetchOncall, showToast]);

  return {
    data,
    isReloading: isReloading || isLoading,
    handleSync,
    boardSettings,
  };
}
