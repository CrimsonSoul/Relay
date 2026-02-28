import { useState, useEffect, useCallback } from 'react';
import type { CloudStatusData } from '@shared/ipc';
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

export function useCloudStatus() {
  const mounted = useMounted();
  const [statusData, setStatusData] = useState<CloudStatusData | null>(null);
  const [loading, setLoading] = useState(false);

  // Restore from cache on mount (stale-while-revalidate)
  useEffect(() => {
    const cached = secureStorage.getItemSync<CacheEntry>(CACHE_KEY);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      if (mounted.current) setStatusData(cached.data);
    }
  }, [mounted]);

  const fetchStatus = useCallback(
    async (silent = false) => {
      if (!silent && mounted.current) setLoading(true);
      try {
        const api = globalThis.api;
        if (!api) throw new Error('API bridge not available');

        const data = await api.getCloudStatus();
        if (!mounted.current) return;

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
    [mounted],
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
