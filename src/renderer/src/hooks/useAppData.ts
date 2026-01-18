import { useState, useEffect, useRef, useCallback } from 'react';
import { AppData, DataError } from "@shared/ipc";
import { loggers } from '../utils/logger';

// Constants
const RELOAD_INDICATOR_MIN_DURATION_MS = 900;
const STUCK_SYNC_TIMEOUT_MS = 5000;

// Format data errors for user-friendly display
function formatDataError(error: DataError): string {
  const file = error.file ? ` in ${error.file}` : "";
  switch (error.type) {
    case "validation":
      if (Array.isArray(error.details) && error.details.length > 0) {
        const count = error.details.length;
        return `Data validation: ${count} issue${count > 1 ? "s" : ""
          } found${file}`;
      }
      return error.message;
    case "parse":
      return `Failed to parse data${file}: ${error.message}`;
    case "write":
      return `Failed to save changes${file}`;
    case "read":
      return `Failed to read data${file}`;
    default:
      return error.message || "An unknown error occurred";
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

    // Fetch initial data immediately
    void window.api.getInitialData().then(initialData => {
      if (initialData) {
        console.log('[AppData] Fetched initial data');
        setData(initialData);
      }
    });

    const unsubscribeData = window.api.subscribeToData((newData: AppData) => {
      console.log('[AppData] Received broadcast update. Last updated:', new Date(newData.lastUpdated).toLocaleTimeString(), 'OnCall count:', newData.onCall.length);
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
      showToast(errorMessage, "error");
    });
    return () => {
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
    setData,
    isReloading,
    setIsReloading,
    handleSync
  };
}
