import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordModel } from 'pocketbase';
import {
  CLOUD_STATUS_PROVIDERS,
  type CloudStatusData,
  type CloudStatusItem,
  type CloudStatusSnapshotRecord,
} from '@shared/ipc';
import { ErrorCategory } from '@shared/logging';
import { getErrorMessage } from '@shared/types';
import { secureStorage } from '../utils/secureStorage';
import { loggers } from '../utils/logger';
import type { ShowToast } from '../components/Toast';
import { useCollection } from './useCollection';

const CACHE_KEY = 'cached_cloud_status';

type CacheEntry = {
  fetchedAt: number;
  data: CloudStatusData;
};

type CollectionCloudStatusSnapshot = CloudStatusSnapshotRecord & RecordModel;

function providerLabel(provider: string): string {
  return CLOUD_STATUS_PROVIDERS[provider as keyof typeof CLOUD_STATUS_PROVIDERS]?.label ?? provider;
}

function getAllItems(data: CloudStatusData): CloudStatusItem[] {
  return Object.values(data.providers).flat();
}

function getOutages(data: CloudStatusData): CloudStatusItem[] {
  return getAllItems(data).filter((item) => item.severity === 'error');
}

function toStatusData(record: CloudStatusSnapshotRecord): CloudStatusData {
  return {
    providers: record.providers,
    errors: record.errors,
    lastUpdated: record.lastUpdated,
  };
}

/** Consume the server-owned Cloud Status snapshot and issue local notifications. */
export function useAppCloudStatus(showToast: ShowToast) {
  const sharedSnapshot = useCollection<CollectionCloudStatusSnapshot>('cloud_status_snapshot', {
    filter: 'key="current"',
  });
  const [statusData, setStatusData] = useState<CloudStatusData | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const activeOutageIdsRef = useRef(new Set<string>());
  const baselineEstablishedRef = useRef(false);
  const cacheRestoredRef = useRef(false);

  const processNewEvents = useCallback(
    (data: CloudStatusData) => {
      const outages = getOutages(data);
      const currentOutageIds = new Set(outages.map((item) => item.id));
      if (!baselineEstablishedRef.current) {
        activeOutageIdsRef.current = currentOutageIds;
        baselineEstablishedRef.current = true;
        return;
      }

      const newItems = outages.filter((item) => !activeOutageIdsRef.current.has(item.id));
      if (newItems.length > 0) {
        const primary = newItems[0]!;
        const suffix = newItems.length > 1 ? ` (+${newItems.length - 1} more)` : '';
        showToast(`${providerLabel(primary.provider)} Outage: ${primary.title}${suffix}`, 'error', {
          title: 'Cloud outage',
          delivery: 'cloud-outage',
        });
      }

      activeOutageIdsRef.current = currentOutageIds;
    },
    [showToast],
  );

  const commitStatus = useCallback(
    (data: CloudStatusData) => {
      processNewEvents(data);
      setStatusData(data);
      secureStorage.setItemSync(CACHE_KEY, { fetchedAt: Date.now(), data } satisfies CacheEntry);
    },
    [processNewEvents],
  );

  useEffect(() => {
    const cached = secureStorage.getItemSync<CacheEntry>(CACHE_KEY);
    if (!cached?.data?.providers) return;
    cacheRestoredRef.current = true;
    activeOutageIdsRef.current = new Set(getOutages(cached.data).map((item) => item.id));
    baselineEstablishedRef.current = true;
    setStatusData(cached.data);
  }, []);

  const currentRecord = sharedSnapshot.data[0];
  useEffect(() => {
    if (!currentRecord) return;
    commitStatus(toStatusData(currentRecord));
  }, [commitStatus, currentRecord]);

  const refetch = useCallback(async () => {
    setManualLoading(true);
    try {
      const api = globalThis.api;
      if (!api) {
        loggers.app.info('Cloud status manual refresh unavailable: API bridge not available');
        return;
      }
      const [data] = await Promise.all([
        api.getCloudStatus(),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
      commitStatus(data);
    } catch (error) {
      loggers.app.error('Cloud status fetch failed', {
        error: getErrorMessage(error),
        category: ErrorCategory.NETWORK,
      });
    } finally {
      setManualLoading(false);
    }
  }, [commitStatus]);

  return {
    statusData,
    loading: manualLoading || (!cacheRestoredRef.current && !statusData && sharedSnapshot.loading),
    refetch,
  };
}
