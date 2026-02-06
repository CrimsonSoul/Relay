import React, { useMemo } from 'react';
import type { WeatherData } from './types';
import { Tooltip } from '../../components/Tooltip';
import { getWeatherIcon, getWeatherDescription, getWeatherOffsetMs } from './utils';

interface HourlyForecastProps {
  weather: WeatherData | null;
}

export const HourlyForecast: React.FC<HourlyForecastProps> = ({ weather }) => {
  // Filter hourly forecast to only show future hours
  const hourlyState = useMemo(() => {
    if (!weather) {
      return { items: [], startIndex: 0 };
    }

    const times = weather.hourly.time || [];
    if (times.length === 0) {
      return { items: [], startIndex: 0 };
    }

    const offsetMs = getWeatherOffsetMs(weather);
    const locationNow = new Date(Date.now() + offsetMs);
    const locationKey = `${locationNow.getUTCFullYear()}-${String(locationNow.getUTCMonth() + 1).padStart(2, '0')}-${String(locationNow.getUTCDate()).padStart(2, '0')}T${String(locationNow.getUTCHours()).padStart(2, '0')}:00`;
    const utcNow = new Date();
    const utcKey = `${utcNow.getUTCFullYear()}-${String(utcNow.getUTCMonth() + 1).padStart(2, '0')}-${String(utcNow.getUTCDate()).padStart(2, '0')}T${String(utcNow.getUTCHours()).padStart(2, '0')}:00`;

    let startIndex = times.findIndex((t) => t === locationKey);
    if (startIndex === -1) {
      startIndex = times.findIndex((t) => t === utcKey);
    }
    if (startIndex === -1) {
      startIndex = times.findIndex((t) => t > locationKey);
    }
    if (startIndex === -1) {
      startIndex = 0;
    }

    const items = times.slice(startIndex, startIndex + 12).map((t, offset) => {
      const index = startIndex + offset;
      return {
        time: t,
        temp: weather.hourly.temperature_2m[index],
        code: weather.hourly.weathercode[index],
        precip: weather.hourly.precipitation_probability[index],
        index,
        isNow: index === startIndex,
      };
    });

    return { items, startIndex };
  }, [weather]);

  if (!weather) return null;

  return (
    <div
      style={{
        background: 'var(--app-surface)',
        borderRadius: '16px',
        padding: '20px',
        border: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      }}
    >
      <h3
        style={{
          fontSize: '12px',
          fontWeight: 700,
          marginBottom: '16px',
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        Hourly Forecast
      </h3>
      <ul
        className="weather-scroll-container"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          overflowX: 'auto',
          overflowY: 'hidden',
          padding: '8px 4px',
          scrollBehavior: 'smooth',
          listStyle: 'none',
          margin: 0,
        }}
        onWheel={(e) => {
          // Smart horizontal scrolling: convert vertical scroll to horizontal
          const container = e.currentTarget;
          const hasHorizontalScroll = container.scrollWidth > container.clientWidth;

          if (hasHorizontalScroll) {
            // Use deltaX if explicitly scrolling horizontally (trackpad gesture)
            // Otherwise convert deltaY (mouse wheel) to horizontal scroll
            const scrollAmount = e.deltaX === 0 ? e.deltaY : e.deltaX;

            if (scrollAmount !== 0) {
              e.preventDefault();
              container.scrollLeft += scrollAmount;
            }
          }
        }}
      >
        {hourlyState.items.map((item) => {
          const timePart = item.time.split('T')[1] || '00:00';
          const hourStr = timePart.split(':')[0] || '0';
          const hours = Number(hourStr);
          const displayHour = hours % 12 || 12;
          const suffix = hours >= 12 ? 'PM' : 'AM';
          const hourLabel = `${displayHour} ${suffix}`;
          const isNow = item.isNow;
          const timeLabel = isNow ? 'Current hour' : hourLabel;
          const precipLabel =
            item.precip > 0
              ? `${item.precip}% chance of precipitation`
              : 'no precipitation expected';
          const ariaLabel = `${timeLabel}, ${Math.round(item.temp)} degrees, ${precipLabel}`;
          return (
            <li
              key={item.time}
              aria-label={ariaLabel}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '8px 10px',
                borderRadius: '8px',
                background: isNow ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                minWidth: '48px',
                flexShrink: 0,
                transition: 'all var(--transition-smooth)',
                transformOrigin: 'center center',
                cursor: 'default',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isNow
                  ? 'rgba(59, 130, 246, 0.25)'
                  : 'rgba(255, 255, 255, 0.05)';
                e.currentTarget.style.transform = 'translateY(-4px) scale(1.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isNow
                  ? 'rgba(59, 130, 246, 0.15)'
                  : 'transparent';
                e.currentTarget.style.transform = 'translateY(0) scale(1)';
              }}
            >
              <span
                style={{
                  fontSize: '12px',
                  color: isNow ? 'var(--color-accent-blue)' : 'var(--color-text-tertiary)',
                  marginBottom: '6px',
                  fontWeight: isNow ? 600 : 400,
                }}
              >
                {isNow ? 'Now' : hourLabel}
              </span>
              <Tooltip content={getWeatherDescription(item.code)} position="top">
                <div style={{ marginBottom: '6px' }}>{getWeatherIcon(item.code, 18)}</div>
              </Tooltip>
              {/* Rain Chance */}
              {item.precip > 0 ? (
                <div
                  style={{
                    fontSize: '10px',
                    color: '#60A5FA',
                    fontWeight: 600,
                    marginBottom: '2px',
                  }}
                >
                  {item.precip}%
                </div>
              ) : (
                <div style={{ height: '15px' }} />
              )}
              <span style={{ fontSize: '14px', fontWeight: 600, color: '#ffffff' }}>
                {Math.round(item.temp)}°
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
