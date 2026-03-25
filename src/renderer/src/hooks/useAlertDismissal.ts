import { useState, useEffect, useCallback, useMemo } from 'react';
import { useCollection } from './useCollection';
import { dismissAlert as pbDismissAlert } from '../services/oncallDismissalService';
import type { OncallDismissalRecord } from '../services/oncallDismissalService';
import { loggers } from '../utils/logger';

function getTodayDateKey(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function useAlertDismissal() {
  const [todayKey, setTodayKey] = useState(getTodayDateKey);
  const [dayOfWeek, setDayOfWeek] = useState(() => new Date().getDay());
  const [tick, setTick] = useState(Date.now());
  // Optimistic local dismissals — shown immediately before PB SSE confirms
  const [optimisticDismissals, setOptimisticDismissals] = useState<Set<string>>(new Set());

  const { data: records } = useCollection<OncallDismissalRecord>('oncall_dismissals');

  // Derive dismissed alert types for today from PB records
  const dismissedAlerts = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      if (r.dateKey === todayKey) {
        set.add(r.alertType);
      }
    }
    // Merge optimistic dismissals
    for (const type of optimisticDismissals) {
      set.add(type);
    }
    return set;
  }, [records, todayKey, optimisticDismissals]);

  const dismissAlert = useCallback(
    (type: string) => {
      // Skip if already dismissed
      if (dismissedAlerts.has(type)) return;

      // Optimistic: show immediately
      setOptimisticDismissals((prev) => {
        const next = new Set(prev);
        next.add(type);
        return next;
      });

      // Persist to PocketBase
      pbDismissAlert(type, todayKey).catch((err: unknown) => {
        loggers.app.error('Failed to persist alert dismissal', { error: err });
      });

      // Broadcast to popout windows on same instance (fast path)
      globalThis.api?.notifyAlertDismissed(type);
    },
    [dismissedAlerts, todayKey],
  );

  // Day rollover check + tick for re-renders
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const checkDay = () => {
      setTick(Date.now());
      const now = new Date();
      setDayOfWeek(now.getDay());
      const newKey = getTodayDateKey();
      if (newKey !== todayKey) {
        setTodayKey(newKey);
        setOptimisticDismissals(new Set());
      }
    };

    const startInterval = () => {
      intervalId ??= setInterval(checkDay, 60000);
    };

    const stopInterval = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopInterval();
      } else {
        checkDay();
        startInterval();
      }
    };

    startInterval();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for dismissals from other windows (same Electron process)
    const cleanupAlertListener = globalThis.api?.onAlertDismissed((type: string) => {
      setOptimisticDismissals((prev) => {
        const next = new Set(prev);
        next.add(type);
        return next;
      });
    });

    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cleanupAlertListener?.();
    };
  }, [todayKey]);

  // Clear optimistic state when PB records catch up
  useEffect(() => {
    const pbTypes = new Set(records.filter((r) => r.dateKey === todayKey).map((r) => r.alertType));
    setOptimisticDismissals((prev) => {
      const remaining = new Set<string>();
      for (const type of prev) {
        if (!pbTypes.has(type)) remaining.add(type);
      }
      return remaining.size === prev.size ? prev : remaining;
    });
  }, [records, todayKey]);

  return {
    dismissedAlerts,
    dismissAlert,
    dayOfWeek,
    tick,
  };
}
