import { useState, useEffect, useRef, useCallback } from 'react';
import { AppData, Contact, Server, DataError } from '@shared/ipc';
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

// Constants
const RELOAD_INDICATOR_MIN_DURATION_MS = 900;
const STUCK_SYNC_TIMEOUT_MS = 5000;
const INITIAL_DATA_RETRY_ATTEMPTS = 20;
const INITIAL_DATA_RETRY_DELAY_MS = 100;

// Format data errors for user-friendly display
function formatDataError(error: DataError): string {
  const file = error.file ? ` in ${error.file}` : '';
  switch (error.type) {
    case 'validation':
      if (Array.isArray(error.details) && error.details.length > 0) {
        const count = error.details.length;
        return `Data validation: ${count} issue${count > 1 ? 's' : ''} found${file}`;
      }
      return error.message;
    case 'parse':
      return `Failed to parse data${file}: ${error.message}`;
    case 'write':
      return `Failed to save changes${file}`;
    case 'read':
      return `Failed to read data${file}`;
    default:
      return error.message || 'An unknown error occurred';
  }
}

export function useAppData(showToast: (msg: string, type: 'success' | 'error' | 'info') => void) {
  const [data, setData] = useState<AppData>({
    groups: [],
    contacts: [],
    servers: [],
    onCall: [],
    lastUpdated: 0,
  });
  const [isReloading, setIsReloading] = useState(false);
  const reloadStartRef = useRef<number | null>(null);
  const reloadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isReloadingRef = useRef(isReloading);

  // Sync ref
  useEffect(() => {
    isReloadingRef.current = isReloading;
  }, [isReloading]);

  const settleReloadIndicator = useCallback(() => {
    if (!reloadStartRef.current) {
      setIsReloading(false);
      return;
    }
    const elapsed = performance.now() - reloadStartRef.current;
    const delay = Math.max(RELOAD_INDICATOR_MIN_DURATION_MS - elapsed, 0);
    if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    reloadTimeoutRef.current = setTimeout(() => {
      setIsReloading(false);
      reloadStartRef.current = null;
      reloadTimeoutRef.current = null;
    }, delay);
  }, []);

  // Safety timeout to prevent stuck syncing state
  useEffect(() => {
    if (isReloading) {
      const safety = setTimeout(() => {
        if (isReloadingRef.current) {
          loggers.app.warn('Force clearing stuck sync indicator after timeout');
          setIsReloading(false);
          reloadStartRef.current = null;
        }
      }, STUCK_SYNC_TIMEOUT_MS);
      return () => clearTimeout(safety);
    }
  }, [isReloading]);

  useEffect(() => {
    // Dev browser preview: no Electron API, use mock data
    if (!globalThis.api) {
      setData(getDevMockData());
      return;
    }

    let cancelled = false;

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const fetchInitialData = async () => {
      for (let attempt = 0; attempt < INITIAL_DATA_RETRY_ATTEMPTS; attempt++) {
        const initialData = await globalThis.api?.getInitialData();
        if (initialData) {
          loggers.app.info('Initial data received', {
            groups: initialData.groups.length,
            contacts: initialData.contacts.length,
            servers: initialData.servers.length,
            onCall: initialData.onCall.length,
          });
          if (!cancelled) setData(initialData);
          return;
        }
        await sleep(INITIAL_DATA_RETRY_DELAY_MS);
      }
      loggers.app.warn('Initial data unavailable after retries');
    };

    // Fetch initial data with retries to handle startup race with main process init
    void fetchInitialData();

    const unsubscribeData = globalThis.api.subscribeToData((newData: AppData) => {
      loggers.app.info('Data update received', {
        groups: newData.groups.length,
        contacts: newData.contacts.length,
        servers: newData.servers.length,
        onCall: newData.onCall.length,
      });
      setData(newData);
      settleReloadIndicator();
    });
    const unsubscribeReloadStart = globalThis.api.onReloadStart(() => {
      reloadStartRef.current = performance.now();
      setIsReloading(true);
    });
    const unsubscribeReloadComplete = globalThis.api.onReloadComplete(() => {
      settleReloadIndicator();
    });
    const unsubscribeDataError = globalThis.api.onDataError((error: DataError) => {
      loggers.app.error('Data error received', { error });
      const errorMessage = formatDataError(error);
      showToast(errorMessage, 'error');
    });

    // Ensure at least one reload event after subscriptions are attached.
    // This prevents a startup race where DATA_UPDATED is emitted before renderer subscribes.
    void globalThis.api.reloadData();

    return () => {
      cancelled = true;
      unsubscribeData();
      unsubscribeReloadStart();
      unsubscribeReloadComplete();
      unsubscribeDataError();
      if (reloadTimeoutRef.current) clearTimeout(reloadTimeoutRef.current);
    };
  }, [settleReloadIndicator, showToast]);

  const handleSync = useCallback(async () => {
    if (isReloading) return;
    await globalThis.api?.reloadData();
  }, [isReloading]);

  return {
    data,
    isReloading,
    handleSync,
  };
}
