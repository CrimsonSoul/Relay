import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from '../contexts';

const OFFICE_ZONES = [
  { label: 'PST', timeZone: 'America/Los_Angeles' },
  { label: 'MST', timeZone: 'America/Denver' },
  { label: 'CST', timeZone: 'America/Chicago' },
  { label: 'EST', timeZone: 'America/New_York' },
];

// Bolt: Cache Intl formatters to avoid constructing several new formatter instances on every tick
const formatterCache = new Map<string, Intl.DateTimeFormat>();
const getFormatter = (timeZone: string, options: Intl.DateTimeFormatOptions) => {
  const key = `${timeZone}-${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);

  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone, ...options });
    } catch (_e) {
      // Fallback for invalid timezones
      formatter = new Intl.DateTimeFormat('en-US', { ...options });
    }
    formatterCache.set(key, formatter);
  }

  return formatter;
};

export const WorldClock: React.FC = () => {
  const [time, setTime] = useState(new Date());
  const { timezone } = useLocation();

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const { primaryZone, secondaryZones } = useMemo(() => {
    const currentTz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    
    // Check if current matches one of our office zones
    const knownZone = OFFICE_ZONES.find(z => z.timeZone === currentTz);
    
    const primary = {
      label: knownZone?.label || 'Local',
      timeZone: currentTz,
      primary: true
    };

    // Filter out the primary zone from secondaries so we don't show it twice
    const secondaries = OFFICE_ZONES.filter(z => z.timeZone !== currentTz);

    return { primaryZone: primary, secondaryZones: secondaries };
  }, [timezone]);

  // Primary Zone Formatting
  const primaryTimeStr = getFormatter(primaryZone.timeZone, { hour: 'numeric', minute: '2-digit', hour12: true }).format(time);
  const primaryDateStr = getFormatter(primaryZone.timeZone, { month: 'short', day: 'numeric', weekday: 'short' }).format(time);
  const primaryZoneName = getFormatter(primaryZone.timeZone, { timeZoneName: 'short' }).formatToParts(time).find(p => p.type === 'timeZoneName')?.value || primaryZone.label;

  return (
    <div className="world-clock-container" style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>

      {/* Secondary Zones */}
      <div className="world-clock-secondary" style={{ display: 'flex', gap: '16px' }}>
        {secondaryZones.map(z => {
          const timeStr = getFormatter(z.timeZone, { hour: 'numeric', minute: '2-digit', hour12: true }).format(time);
          const zoneName = getFormatter(z.timeZone, { timeZoneName: 'short' }).formatToParts(time).find(p => p.type === 'timeZoneName')?.value || z.label;

          return (
            <div key={z.timeZone} className="world-clock-item" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span className="world-clock-label" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', fontWeight: 600, marginBottom: '2px' }}>
                {zoneName}
              </span>
              <span className="world-clock-time" style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-family-base)', fontWeight: 500 }}>
                {timeStr}
              </span>
            </div>
          );
        })}
      </div>

      {/* Separator */}
      <div className="world-clock-separator" style={{ width: '1px', height: '24px', background: 'var(--border-subtle)' }} />

      {/* Primary Zone */}
      <div className="world-clock-primary" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span className="world-clock-primary-time" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: '1.2' }}>
            {primaryTimeStr}
          </span>
          <div className="world-clock-details" style={{ display: 'flex', gap: '6px', fontSize: '11px', color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
            <span>{primaryZoneName}</span>
            <span>•</span>
            <span>{primaryDateStr}</span>
          </div>
        </div>
      </div>

    </div>
  );
};
