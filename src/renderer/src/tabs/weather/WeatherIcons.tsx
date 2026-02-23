import React from 'react';

const commonProps = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  style: { overflow: 'visible' as const },
} as const;

const cloudPath =
  'M17.5 19c2.5 0 4.5-2 4.5-4.5 0-2.3-1.7-4.2-3.9-4.5-1.1-2.9-3.9-4.9-7.1-4.9-3.3 0-6.2 2.1-7.1 5.2C1.7 10.8 0 12.8 0 15.2c0 2.6 2.1 4.8 4.7 4.8h12.8';

export const getWeatherIcon = (code: number, size = 24) => {
  const props = { ...commonProps, width: size, height: size };

  // Clear / Sun
  if (code === 0 || code === 1) {
    return (
      <svg {...props} stroke="#FDB813">
        <circle cx="12" cy="12" r="5" fill="rgba(253, 184, 19, 0.1)" />
        <line x1="12" y1="1" x2="12" y2="3" />
        <line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" />
        <line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
      </svg>
    );
  }

  // Partly Cloudy
  if (code === 2) {
    return (
      <svg {...props} stroke="currentColor">
        <g stroke="#FDB813">
          <circle cx="16" cy="8" r="4" fill="rgba(253, 184, 19, 0.1)" />
          <line x1="16" y1="1" x2="16" y2="2.5" />
          <line x1="21.5" y1="2.5" x2="20.5" y2="3.5" />
          <line x1="23" y1="8" x2="21.5" y2="8" />
        </g>
        <path d={cloudPath} stroke="#A1A1AA" fill="rgba(15, 15, 18, 0.9)" />
      </svg>
    );
  }

  // Overcast / Fog
  if (code === 3 || code === 45 || code === 48) {
    return (
      <svg {...props} stroke="#A1A1AA">
        <path d={cloudPath} fill="rgba(161, 161, 170, 0.1)" />
        {(code === 45 || code === 48) && (
          <>
            <line x1="6" y1="22" x2="18" y2="22" strokeOpacity="0.5" />
            <line x1="8" y1="25" x2="16" y2="25" strokeOpacity="0.3" />
          </>
        )}
      </svg>
    );
  }

  // Drizzle / Rain
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return (
      <svg {...props} stroke="#67E8F9">
        <path d={cloudPath} stroke="#A1A1AA" fill="rgba(15, 15, 18, 0.4)" />
        <line x1="8" y1="21" x2="8" y2="24" />
        <line x1="12" y1="21" x2="12" y2="24" />
        <line x1="16" y1="21" x2="16" y2="24" />
      </svg>
    );
  }

  // Snow
  if (code >= 71 && code <= 77) {
    return (
      <svg {...props} stroke="#E5E7EB">
        <path d={cloudPath} stroke="#A1A1AA" fill="rgba(15, 15, 18, 0.4)" />
        <g transform="translate(0, 2)">
          <line x1="8" y1="21" x2="8" y2="21.01" strokeWidth="3" />
          <line x1="12" y1="21" x2="12" y2="21.01" strokeWidth="3" />
          <line x1="16" y1="21" x2="16" y2="21.01" strokeWidth="3" />
        </g>
      </svg>
    );
  }

  // Thunderstorm
  if (code >= 95) {
    return (
      <svg {...props} stroke="currentColor">
        <path d={cloudPath} stroke="#A1A1AA" fill="rgba(15, 15, 18, 0.4)" />
        <path d="M13 14L10 18H14L11 23" stroke="#FDE047" fill="rgba(253, 224, 71, 0.1)" />
      </svg>
    );
  }

  // Default / Cloudy
  return (
    <svg {...props} stroke="#A1A1AA">
      <path d={cloudPath} />
    </svg>
  );
};
