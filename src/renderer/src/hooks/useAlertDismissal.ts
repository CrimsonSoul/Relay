import { useState, useEffect, useCallback } from 'react';
import { secureStorage } from '../utils/secureStorage';

const getAlertKey = (type: string) => {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${type}`;
};

const ALERT_TYPES = ['first-responder', 'general', 'sql', 'oracle'] as const;

export function useAlertDismissal() {
  const [currentDay, setCurrentDay] = useState(new Date().getDate());
  const [dayOfWeek, setDayOfWeek] = useState(new Date().getDay());
  const [tick, setTick] = useState(Date.now());

  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => {
    const saved = new Set<string>();
    ALERT_TYPES.forEach((type) => {
      const k = getAlertKey(type);
      if (secureStorage.getItemSync<string>(`dismissed-${k}`)) saved.add(k);
    });
    return saved;
  });

  const dismissAlert = useCallback((type: string) => {
    const key = getAlertKey(type);
    secureStorage.setItemSync(`dismissed-${key}`, 'true');
    setDismissedAlerts((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    // Broadcast to other windows (main <-> popout)
    globalThis.api?.notifyAlertDismissed(type);
  }, []);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick_ = () => {
      setTick(Date.now());
      const now = new Date();
      const newDay = now.getDate();
      setDayOfWeek(now.getDay());
      if (newDay !== currentDay) {
        setCurrentDay(newDay);
        const saved = new Set<string>();
        ALERT_TYPES.forEach((type) => {
          const key = getAlertKey(type);
          if (secureStorage.getItemSync<string>(`dismissed-${key}`)) saved.add(key);
        });
        setDismissedAlerts(saved);
      }
    };

    const startInterval = () => {
      intervalId ??= setInterval(tick_, 60000);
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
        // Fire immediately on resume so we catch any day change
        tick_();
        startInterval();
      }
    };

    startInterval();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Listen for alert dismissals from other windows
    const cleanupAlertListener = globalThis.api?.onAlertDismissed((type: string) => {
      const key = getAlertKey(type);
      secureStorage.setItemSync(`dismissed-${key}`, 'true');
      setDismissedAlerts((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    });

    return () => {
      stopInterval();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cleanupAlertListener?.();
    };
  }, [currentDay]);

  return {
    dismissedAlerts,
    dismissAlert,
    getAlertKey,
    dayOfWeek,
    tick,
  };
}
