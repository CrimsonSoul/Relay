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
    <div className="daily-forecast">
      <h3 className="daily-forecast-title">16-Day Forecast</h3>
      <div className="daily-forecast-list weather-scroll-container">
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
              className={`daily-forecast-item${isToday ? ' daily-forecast-item--today' : ''}`}
            >
              <span className="daily-forecast-day">{dayLabel}</span>
              <Tooltip
                content={getWeatherDescription(weather.daily.weathercode[i] ?? 0)}
                position="top"
              >
                <div className="daily-forecast-icon-wrap">
                  {getWeatherIcon(weather.daily.weathercode[i] ?? 0, 20)}
                </div>
              </Tooltip>
              <div className="daily-forecast-meta">
                {(weather.daily.wind_speed_10m_max[i] ?? 0) > 8 && (
                  <Tooltip content="Max Wind Speed" position="top">
                    <div className="daily-forecast-wind-badge">
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
                      <span>{Math.round(weather.daily.wind_speed_10m_max[i] ?? 0)}</span>
                    </div>
                  </Tooltip>
                )}
                {(weather.daily.precipitation_probability_max[i] ?? 0) > 0 && (
                  <Tooltip content="Precipitation Probability" position="top">
                    <div className="daily-forecast-precip-badge">
                      <span>{weather.daily.precipitation_probability_max[i] ?? 0}%</span>
                    </div>
                  </Tooltip>
                )}
              </div>
              <div className="daily-forecast-temps">
                <span className="daily-forecast-temp-high">
                  {Math.round(weather.daily.temperature_2m_max[i] ?? 0)}°
                </span>
                <span className="daily-forecast-temp-low">
                  {Math.round(weather.daily.temperature_2m_min[i] ?? 0)}°
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
