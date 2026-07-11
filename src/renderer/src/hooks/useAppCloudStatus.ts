import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecordModel } from 'pocketbase';
import {
  CLOUD_STATUS_PROVIDERS,
  type CloudStatusData,
  type CloudStatusItem,
  type CloudStatusSeverity,
  type CloudStatusSnapshotRecord,
} from '@shared/ipc';
import { ErrorCategory } from '@shared/logging';
import { getErrorMessage } from '@shared/types';
import { secureStorage } from '../utils/secureStorage';
import { loggers } from '../utils/logger';
import { useCollection } from './useCollection';

const CACHE_KEY = 'cached_cloud_status';

type CacheEntry = {
  fetchedAt: number;
  data: CloudStatusData;
};

type CollectionCloudStatusSnapshot = CloudStatusSnapshotRecord & RecordModel;

const TOAST_SEVERITIES: Set<CloudStatusSeverity> = new Set(['error', 'warning']);

function providerLabel(provider: string): string {
  return CLOUD_STATUS_PROVIDERS[provider as keyof typeof CLOUD_STATUS_PROVIDERS]?.label ?? provider;
}

function severityLabel(severity: CloudStatusSeverity): string {
  if (severity === 'error') return 'Outage';
  if (severity === 'warning') return 'Degraded';
  return severity;
}

function getAllItems(data: CloudStatusData): CloudStatusItem[] {
  return Object.values(data.providers).flat();
}

function toStatusData(record: CloudStatusSnapshotRecord): CloudStatusData {
  return {
    providers: record.providers,
    errors: record.errors,
    lastUpdated: record.lastUpdated,
  };
}

/** Consume the server-owned Cloud Status snapshot and issue local notifications. */
export function useAppCloudStatus(
  showToast: (message: string, type: 'success' | 'error' | 'info') => void,
) {
  const sharedSnapshot = useCollection<CollectionCloudStatusSnapshot>('cloud_status_snapshot', {
    filter: 'key="current"',
  });
  const [statusData, setStatusData] = useState<CloudStatusData | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const seenIdsRef = useRef(new Set<string>());
  const cacheRestoredRef = useRef(false);

  const processNewEvents = useCallback(
    (data: CloudStatusData) => {
      const allItems = getAllItems(data);
      const newItems = allItems.filter(
        (item) => !seenIdsRef.current.has(item.id) && TOAST_SEVERITIES.has(item.severity),
      );
      if (newItems.length > 0) {
        const mostSevere = newItems.find((item) => item.severity === 'error') ?? newItems[0]!;
        const suffix = newItems.length > 1 ? ` (+${newItems.length - 1} more)` : '';
        showToast(
          `${providerLabel(mostSevere.provider)} ${severityLabel(mostSevere.severity)}: ${mostSevere.title}${suffix}`,
          'error',
        );
      }

      const currentIds = new Set(allItems.map((item) => item.id));
      for (const item of allItems) seenIdsRef.current.add(item.id);
      for (const id of seenIdsRef.current) {
        if (!currentIds.has(id)) seenIdsRef.current.delete(id);
      }
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
    for (const item of getAllItems(cached.data)) seenIdsRef.current.add(item.id);
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
