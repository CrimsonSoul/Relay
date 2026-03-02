import { useState, useEffect, useCallback } from 'react';

const getAlertKey = (type: string) => {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${type}`;
};

const ALERT_TYPES = ['first-responder', 'general', 'sql', 'oracle'] as const;

export function useAlertDismissal() {
  const [currentDay, setCurrentDay] = useState(new Date().getDay());
  const [tick, setTick] = useState(Date.now());

  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(() => {
    const saved = new Set<string>();
    ALERT_TYPES.forEach((type) => {
      const k = getAlertKey(type);
      if (localStorage.getItem(`dismissed-${k}`)) saved.add(k);
    });
    return saved;
  });

  const dismissAlert = useCallback((type: string) => {
    const key = getAlertKey(type);
    localStorage.setItem(`dismissed-${key}`, 'true');
    setDismissedAlerts((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setTick(Date.now());
      const newDay = new Date().getDay();
      if (newDay !== currentDay) {
        setCurrentDay(newDay);
        const saved = new Set<string>();
        ALERT_TYPES.forEach((type) => {
          const key = getAlertKey(type);
          if (localStorage.getItem(`dismissed-${key}`)) saved.add(key);
        });
        setDismissedAlerts(saved);
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [currentDay]);

  return {
    dismissedAlerts,
    dismissAlert,
    getAlertKey,
    currentDay,
    tick,
  };
}
