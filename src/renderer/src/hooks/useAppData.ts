import { useState, useEffect, useRef, useCallback } from 'react';
import { AppData, DataError } from '@shared/ipc';
import { loggers } from '../utils/logger';

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
    if (!window.api) return;

    let cancelled = false;

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const fetchInitialData = async () => {
      for (let attempt = 0; attempt < INITIAL_DATA_RETRY_ATTEMPTS; attempt++) {
        const initialData = await window.api?.getInitialData();
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

    const unsubscribeData = window.api.subscribeToData((newData: AppData) => {
      loggers.app.info('Data update received', {
        groups: newData.groups.length,
        contacts: newData.contacts.length,
        servers: newData.servers.length,
        onCall: newData.onCall.length,
      });
      setData(newData);
      settleReloadIndicator();
    });
    const unsubscribeReloadStart = window.api.onReloadStart(() => {
      reloadStartRef.current = performance.now();
      setIsReloading(true);
    });
    const unsubscribeReloadComplete = window.api.onReloadComplete(() => {
      settleReloadIndicator();
    });
    const unsubscribeDataError = window.api.onDataError((error: DataError) => {
      loggers.app.error('Data error received', { error });
      const errorMessage = formatDataError(error);
      showToast(errorMessage, 'error');
    });

    // Ensure at least one reload event after subscriptions are attached.
    // This prevents a startup race where DATA_UPDATED is emitted before renderer subscribes.
    void window.api.reloadData();

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
    await window.api?.reloadData();
  }, [isReloading]);

  return {
    data,
    isReloading,
    handleSync,
  };
}
