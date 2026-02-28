import { useState, useEffect, useCallback, useRef } from 'react';
import type { CloudStatusData, CloudStatusItem, CloudStatusSeverity } from '@shared/ipc';
import { secureStorage } from '../utils/secureStorage';
import { loggers } from '../utils/logger';
import { ErrorCategory } from '@shared/logging';
import { getErrorMessage } from '@shared/types';
import { useMounted } from './useMounted';

const POLLING_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const CACHE_KEY = 'cached_cloud_status';
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

type CacheEntry = {
  fetchedAt: number;
  data: CloudStatusData;
};

const TOAST_SEVERITIES: Set<CloudStatusSeverity> = new Set(['error', 'warning']);

function providerLabel(provider: string): string {
  switch (provider) {
    case 'aws':
      return 'AWS';
    case 'azure':
      return 'Azure';
    case 'm365':
      return 'M365';
    default:
      return provider;
  }
}

function severityLabel(severity: CloudStatusSeverity): string {
  switch (severity) {
    case 'error':
      return 'Outage';
    case 'warning':
      return 'Degraded';
    default:
      return severity;
  }
}

function getAllItems(data: CloudStatusData): CloudStatusItem[] {
  return [...(data.aws ?? []), ...(data.azure ?? []), ...(data.m365 ?? [])];
}

/**
 * App-level hook for cloud status background polling with toast notifications.
 * Runs regardless of which tab is active.
 */
export function useAppCloudStatus(
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void,
) {
  const mounted = useMounted();
  const [statusData, setStatusData] = useState<CloudStatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Restore from cache on mount (stale-while-revalidate) and seed seen IDs
  useEffect(() => {
    const cached = secureStorage.getItemSync<CacheEntry>(CACHE_KEY);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      if (mounted.current) setStatusData(cached.data);
      // Seed seen IDs so we don't toast stale events on first fresh fetch
      for (const item of getAllItems(cached.data)) {
        seenIdsRef.current.add(item.id);
      }
    }
  }, [mounted]);

  const processNewEvents = useCallback(
    (data: CloudStatusData) => {
      const allItems = getAllItems(data);
      const newItems = allItems.filter(
        (item) => !seenIdsRef.current.has(item.id) && TOAST_SEVERITIES.has(item.severity),
      );

      if (newItems.length > 0) {
        // Show toast for the most severe new event
        const mostSevere = newItems.find((i) => i.severity === 'error') ?? newItems[0]!;
        const label = `${providerLabel(mostSevere.provider)} ${severityLabel(mostSevere.severity)}`;
        const suffix = newItems.length > 1 ? ` (+${newItems.length - 1} more)` : '';
        showToast(`${label}: ${mostSevere.title}${suffix}`, 'error');
      }

      // Update seen set with all current IDs (including info/resolved)
      const currentIds = new Set(allItems.map((i) => i.id));
      // Add new IDs
      for (const item of allItems) {
        seenIdsRef.current.add(item.id);
      }
      // Prune IDs no longer in feed
      for (const id of seenIdsRef.current) {
        if (!currentIds.has(id)) seenIdsRef.current.delete(id);
      }
    },
    [showToast],
  );

  const fetchStatus = useCallback(
    async (silent = false) => {
      if (!silent && mounted.current) setLoading(true);
      try {
        const api = globalThis.api;
        if (!api) throw new Error('API bridge not available');

        // Run fetch and minimum spinner duration in parallel for manual refresh
        const [data] = await Promise.all([
          api.getCloudStatus(),
          silent ? null : new Promise((r) => setTimeout(r, 500)),
        ]);
        if (!mounted.current) return;

        processNewEvents(data);
        setStatusData(data);
        secureStorage.setItemSync(CACHE_KEY, { fetchedAt: Date.now(), data } as CacheEntry);
      } catch (err) {
        loggers.app.error('Cloud status fetch failed', {
          error: getErrorMessage(err),
          category: ErrorCategory.NETWORK,
        });
      } finally {
        if (!silent && mounted.current) setLoading(false);
      }
    },
    [mounted, processNewEvents],
  );

  // Initial fetch + polling
  useEffect(() => {
    void fetchStatus(!!statusData); // silent if we already have cached data
    const interval = setInterval(() => fetchStatus(true), POLLING_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- statusData intentionally excluded
  }, [fetchStatus]);

  return { statusData, loading, refetch: () => fetchStatus(false) };
}
