import React from 'react';
import { Tooltip } from '../../components/Tooltip';
import type { WeatherData } from './types';
import { getWeatherIcon, getWeatherDescription, getWeatherOffsetMs } from './utils';

interface DailyForecastProps {
  weather: WeatherData | null;
}

export const DailyForecast: React.FC<DailyForecastProps> = ({ weather }) => {
  if (!weather) return null;

  const offsetMs = getWeatherOffsetMs(weather);
  const locationNow = new Date(Date.now() + offsetMs);
  const todayKey = `${locationNow.getUTCFullYear()}-${String(locationNow.getUTCMonth() + 1).padStart(2, '0')}-${String(locationNow.getUTCDate()).padStart(2, '0')}`;
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div
      style={{
        background: 'var(--app-surface)',
        borderRadius: '16px',
        padding: '20px',
        border: '1px solid rgba(255,255,255,0.06)',
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
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
          flexShrink: 0,
        }}
      >
        16-Day Forecast
      </h3>
      <div
        className="weather-scroll-container"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          padding: '4px',
        }}
      >
        {weather.daily.time.map((t, i) => {
          const [yearStr, monthStr, dayStr] = t.split('-');
          const year = Number(yearStr);
          const month = Number(monthStr);
          const day = Number(dayStr);
          const isToday = t === todayKey;
          const dayIndex =
            Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
              ? new Date(Date.UTC(year, month - 1, day)).getUTCDay()
              : 0;
          const dayLabel = isToday ? 'Today' : weekdays[dayIndex];
          return (
            <div
              key={t}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '12px 12px',
                borderRadius: '10px',
                background: isToday ? 'rgba(59, 130, 246, 0.08)' : 'transparent',
                transition: 'all var(--transition-base)',
                cursor: 'default',
                border: isToday ? '1px solid rgba(59, 130, 246, 0.15)' : '1px solid transparent',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = isToday
                  ? 'rgba(59, 130, 246, 0.15)'
                  : 'rgba(255, 255, 255, 0.03)';
                e.currentTarget.style.transform = 'translateX(4px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = isToday
                  ? 'rgba(59, 130, 246, 0.1)'
                  : 'transparent';
                e.currentTarget.style.transform = 'translateX(0)';
              }}
            >
              <span
                style={{
                  width: '44px',
                  fontWeight: isToday ? 600 : 500,
                  fontSize: '14px',
                  color: isToday ? 'var(--color-accent-blue)' : 'var(--color-text-primary)',
                }}
              >
                {dayLabel}
              </span>
              <Tooltip content={getWeatherDescription(weather.daily.weathercode[i])} position="top">
                <div
                  style={{
                    width: '32px',
                    display: 'flex',
                    justifyContent: 'center',
                  }}
                >
                  {getWeatherIcon(weather.daily.weathercode[i], 20)}
                </div>
              </Tooltip>
              {/* Wind and Precip */}
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  marginLeft: '12px',
                  flex: 1,
                  alignItems: 'center',
                }}
              >
                {weather.daily.wind_speed_10m_max[i] > 8 && (
                  <Tooltip content="Max Wind Speed" position="top">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        color: 'var(--color-text-tertiary)',
                        background: 'rgba(255,255,255,0.03)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                      }}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                      <span style={{ fontSize: '11px', fontWeight: 500 }}>
                        {Math.round(weather.daily.wind_speed_10m_max[i])}
                      </span>
                    </div>
                  </Tooltip>
                )}
                {weather.daily.precipitation_probability_max[i] > 0 && (
                  <Tooltip content="Precipitation Probability" position="top">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '3px',
                        color: '#60A5FA',
                        background: 'rgba(96, 165, 250, 0.08)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                      }}
                    >
                      <span style={{ fontSize: '11px', fontWeight: 600 }}>
                        {weather.daily.precipitation_probability_max[i]}%
                      </span>
                    </div>
                  </Tooltip>
                )}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: '15px',
                    minWidth: '32px',
                    textAlign: 'right',
                  }}
                >
                  {Math.round(weather.daily.temperature_2m_max[i])}°
                </span>
                <span
                  style={{
                    color: 'var(--color-text-tertiary)',
                    fontSize: '15px',
                    minWidth: '32px',
                    textAlign: 'right',
                  }}
                >
                  {Math.round(weather.daily.temperature_2m_min[i])}°
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
