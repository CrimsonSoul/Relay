import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation } from '../contexts';

const logInvalidTimezone = (tz: string, error: unknown) =>
  console.warn(`[WorldClock] Invalid timezone "${tz}":`, error);

const OFFICE_ZONES = [
  { label: 'PST', timeZone: 'America/Los_Angeles' },
  { label: 'MST', timeZone: 'America/Denver' },
  { label: 'CST', timeZone: 'America/Chicago' },
  { label: 'EST', timeZone: 'America/New_York' },
];

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const getFormatter = (timeZone: string, options: Intl.DateTimeFormatOptions) => {
  const key = `${timeZone}-${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);

  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone, ...options });
    } catch (error_) {
      // Timezone not recognised by Intl — fall back to local time
      logInvalidTimezone(timeZone, error_);
      formatter = new Intl.DateTimeFormat('en-US', { ...options });
    }
    formatterCache.set(key, formatter);
  }

  return formatter;
};

const getMinuteKey = (date: Date): number => Math.floor(date.getTime() / 60_000);

export const WorldClock: React.FC = () => {
  const [time, setTime] = useState(new Date());
  const { timezone } = useLocation();
  const minuteKeyRef = useRef(getMinuteKey(time));

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const nowMinuteKey = getMinuteKey(now);
      if (nowMinuteKey !== minuteKeyRef.current) {
        minuteKeyRef.current = nowMinuteKey;
        setTime(now);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const { primaryZone, secondaryZones } = useMemo(() => {
    const currentTz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const knownZone = OFFICE_ZONES.find((z) => z.timeZone === currentTz);

    const primary = {
      label: knownZone?.label || 'Local',
      timeZone: currentTz,
      primary: true,
    };

    const secondaries = OFFICE_ZONES.filter((z) => z.timeZone !== currentTz);
    return { primaryZone: primary, secondaryZones: secondaries };
  }, [timezone]);

  const primaryTimeStr = getFormatter(primaryZone.timeZone, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(time);
  const primaryDateStr = getFormatter(primaryZone.timeZone, {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(time);
  const primaryZoneName =
    getFormatter(primaryZone.timeZone, { timeZoneName: 'short' })
      .formatToParts(time)
      .find((p) => p.type === 'timeZoneName')?.value || primaryZone.label;

  const secondaryZoneItems = useMemo(() => {
    return secondaryZones.map((z) => {
      const timeStr = getFormatter(z.timeZone, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(time);
      const zoneName =
        getFormatter(z.timeZone, { timeZoneName: 'short' })
          .formatToParts(time)
          .find((p) => p.type === 'timeZoneName')?.value || z.label;

      return (
        <div key={z.timeZone} className="world-clock-item">
          <span className="world-clock-label">{zoneName}</span>
          <span className="world-clock-time">{timeStr}</span>
        </div>
      );
    });
  }, [secondaryZones, time]);

  return (
    <div className="world-clock-container">
      <div className="world-clock-secondary">{secondaryZoneItems}</div>
      <div className="world-clock-primary">
        <div className="world-clock-primary-inner">
          <span className="world-clock-primary-time">{primaryTimeStr}</span>
          <div className="world-clock-details">
            <span>{primaryZoneName}</span>
            <span>&bull;</span>
            <span>{primaryDateStr}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
