import { useCallback, useEffect, useState } from 'react';
import type { RadarSnapshot } from '@shared/ipc';

const EMPTY: RadarSnapshot = {
  color: 'unknown',
  dispatchers: [],
  papa: [],
  metrics: [],
  xcenter: { ok: null, pending: null },
  currentTime: null,
  lastUpdated: 0,
  signInRequired: false,
  error: null,
};

/**
 * Mirrors the Radar snapshot the main process polls.
 *
 * The minute timer lives in main, not here: it has to keep running whether or
 * not the tab is mounted, and it owns the authenticated session. This hook only
 * reads the current value and listens for pushes.
 */
export function useRadarSnapshot(): {
  snapshot: RadarSnapshot;
  refreshing: boolean;
  refresh: () => void;
  signIn: () => void;
} {
  const [snapshot, setSnapshot] = useState<RadarSnapshot>(EMPTY);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void globalThis.api?.getRadarSnapshot?.().then((initial) => {
      if (!cancelled && initial) setSnapshot(initial);
    });

    const unsubscribe = globalThis.api?.onRadarSnapshot?.((next) => {
      if (!cancelled) setSnapshot(next);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void globalThis.api
      ?.refreshRadar?.()
      .then((next) => {
        if (next) setSnapshot(next);
      })
      .finally(() => setRefreshing(false));
  }, []);

  const signIn = useCallback(() => {
    void globalThis.api?.openRadarSignIn?.();
  }, []);

  return { snapshot, refreshing, refresh, signIn };
}
