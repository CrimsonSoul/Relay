import React, { useState, useEffect } from 'react';

const ZONES = [
  { label: 'CST', timeZone: 'America/Chicago', primary: true },
  { label: 'EST', timeZone: 'America/New_York' },
  { label: 'MST', timeZone: 'America/Denver' },
  { label: 'PST', timeZone: 'America/Los_Angeles' }
];

export const WorldClock: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
      {ZONES.map(z => {
        const timeStr = new Intl.DateTimeFormat('en-US', {
          timeZone: z.timeZone,
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        }).format(time);

        const dateStr = new Intl.DateTimeFormat('en-US', {
            timeZone: z.timeZone,
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        }).format(time);

        if (z.primary) {
            return (
                <div key={z.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginRight: '8px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--color-accent-blue)', fontWeight: 700, letterSpacing: '0.5px' }}>{z.label}</span>
                    <span style={{ fontSize: '14px', color: 'var(--color-text-primary)', fontWeight: 600, fontFamily: 'var(--font-family-mono)' }}>
                        {timeStr}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>
                        {dateStr}
                    </span>
                </div>
            )
        }

        return (
          <div key={z.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: 0.7 }}>
            <span style={{ fontSize: '9px', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>{z.label}</span>
            <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-family-mono)' }}>{timeStr}</span>
          </div>
        );
      })}
    </div>
  );
};
