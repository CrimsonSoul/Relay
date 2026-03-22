import { useState, useEffect, useCallback, useMemo } from 'react';
import { AppData, Contact, Server, BridgeGroup, OnCallRow } from '@shared/ipc';
import { useCollection } from './useCollection';
import type { ContactRecord } from '../services/contactService';
import type { ServerRecord } from '../services/serverService';
import type { BridgeGroupRecord } from '../services/bridgeGroupService';
import type { OnCallRecord } from '../services/oncallService';
import type { OncallLayoutRecord } from '../services/oncallLayoutService';
import { loggers } from '../utils/logger';

// Dev-only mock data for browser preview (no Electron API available)
function getDevMockData(): AppData {
  const now = Date.now();
  const mkContact = (name: string, email: string, phone: string, title: string): Contact => ({
    name,
    email,
    phone,
    title,
    _searchString: `${name} ${email} ${phone} ${title}`.toLowerCase(),
    raw: { id: crypto.randomUUID(), createdAt: now, updatedAt: now },
  });
  const mkServer = (
    name: string,
    ba: string,
    lob: string,
    comment: string,
    owner: string,
    contact: string,
    os: string,
  ): Server => ({
    name,
    businessArea: ba,
    lob,
    comment,
    owner,
    contact,
    os,
    _searchString: `${name} ${ba} ${lob} ${comment} ${owner} ${contact} ${os}`.toLowerCase(),
    raw: { id: crypto.randomUUID(), createdAt: now, updatedAt: now },
  });

  const contacts = [
    mkContact('Alice Johnson', 'alice@example.com', '555-0100', 'Senior Engineer'),
    mkContact('Bob Smith', 'bob@example.com', '555-0101', 'DevOps Lead'),
    mkContact('Charlie Brown', 'charlie@example.com', '555-0102', 'Product Manager'),
    mkContact('Diana Prince', 'diana@example.com', '555-0103', 'Security Engineer'),
    mkContact('Evan Wright', 'evan@example.com', '555-0104', 'Database Admin'),
    mkContact('Fiona Lee', 'fiona@example.com', '555-0105', 'Backend Developer'),
    mkContact('George King', 'george@example.com', '555-0106', 'Frontend Developer'),
    mkContact('Hannah Scott', 'hannah@example.com', '555-0107', 'QA Engineer'),
    mkContact('Ian Clark', 'ian@example.com', '555-0108', 'SRE'),
    mkContact('Jane Doe', 'jane@example.com', '555-0109', 'Director of Engineering'),
    mkContact('Kyle Reese', 'kyle@example.com', '555-0110', 'Incident Commander'),
    mkContact('Laura Croft', 'laura@example.com', '555-0111', 'Network Engineer'),
    mkContact('Mike Ross', 'mike@example.com', '555-0112', 'Legal Counsel'),
    mkContact('Nina Patel', 'nina@example.com', '555-0113', 'HR Manager'),
    mkContact('Oscar Wilde', 'oscar@example.com', '555-0114', 'Content Strategist'),
    mkContact('Paul Atreides', 'paul@example.com', '555-0115', 'Operations Manager'),
    mkContact('Quinn Fabray', 'quinn@example.com', '555-0116', 'Designer'),
    mkContact('Rachel Green', 'rachel@example.com', '555-0117', 'Marketing Lead'),
    mkContact('Steve Rogers', 'steve@example.com', '555-0118', 'Team Lead'),
    mkContact('Tony Stark', 'tony@example.com', '555-0119', 'CTO'),
  ];

  const groups = [
    {
      id: 'g1',
      name: 'Core Engineering',
      contacts: ['alice@example.com', 'bob@example.com', 'ian@example.com', 'steve@example.com'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'g2',
      name: 'Product Team',
      contacts: ['charlie@example.com', 'quinn@example.com', 'rachel@example.com'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'g3',
      name: 'Leadership',
      contacts: ['jane@example.com', 'tony@example.com', 'mike@example.com'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'g4',
      name: 'DevOps',
      contacts: ['bob@example.com', 'evan@example.com', 'laura@example.com', 'kyle@example.com'],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'g5',
      name: 'Frontend Guild',
      contacts: ['george@example.com', 'fiona@example.com'],
      createdAt: now,
      updatedAt: now,
    },
  ];

  const servers = [
    mkServer(
      'web-prod-01',
      'eCommerce',
      'Storefront',
      'Primary web server',
      'alice@example.com',
      'steve@example.com',
      'Linux',
    ),
    mkServer(
      'web-prod-02',
      'eCommerce',
      'Storefront',
      'Secondary web server',
      'alice@example.com',
      'steve@example.com',
      'Linux',
    ),
    mkServer(
      'db-primary',
      'Data Services',
      'Core Data',
      'Main production DB',
      'evan@example.com',
      'laura@example.com',
      'Linux',
    ),
    mkServer(
      'db-replica',
      'Data Services',
      'Core Data',
      'Read replica',
      'evan@example.com',
      'laura@example.com',
      'Linux',
    ),
    mkServer(
      'cache-cluster',
      'Platform',
      'Caching',
      'Session cache',
      'bob@example.com',
      'kyle@example.com',
      'Linux',
    ),
    mkServer(
      'monitoring',
      'Platform',
      'Observability',
      'Metrics dashboard',
      'ian@example.com',
      'ian@example.com',
      'Linux',
    ),
    mkServer(
      'ci-runner',
      'DevOps',
      'CI/CD',
      'Build agent',
      'bob@example.com',
      'kyle@example.com',
      'Linux',
    ),
    mkServer(
      'staging-web',
      'eCommerce',
      'Storefront',
      'Staging environment',
      'fiona@example.com',
      'steve@example.com',
      'Linux',
    ),
    mkServer(
      'bastion-host',
      'Security',
      'InfraSec',
      'Jump box',
      'diana@example.com',
      'diana@example.com',
      'Linux',
    ),
    mkServer(
      'backup-server',
      'IT Ops',
      'Backups',
      'Daily backups location',
      'kyle@example.com',
      'kyle@example.com',
      'Windows',
    ),
  ];

  const onCall = [
    {
      id: 'oc1',
      team: 'SRE',
      role: 'Primary',
      name: 'Ian Clark',
      contact: '555-0108',
      timeWindow: '9am - 5pm',
    },
    {
      id: 'oc2',
      team: 'SRE',
      role: 'Secondary',
      name: 'Kyle Reese',
      contact: '555-0110',
      timeWindow: '9am - 5pm',
    },
    {
      id: 'oc3',
      team: 'SRE',
      role: 'Backup',
      name: 'Bob Smith',
      contact: '555-0101',
      timeWindow: 'Off-hours',
    },
    {
      id: 'oc4',
      team: 'Platform',
      role: 'Primary',
      name: 'Alice Johnson',
      contact: '555-0100',
      timeWindow: '24/7',
    },
    {
      id: 'oc5',
      team: 'Platform',
      role: 'Shadow',
      name: 'Steve Rogers',
      contact: '555-0118',
      timeWindow: '9am - 5pm',
    },
    {
      id: 'oc6',
      team: 'Security',
      role: 'Primary',
      name: 'Diana Prince',
      contact: '555-0103',
      timeWindow: '24/7',
    },
    {
      id: 'oc7',
      team: 'Security',
      role: 'Escalation',
      name: 'Tony Stark',
      contact: '555-0119',
      timeWindow: 'Always',
    },
    {
      id: 'oc8',
      team: 'Data',
      role: 'Primary',
      name: 'Evan Wright',
      contact: '555-0104',
      timeWindow: '8am - 4pm',
    },
  ];

  return { groups, contacts, servers, onCall, lastUpdated: now };
}

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
